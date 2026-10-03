/**
 * WsRpcServer — WebSocket-based RPC server.
 *
 * Owns ALL transport concerns: connection lifecycle, handshake, heartbeat,
 * optional auth, request dispatching, and push routing.
 *
 * Same class used locally (127.0.0.1, no auth) and remotely (0.0.0.0, auth).
 */

import { WebSocketServer, type WebSocket } from 'ws'
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http'
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https'
import { randomUUID } from 'node:crypto'
import {
  PROTOCOL_VERSION,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_MAX_MISSED,
  EVENT_BUFFER_MAX_SIZE,
  EVENT_BUFFER_TTL_MS,
  DISCONNECTED_CLIENT_TTL_MS,
  isErrorCode,
  isLocalOnly,
  CodedError,
  type MessageEnvelope,
  type PushTarget,
  type ErrorCode,
} from '@rox/shared/protocol'
import type { RpcServer, HandlerFn, RequestContext, RpcHandlerOptions, WorkspaceAuthorityAuthentication, WorkspaceAuthoritySession } from './types'
import { serializeEnvelope, deserializeEnvelope } from './codec'
import { createLogger } from '@rox/shared/utils'
import { CLIENT_OPEN_FILE_DIALOG } from './capabilities'
import {
  createRpcCallCounterFromEnv,
  type RpcCallCounter,
} from '../observability/rpc-call-counter'
import type { NativeAuthority, NativePrincipal } from '../authority/native-authority'

// ---------------------------------------------------------------------------
// Client connection state
// ---------------------------------------------------------------------------

interface BufferedEvent {
  seq: number
  /** Shared serialized envelope — one allocation referenced by all client buffers. */
  data: string
  timestamp: number
}

interface ClientConnection {
  id: string
  ws: WebSocket
  workspaceId: string | null
  webContentsId: number | null
  /**
   * Present only when Electron main resolved the handshake proof to a current
   * window/workspace binding. Raw handshake fields never create this state.
   */
  localBinding: TrustedLocalClientBinding | null
  /** Kept server-side so main can renew the original proof against the live window. */
  localBindingCandidate: LocalClientBindingCandidate
  principal: NativePrincipal | null
  subscriptionFence: string | null
  /** Resolver-owned opaque result; no Actor or identity enters through handshake fields. */
  workspaceSession: WorkspaceAuthoritySession | null
  capabilities: Set<string>
  missedPongs: number
  alive: boolean
  /** Ring buffer of recent events for replay on reconnect. */
  eventBuffer: BufferedEvent[]
  /** Highest per-client seq the client has acknowledged. */
  lastAckedSeq: number
  /** Highest per-client seq assigned to this client. */
  lastSentSeq: number
}

interface PendingInvoke {
  clientId: string
  resolve: (value: any) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

interface RegisteredHandler {
  readonly handler: HandlerFn
  readonly access: RpcHandlerOptions['access']
  readonly nativeAction: RpcHandlerOptions['nativeAction']
  readonly timeoutMs: number
  readonly beforeResponse?: RpcHandlerOptions['beforeResponse']
  readonly beforeWorkspaceResponse?: RpcHandlerOptions['beforeWorkspaceResponse']
}

export interface LocalClientBindingCandidate {
  readonly workspaceId: string | null
  readonly webContentsId: number | null
  readonly localClientProof: string | null
}

export interface TrustedLocalClientBinding {
  readonly workspaceId: string
  readonly webContentsId: number
}

// ---------------------------------------------------------------------------
// Server options
// ---------------------------------------------------------------------------

export interface WsRpcTlsOptions {
  /** PEM-encoded certificate (or Buffer). */
  cert: string | Buffer
  /** PEM-encoded private key (or Buffer). */
  key: string | Buffer
  /** Optional PEM-encoded CA chain for client certificate verification. */
  ca?: string | Buffer
  /** Optional passphrase for encrypted private keys. */
  passphrase?: string
}

export interface WsRpcServerOptions {
  /** Host to bind to. Default: '127.0.0.1' */
  host?: string
  /** Port to bind to. 0 = random available port. Default: 0 */
  port?: number
  /** Whether to require a bearer token on handshake. Default: false */
  requireAuth?: boolean
  /**
   * Explicit shared authority mode. Requires a real pinned-issuer resolver and live refresh.
   * Legacy boolean/cookie/local-proof auth is rejected. Generic push/client invocation is
   * unavailable; authorized durable domain replay uses authenticatedWorkspace handlers.
   */
  workspaceAuthority?: WorkspaceAuthorityAuthentication
  /** Token validator. Called when requireAuth is true. */
  validateToken?: (token: string) => Promise<boolean>
  /**
   * Optional cookie-based session validator (for web UI auth).
   * Called with the Cookie header from the HTTP upgrade request.
   * If provided, a valid session cookie is accepted as an alternative to a bearer token.
   */
  validateSessionCookie?: (cookieHeader: string | null) => Promise<boolean>
  /** Server identity stamp on outgoing events. Default: 'local' */
  serverId?: string
  /** TLS configuration. When provided, the server listens on wss:// instead of ws://. */
  tls?: WsRpcTlsOptions
  /** App version string, included in handshake_ack for client compatibility checks. */
  serverVersion?: string
  /** Maximum concurrent clients. 0 = unlimited. Default: 50 */
  maxClients?: number
  /** Called when a client completes handshake. */
  onClientConnected?: (info: {
    clientId: string
    webContentsId: number | null
    workspaceId: string | null
    capabilities: string[]
    isLocalElectronClient: boolean
  }) => void
  /** Called when a client disconnects. */
  onClientDisconnected?: (clientId: string) => void
  /**
   * Electron main may turn an untrusted handshake candidate into an
   * authoritative local renderer binding. Returning null leaves the client
   * unbound and unable to access local-Electron handlers.
   */
  resolveLocalClientBinding?: (candidate: LocalClientBindingCandidate) => TrustedLocalClientBinding | null
  /**
   * Optional HTTP request handler for non-WebSocket requests.
   * When provided, regular HTTP requests to the server's port are
   * routed here instead of being rejected. This enables serving the
   * WebUI from the same port as the WebSocket server.
   * Must use Node.js HTTP callback signature (IncomingMessage, ServerResponse).
   */
  httpHandler?: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void
  /**
   * Optional RPC call counter. Default off. Pass an instance or set
   * CRAFT_PERF_RPC_TRACE=1 to count session permission/metadata N+1.
   */
  rpcCallCounter?: RpcCallCounter | null
  /** Server-owned authority; legacy tokens never grant access to registered workspaces. */
  nativeAuthority?: NativeAuthority
  /** Only these explicitly workspace-scoped events can reach native subscribers. */
  nativeEventChannels?: ReadonlySet<string>
  /** Device effects/status must never broadcast to every member of a workspace. */
  nativeClientEventChannels?: ReadonlySet<string>
  /** Safe host-composed projection; null drops an event before buffering/replay. */
  projectNativeEvent?: (channel: string, arguments_: readonly unknown[], workspaceId: string, principal: NativePrincipal) => readonly unknown[] | null
}

const transportLog = createLogger('ws-rpc-server')

// ---------------------------------------------------------------------------
// WsRpcServer
// ---------------------------------------------------------------------------

export class WsRpcServer implements RpcServer {
  private wss: WebSocketServer | null = null
  private httpServer: HttpServer | null = null
  private httpsServer: HttpsServer | null = null
  private clients = new Map<string, ClientConnection>()
  private handlers = new Map<string, RegisteredHandler>()
  private localElectronChannels = new Set<string>()
  private nativeOrLocalElectronChannels = new Set<string>()
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private _port = 0
  private _protocol: 'ws' | 'wss' = 'ws'

  /** Recently disconnected clients retained for reconnect replay. */
  private disconnectedClients = new Map<string, { client: ClientConnection; timer: ReturnType<typeof setTimeout> }>()
  /** Requests sent from the server that still await a client response. */
  private pendingInvokes = new Map<string, PendingInvoke>()

  private readonly host: string
  private readonly requestedPort: number
  private readonly requireAuth: boolean
  private readonly workspaceAuthority: WorkspaceAuthorityAuthentication | null
  private readonly validateToken: ((token: string) => Promise<boolean>) | null
  private readonly validateSessionCookie: ((cookieHeader: string | null) => Promise<boolean>) | null
  private readonly serverId: string
  private readonly tlsOptions: WsRpcTlsOptions | null
  private readonly serverVersion: string
  private readonly maxClients: number
  private readonly onClientConnected: WsRpcServerOptions['onClientConnected']
  private readonly onClientDisconnected: WsRpcServerOptions['onClientDisconnected']
  private readonly resolveLocalClientBinding: WsRpcServerOptions['resolveLocalClientBinding']
  private readonly httpHandler: WsRpcServerOptions['httpHandler']
  private readonly rpcCallCounter: RpcCallCounter | null
  private readonly nativeAuthority: NativeAuthority | null
  private readonly nativeEventChannels: ReadonlySet<string>
  private readonly nativeClientEventChannels: ReadonlySet<string>
  private readonly projectNativeEvent: WsRpcServerOptions['projectNativeEvent']
  private readonly disposeAuthorityListener: (() => void) | null
  private readonly shutdownHooks = new Set<() => void>()
  private readonly disconnectHooks = new Set<(clientId: string) => void>()
  private readonly requestContexts = new WeakMap<RequestContext, {
    socket: WebSocket
    registration: RegisteredHandler
    fence: string | null
  }>()

  constructor(opts?: WsRpcServerOptions) {
    this.host = opts?.host ?? '127.0.0.1'
    this.requestedPort = opts?.port ?? 0
    if (opts && Object.hasOwn(opts, 'workspaceAuthority') && (!opts.workspaceAuthority
      || typeof opts.workspaceAuthority.authenticate !== 'function'
      || typeof opts.workspaceAuthority.revalidate !== 'function')) {
      throw new Error('Explicit workspace authority resolver required')
    }
    if (opts?.workspaceAuthority && (opts.validateToken || opts.validateSessionCookie || opts.resolveLocalClientBinding)) {
      throw new Error('Workspace authority cannot accept legacy or local authentication alternatives')
    }
    this.workspaceAuthority = opts?.workspaceAuthority ?? null
    this.requireAuth = this.workspaceAuthority !== null || (opts?.requireAuth ?? false)
    this.validateToken = opts?.validateToken ?? null
    this.validateSessionCookie = opts?.validateSessionCookie ?? null
    this.serverId = opts?.serverId ?? 'local'
    this.serverVersion = opts?.serverVersion ?? ''
    this.tlsOptions = opts?.tls ?? null
    this.maxClients = opts?.maxClients ?? 50
    this.onClientConnected = opts?.onClientConnected
    this.onClientDisconnected = opts?.onClientDisconnected
    this.resolveLocalClientBinding = opts?.resolveLocalClientBinding
    this.httpHandler = opts?.httpHandler
    this.nativeAuthority = opts?.nativeAuthority ?? null
    this.nativeEventChannels = new Set(opts?.nativeEventChannels ?? [])
    this.nativeClientEventChannels = new Set(opts?.nativeClientEventChannels ?? [])
    this.projectNativeEvent = opts?.projectNativeEvent
    this.disposeAuthorityListener = this.nativeAuthority?.onInvalidation(event => {
      for (const client of this.clients.values()) {
        if (client.principal?.subject !== event.subject) continue
        client.eventBuffer.length = 0
        client.subscriptionFence = null
      }
      for (const { client } of this.disconnectedClients.values()) {
        if (client.principal?.subject !== event.subject) continue
        client.eventBuffer.length = 0
        client.subscriptionFence = null
      }
    }) ?? null
    this.rpcCallCounter = opts?.rpcCallCounter === undefined
      ? createRpcCallCounterFromEnv()
      : opts.rpcCallCounter
  }

  /** The actual port the server is listening on (available after listen()). */
  get port(): number {
    return this._port
  }

  /** The protocol the server is using: 'wss' when TLS is configured, 'ws' otherwise. */
  get protocol(): 'ws' | 'wss' {
    return this._protocol
  }

  /** Number of currently connected (handshake-completed) clients. */
  getConnectedClientCount(): number {
    return this.clients.size
  }

  getRpcCallCounter(): RpcCallCounter | null {
    return this.rpcCallCounter
  }

  // -------------------------------------------------------------------------
  // RpcServer interface
  // -------------------------------------------------------------------------

  handle(channel: string, handler: HandlerFn, options?: RpcHandlerOptions): void {
    if (this.handlers.has(channel)) {
      throw new Error(`Handler already registered for channel: ${channel}`)
    }
    const access = options?.access
    if (options?.beforeWorkspaceResponse && (access !== 'authenticatedWorkspace' || !this.workspaceAuthority)) {
      throw new Error('Joint workspace response guard requires authenticatedWorkspace access and shared authority')
    }
    const timeoutMs = options?.timeoutMs ?? WsRpcServer.HANDLER_TIMEOUT_MS
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 240_000) throw new Error('Invalid handler timeout')
    this.handlers.set(channel, { handler, access, nativeAction: options?.nativeAction, timeoutMs,
      beforeResponse: options?.beforeResponse, beforeWorkspaceResponse: options?.beforeWorkspaceResponse })
    if (access === 'localElectron') {
      this.localElectronChannels.add(channel)
    }
    if (access === 'nativeOrLocalElectron') this.nativeOrLocalElectronChannels.add(channel)
  }

  private registeredChannelsFor(client: ClientConnection): string[] {
    return [...this.handlers].flatMap(([channel, registration]) => {
      if (registration.access === 'localElectron' && !client.localBinding) return []
      if (!this.canRequest(client, registration)) return []
      return [channel]
    })
  }

  private assertWorkspaceSession(bound: WorkspaceAuthoritySession, workspaceId: string): void {
    const { actor, identity } = bound
    if (!actor || !identity || !identity.issuer || !identity.subject
      || actor.principalId !== identity.principalId || actor.sessionId !== identity.sessionId
      || actor.deviceId !== identity.deviceId || actor.expiresAt !== identity.expiresAt
      || !actor.sessionId || !actor.deviceId || !Number.isFinite(actor.expiresAt)
      || actor.expiresAt <= Date.now() || !Array.isArray(actor.authenticatedWorkspaceIds)) {
      throw new CodedError('AUTH_FAILED', 'Authentication required')
    }
    if (!actor.authenticatedWorkspaceIds.includes(workspaceId)) throw new CodedError('FORBIDDEN', 'Request denied')
  }

  private sameWorkspaceIdentity(left: WorkspaceAuthoritySession, right: WorkspaceAuthoritySession): boolean {
    return left.identity.issuer === right.identity.issuer && left.identity.subject === right.identity.subject
      && left.identity.principalId === right.identity.principalId && left.identity.sessionId === right.identity.sessionId
      && left.identity.deviceId === right.identity.deviceId
  }

  private async refreshWorkspaceClient(client: ClientConnection): Promise<WorkspaceAuthoritySession> {
    const resolver = this.workspaceAuthority
    const previous = client.workspaceSession
    if (!resolver || !previous || !client.workspaceId) throw new CodedError('AUTH_FAILED', 'Authentication required')
    let current: WorkspaceAuthoritySession
    try { current = await resolver.revalidate(previous) }
    catch { throw new CodedError('AUTH_FAILED', 'Authentication required') }
    if (!this.sameWorkspaceIdentity(previous, current)) throw new CodedError('AUTH_FAILED', 'Authentication required')
    this.assertWorkspaceSession(current, client.workspaceId)
    client.workspaceSession = current
    return current
  }

  private canRequest(client: ClientConnection, registration: RegisteredHandler): boolean {
    if (client.workspaceSession) {
      if (!this.workspaceAuthority || registration.access !== 'authenticatedWorkspace' || client.principal || client.localBinding || !client.workspaceId) return false
      try { this.assertWorkspaceSession(client.workspaceSession, client.workspaceId); return true } catch { return false }
    }
    if (registration.access === 'authenticatedWorkspace' || this.workspaceAuthority) return false
    if (client.localBinding && !this.hasCurrentLocalBinding(client)) return false
    if (registration.access === 'localElectron' && !this.hasCurrentLocalBinding(client)) return false
    if (registration.access === 'nativeOrLocalElectron' && !client.principal && !this.hasCurrentLocalBinding(client)) return false
    if (client.principal) {
      return !!client.workspaceId && !!registration.nativeAction
        && !!this.nativeAuthority?.authorize(client.principal, client.workspaceId, 'read')
        && !!this.nativeAuthority?.authorize(client.principal, client.workspaceId, registration.nativeAction)
    }
    return !this.nativeAuthority?.hasRegisteredWorkspaces()
  }

  private requestPermissionFence(client: ClientConnection, registration: RegisteredHandler): string | null {
    if (!client.principal || !client.workspaceId || !registration.nativeAction || !this.nativeAuthority) return null
    const readFence = this.nativeAuthority.permissionFence(client.principal, client.workspaceId, 'read')
    if (!readFence || registration.nativeAction === 'read') return readFence
    const actionFence = this.nativeAuthority.permissionFence(client.principal, client.workspaceId, registration.nativeAction)
    return actionFence ? `${readFence}:${actionFence}` : null
  }

  private canReturnResponse(
    client: ClientConnection,
    registration: RegisteredHandler,
    ctx: RequestContext,
    requestFence: string | null,
  ): boolean {
    return client.workspaceId === ctx.workspaceId
      && client.webContentsId === ctx.webContentsId
      && (client.principal ?? undefined) === ctx.principal
      && this.canRequest(client, registration)
      && this.requestPermissionFence(client, registration) === requestFence
  }

  private refreshSubscription(client: ClientConnection): boolean {
    if (!client.principal || !client.workspaceId || !this.nativeAuthority) return false
    const readFence = this.nativeAuthority.permissionFence(client.principal, client.workspaceId, 'read')
    const subscribeFence = this.nativeAuthority.permissionFence(client.principal, client.workspaceId, 'subscribe')
    const fence = readFence && subscribeFence ? `${readFence}:${subscribeFence}` : null
    if (fence !== client.subscriptionFence) {
      client.eventBuffer.length = 0
      client.subscriptionFence = fence
    }
    return fence !== null
  }

  private canReceiveEvent(client: ClientConnection, channel: string, target: PushTarget): boolean {
    if (client.localBinding && !this.hasCurrentLocalBinding(client)) {
      client.eventBuffer.length = 0
      client.subscriptionFence = null
      return false
    }
    if (client.principal) {
      return target.to !== 'all'
        && (!this.nativeClientEventChannels.has(channel) || target.to === 'client')
        && this.nativeEventChannels.has(channel) && this.refreshSubscription(client)
    }
    return !this.nativeAuthority?.hasRegisteredWorkspaces()
  }

  private bindingCandidate(envelope: MessageEnvelope): LocalClientBindingCandidate {
    const rawWebContentsId = envelope.webContentsId
    return {
      workspaceId: typeof envelope.workspaceId === 'string' ? envelope.workspaceId : null,
      webContentsId: typeof rawWebContentsId === 'number' && Number.isSafeInteger(rawWebContentsId)
        ? rawWebContentsId
        : null,
      localClientProof: typeof envelope.localClientProof === 'string' ? envelope.localClientProof : null,
    }
  }

  private resolveBinding(candidate: LocalClientBindingCandidate): TrustedLocalClientBinding | null {
    try {
      const binding = this.resolveLocalClientBinding?.(candidate) ?? null
      return isTrustedLocalClientBinding(binding) ? binding : null
    } catch {
      return null
    }
  }

  private hasCurrentLocalBinding(client: ClientConnection): boolean {
    if (!client.localBinding) return false
    const current = this.resolveBinding(client.localBindingCandidate)
    return !!current
      && current.workspaceId === client.localBinding.workspaceId
      && current.webContentsId === client.localBinding.webContentsId
      && current.workspaceId === client.workspaceId
      && current.webContentsId === client.webContentsId
  }

  push(channel: string, target: PushTarget, ...args: any[]): void {
    if (this.workspaceAuthority) {
      throw new CodedError('CAPABILITY_UNAVAILABLE', 'Shared generic push is unavailable; use authorized domain replay')
    }
    const timestamp = Date.now()

    for (const client of this.clients.values()) {
      if (!this.matchesTarget(client, target)) continue
      if (!this.canReceiveEvent(client, channel, target)) continue
      const projected = client.principal && client.workspaceId && this.projectNativeEvent
        ? this.projectNativeEvent(channel, args, client.workspaceId, client.principal) : args
      if (projected) this.bufferAndMaybeSendEvent(client, channel, [...projected], timestamp, true)
    }

    for (const { client } of this.disconnectedClients.values()) {
      if (!this.matchesTarget(client, target)) continue
      if (!this.canReceiveEvent(client, channel, target)) continue
      const projected = client.principal && client.workspaceId && this.projectNativeEvent
        ? this.projectNativeEvent(channel, args, client.workspaceId, client.principal) : args
      if (projected) this.bufferAndMaybeSendEvent(client, channel, [...projected], timestamp, false)
    }
  }

  hasClientCapability(clientId: string, capability: string): boolean {
    const client = this.clients.get(clientId)
    return !!client && !client.principal && !this.nativeAuthority?.hasRegisteredWorkspaces()
      && (!client.localBinding || this.hasCurrentLocalBinding(client))
      && client.capabilities.has(capability)
  }

  findClientsWithCapability(capability: string, opts?: { workspaceId?: string }): string[] {
    const results: string[] = []
    for (const [clientId, client] of this.clients) {
      if (!client.capabilities.has(capability)) continue
      if (client.principal || this.nativeAuthority?.hasRegisteredWorkspaces()) continue
      if (client.localBinding && !this.hasCurrentLocalBinding(client)) continue
      if (opts?.workspaceId !== undefined && client.workspaceId !== opts.workspaceId) continue
      results.push(clientId)
    }
    return results
  }

  invokeClient(clientId: string, channel: string, ...args: any[]): Promise<any> {
    if (this.workspaceAuthority) {
      return Promise.reject(new CodedError('CAPABILITY_UNAVAILABLE', 'Shared client invocation is unavailable'))
    }
    return new Promise((resolve, reject) => {
      const client = this.clients.get(clientId)

      // Check connection
      if (!client) {
        const err = new Error(`Client not connected: ${clientId}`)
        ;(err as any).code = 'CLIENT_DISCONNECTED'
        reject(err)
        return
      }
      if (client.principal || this.nativeAuthority?.hasRegisteredWorkspaces()
        || client.localBinding && !this.hasCurrentLocalBinding(client)) {
        reject(Object.assign(new Error('Native clients do not expose legacy capabilities'), { code: 'AUTH_FAILED' }))
        return
      }

      // Check capability
      if (!client.capabilities.has(channel)) {
        const err = new Error(`Client lacks capability: ${channel}`)
        ;(err as any).code = 'CAPABILITY_UNAVAILABLE'
        reject(err)
        return
      }

      const id = randomUUID()
      const timeout = setTimeout(() => {
        this.pendingInvokes.delete(id)
        const err = new Error(`Client request timeout: ${channel} (30000ms)`)
        ;(err as any).code = 'CLIENT_REQUEST_TIMEOUT'
        reject(err)
      }, 30_000)

      this.pendingInvokes.set(id, { clientId, resolve, reject, timeout })

      const envelope: MessageEnvelope = {
        id,
        type: 'request',
        channel,
        args,
        serverId: this.serverId,
      }
      this.safeSend(client.ws, serializeEnvelope(envelope))
    })
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async listen(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.tlsOptions) {
        // TLS mode: create HTTPS server, attach WebSocketServer to it.
        // When httpHandler is set, regular HTTP requests are served by it
        // (e.g. WebUI), while ws intercepts WebSocket upgrade requests.
        this._protocol = 'wss'
        this.httpsServer = createHttpsServer(
          {
            cert: this.tlsOptions.cert,
            key: this.tlsOptions.key,
            ca: this.tlsOptions.ca,
            passphrase: this.tlsOptions.passphrase,
          },
          this.httpHandler,
        )

        this.wss = new WebSocketServer({ server: this.httpsServer })

        this.httpsServer.on('error', (err) => reject(err))

        this.httpsServer.listen(this.requestedPort, this.host, () => {
          const addr = this.httpsServer!.address()
          if (typeof addr === 'object' && addr) {
            this._port = addr.port
          }
          this.startHeartbeat()
          resolve()
        })
      } else if (this.httpHandler) {
        // Plain WS + HTTP handler: create an HTTP server for both.
        this._protocol = 'ws'
        this.httpServer = createHttpServer(this.httpHandler)
        this.wss = new WebSocketServer({ server: this.httpServer })

        this.httpServer.on('error', (err) => reject(err))

        this.httpServer.listen(this.requestedPort, this.host, () => {
          const addr = this.httpServer!.address()
          if (typeof addr === 'object' && addr) {
            this._port = addr.port
          }
          this.startHeartbeat()
          resolve()
        })
      } else {
        // Plain WS mode, no HTTP handler
        this._protocol = 'ws'
        this.wss = new WebSocketServer({
          host: this.host,
          port: this.requestedPort,
        })

        this.wss.on('listening', () => {
          const addr = this.wss!.address()
          if (typeof addr === 'object' && addr) {
            this._port = addr.port
          }
          this.startHeartbeat()
          resolve()
        })

        this.wss.on('error', (err) => {
          reject(err)
        })
      }

      this.wss.on('connection', (ws, req) => {
        this.onConnection(ws, req.headers.cookie ?? null, req.socket.remoteAddress ?? null)
      })
    })
  }

  onShutdown(dispose: () => void): () => void {
    this.shutdownHooks.add(dispose)
    return () => this.shutdownHooks.delete(dispose)
  }

  onClientDisconnect(listener: (clientId: string) => void): () => void {
    this.disconnectHooks.add(listener)
    return () => this.disconnectHooks.delete(listener)
  }

  isRequestContextCurrent(ctx: RequestContext, nativeAction?: RpcHandlerOptions['nativeAction']): boolean {
    const bound = this.requestContexts.get(ctx)
    const client = this.clients.get(ctx.clientId)
    if (!bound || !client || client.ws !== bound.socket || client.ws.readyState !== 1) return false
    if (nativeAction && ctx.principal && nativeAction !== 'read' && bound.registration.nativeAction !== nativeAction) return false
    return this.canReturnResponse(client, bound.registration, ctx, bound.fence)
  }

  close(): void {
    for (const dispose of this.shutdownHooks) {
      try { dispose() } catch { /* Continue closing the remaining host resources. */ }
    }
    this.shutdownHooks.clear()
    this.disposeAuthorityListener?.()
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    // Reject all pending invokes before tearing down connections
    for (const [id, pending] of this.pendingInvokes) {
      clearTimeout(pending.timeout)
      const err = new Error('Server shutting down')
      ;(err as any).code = 'CLIENT_DISCONNECTED'
      pending.reject(err)
      this.pendingInvokes.delete(id)
    }
    for (const client of this.clients.values()) {
      for (const listener of this.disconnectHooks) {
        try { listener(client.id) } catch { /* Continue disposing the other clients. */ }
      }
      client.ws.terminate()
    }
    this.clients.clear()
    this.disconnectHooks.clear()
    // Clean up disconnected client timers
    for (const entry of this.disconnectedClients.values()) {
      clearTimeout(entry.timer)
    }
    this.disconnectedClients.clear()
    this.wss?.close()
    this.wss = null
    this.httpServer?.close()
    this.httpServer = null
    this.httpsServer?.close()
    this.httpsServer = null
  }

  // -------------------------------------------------------------------------
  // Connection handling
  // -------------------------------------------------------------------------

  private onConnection(ws: WebSocket, upgradeRequestCookie: string | null, remoteAddress: string | null): void {
    // Reject if at capacity
    if (this.maxClients > 0 && this.clients.size >= this.maxClients) {
      transportLog.warn('Connection rejected: at capacity', {
        maxClients: this.maxClients,
        current: this.clients.size,
      })
      ws.close(4008, 'Server at capacity')
      return
    }

    let handshakeCompleted = false
    let sharedHandshakeInProgress = false
    let handshakeTimeout: ReturnType<typeof setTimeout> | null = null

    // Give the client 5 seconds to send a handshake
    handshakeTimeout = setTimeout(() => {
      if (!handshakeCompleted) {
        ws.close(4001, 'Handshake timeout')
      }
    }, 5_000)

    ws.on('message', async (raw) => {
      let envelope: MessageEnvelope
      try {
        envelope = deserializeEnvelope(raw.toString())
      } catch {
        ws.close(4002, 'Invalid JSON')
        return
      }

      if (!handshakeCompleted) {
        if (this.workspaceAuthority && sharedHandshakeInProgress) {
          ws.close(4003, 'Handshake already pending')
          return
        }
        if (envelope.type !== 'handshake') {
          ws.close(4003, 'Expected handshake')
          return
        }

        if (handshakeTimeout && !this.workspaceAuthority) {
          clearTimeout(handshakeTimeout)
          handshakeTimeout = null
        }

        // Protocol version check (required)
        if (!envelope.protocolVersion || typeof envelope.protocolVersion !== 'string') {
          this.sendError(ws, envelope.id, 'PROTOCOL_VERSION_UNSUPPORTED',
            `Missing protocolVersion. Server protocol ${PROTOCOL_VERSION}`)
          ws.close(4004, 'Protocol version unsupported')
          return
        }

        const clientMajor = parseInt(envelope.protocolVersion.split('.')[0] ?? '0', 10)
        const serverMajor = parseInt(PROTOCOL_VERSION.split('.')[0] ?? '0', 10)
        if (clientMajor !== serverMajor) {
          this.sendError(ws, envelope.id, 'PROTOCOL_VERSION_UNSUPPORTED',
            `Server protocol ${PROTOCOL_VERSION}, client ${envelope.protocolVersion}`)
          ws.close(4004, 'Protocol version unsupported')
          return
        }

        // Reserved native credentials never fall back to legacy bearer/cookie auth.
        let principal: NativePrincipal | null = null
        const nativeToken = typeof envelope.token === 'string'
          && (envelope.token.startsWith('na_') || envelope.token.startsWith('ne_'))
        let workspaceSession: WorkspaceAuthoritySession | null = null
        if (this.workspaceAuthority) {
          sharedHandshakeInProgress = true
          const fields = new Set(['id', 'type', 'protocolVersion', 'token', 'workspaceId', 'clientCapabilities', 'reconnectClientId', 'lastSeq'])
          try {
            if (Object.keys(envelope).some(key => !fields.has(key))
              || !Object.hasOwn(envelope, 'token') || !Object.hasOwn(envelope, 'workspaceId')
              || typeof envelope.token !== 'string' || envelope.token.length > 16384
              || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(envelope.token)
              || typeof envelope.workspaceId !== 'string'
              || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(envelope.workspaceId)
              || (envelope.clientCapabilities !== undefined && (!Array.isArray(envelope.clientCapabilities)
                || envelope.clientCapabilities.some(value => typeof value !== 'string')))
              || (envelope.reconnectClientId !== undefined && (typeof envelope.reconnectClientId !== 'string'
                || !envelope.reconnectClientId || !Number.isSafeInteger(envelope.lastSeq) || Number(envelope.lastSeq) < 0))
              || (envelope.lastSeq !== undefined && envelope.reconnectClientId === undefined)) {
              throw new CodedError('AUTH_FAILED', 'Authentication required')
            }
            workspaceSession = await this.workspaceAuthority.authenticate(envelope.token)
            workspaceSession = await this.workspaceAuthority.revalidate(workspaceSession)
            // workspaceId is only route selection; effective scope comes from current persisted membership.
            this.assertWorkspaceSession(workspaceSession, envelope.workspaceId)
          } catch {
            this.sendError(ws, envelope.id, 'AUTH_FAILED', 'Authentication required')
            ws.close(4005, 'Auth failed')
            if (handshakeTimeout) clearTimeout(handshakeTimeout)
            return
          }
          if (ws.readyState !== ws.OPEN) return
          if (this.maxClients > 0 && this.clients.size >= this.maxClients) {
            ws.close(4008, 'Server at capacity')
            return
          }
          if (handshakeTimeout) { clearTimeout(handshakeTimeout); handshakeTimeout = null }
        } else if (nativeToken) {
          const loopback = remoteAddress === '127.0.0.1' || remoteAddress === '::1'
            || remoteAddress === '::ffff:127.0.0.1'
          if (this._protocol !== 'wss' && !loopback) {
            this.sendError(ws, envelope.id, 'TLS_REQUIRED', 'Native credentials require TLS')
            ws.close(4005, 'TLS required')
            return
          }
          principal = this.nativeAuthority?.authenticate(envelope.token!) ?? null
          if (!principal) {
            this.sendError(ws, envelope.id, 'AUTH_FAILED', 'Invalid native credential')
            ws.close(4005, 'Auth failed')
            return
          }
        } else if (this.requireAuth) {
          let authenticated = false
          if (envelope.token && this.validateToken) {
            authenticated = await this.validateToken(envelope.token)
          }
          if (!authenticated && this.validateSessionCookie && upgradeRequestCookie) {
            authenticated = await this.validateSessionCookie(upgradeRequestCookie)
          }
          if (!authenticated) {
            this.sendError(ws, envelope.id, 'AUTH_FAILED', 'Authentication required')
            ws.close(4005, 'Auth failed')
            return
          }
        }

        const localBindingCandidate = this.bindingCandidate(envelope)
        const localBinding = this.workspaceAuthority ? null : this.resolveBinding(localBindingCandidate)
        const workspaceId = localBinding?.workspaceId ?? envelope.workspaceId ?? null
        const webContentsId = this.workspaceAuthority ? null : localBinding?.webContentsId ?? envelope.webContentsId ?? null
        if (!workspaceSession && (principal
          ? !workspaceId || !this.nativeAuthority?.authorize(principal, workspaceId, 'read')
          : !!workspaceId && !!this.nativeAuthority?.isRegisteredWorkspace(workspaceId))) {
          this.sendError(ws, envelope.id, 'AUTH_FAILED', 'Workspace access denied')
          ws.close(4005, 'Workspace access denied')
          return
        }

        // ── Reconnect attempt ──
        if (envelope.reconnectClientId && envelope.lastSeq != null) {
          const entry = this.disconnectedClients.get(envelope.reconnectClientId)
          if (entry) {
            const prevClient = entry.client

            if (this.workspaceAuthority && workspaceSession && prevClient.workspaceSession
              && prevClient.workspaceId === workspaceId
              && this.sameWorkspaceIdentity(prevClient.workspaceSession, workspaceSession)) {
              // Shared replay is never sourced from a transport buffer. Current authorized
              // domain.events handles durable replay; refresh is mandatory even for identical identity.
              clearTimeout(entry.timer)
              prevClient.ws = ws
              prevClient.workspaceSession = workspaceSession
              prevClient.capabilities.clear()
              prevClient.alive = true
              prevClient.missedPongs = 0
              prevClient.eventBuffer = []
              prevClient.lastAckedSeq = 0
              prevClient.lastSentSeq = 0
              handshakeCompleted = true
              this.disconnectedClients.delete(prevClient.id)
              this.clients.set(prevClient.id, prevClient)
              this.safeSend(ws, serializeEnvelope({ id: envelope.id, type: 'handshake_ack',
                protocolVersion: PROTOCOL_VERSION, serverVersion: this.serverVersion || undefined,
                clientId: prevClient.id, workspaceId: prevClient.workspaceId ?? undefined,
                registeredChannels: this.registeredChannelsFor(prevClient), reconnected: true, stale: true }))
              this.setupClientHandlers(ws, prevClient)
              this.onClientConnected?.({ clientId: prevClient.id, workspaceId: prevClient.workspaceId,
                webContentsId: null, capabilities: [], isLocalElectronClient: false })
              return
            }

            // A reconnect must prove the same effective identity. In particular,
            // an old local client cannot reconnect without renewing its
            // Electron-main binding proof.
            const identityMatch =
              this.workspaceAuthority === null
              && prevClient.workspaceSession === null
              && prevClient.workspaceId === workspaceId
              && prevClient.webContentsId === webContentsId
              && (
                prevClient.principal === null && principal === null
                || !!principal && prevClient.principal?.issuer === principal.issuer
                  && prevClient.principal.subject === principal.subject
                  && prevClient.principal.credentialId === principal.credentialId
                  && prevClient.principal.credentialVersion === principal.credentialVersion
              )
              && (
                (prevClient.localBinding === null && localBinding === null)
                || (
                  prevClient.localBinding?.workspaceId === localBinding?.workspaceId
                  && prevClient.localBinding?.webContentsId === localBinding?.webContentsId
                )
              )
            if (identityMatch) {
              // Valid reconnect — prepare client state but do NOT add to
              // this.clients yet. The client stays in disconnectedClients
              // during replay so that push() can't interleave new events
              // between replayed ones. (Currently safe due to Node.js
              // single-threading, but this ordering makes the invariant
              // explicit and future-proof.)
              clearTimeout(entry.timer)

              prevClient.ws = ws
              prevClient.principal = principal
              prevClient.localBinding = localBinding
              prevClient.localBindingCandidate = localBindingCandidate
              if (principal) this.refreshSubscription(prevClient)
              prevClient.alive = true
              prevClient.missedPongs = 0
              handshakeCompleted = true

              // Determine replay vs stale using the per-client delivery sequence.
              // Retained buffers continue collecting events while the client is disconnected,
              // but TTL eviction still applies during the reconnect window.
              this.evictBuffer(prevClient)

              const lastSeq = envelope.lastSeq as number
              const hasMissedEvents = lastSeq < prevClient.lastSentSeq
              const firstBufferedSeq = prevClient.eventBuffer[0]?.seq
              const canReplay = !hasMissedEvents
                ? true
                : firstBufferedSeq != null && lastSeq >= firstBufferedSeq - 1

              if (canReplay) {
                const replayEvents = prevClient.eventBuffer.filter(e => e.seq > lastSeq)

                const ack: MessageEnvelope = {
                  id: envelope.id,
                  type: 'handshake_ack',
                  protocolVersion: PROTOCOL_VERSION,
                  serverVersion: this.serverVersion || undefined,
                  clientId: prevClient.id,
                  registeredChannels: this.registeredChannelsFor(prevClient),
                  reconnected: true,
                }
                this.safeSend(ws, serializeEnvelope(ack))

                // Replay missed events in order
                for (const event of replayEvents) {
                  this.safeSend(ws, event.data)
                }

                transportLog.info('Client reconnected with replay', {
                  clientId: prevClient.id,
                  replayedCount: replayEvents.length,
                  lastSeq,
                })
              } else {
                // Buffer evicted — client must full-refresh
                const ack: MessageEnvelope = {
                  id: envelope.id,
                  type: 'handshake_ack',
                  protocolVersion: PROTOCOL_VERSION,
                  serverVersion: this.serverVersion || undefined,
                  clientId: prevClient.id,
                  registeredChannels: this.registeredChannelsFor(prevClient),
                  reconnected: true,
                  stale: true,
                }
                this.safeSend(ws, serializeEnvelope(ack))

                transportLog.info('Client reconnected as stale', {
                  clientId: prevClient.id,
                  lastSeq,
                  firstBufferedSeq,
                  lastSentSeq: prevClient.lastSentSeq,
                })
              }

              // Atomic state transition: move from disconnected → active
              // AFTER replay is complete so push() can't target this client mid-replay.
              this.disconnectedClients.delete(envelope.reconnectClientId)
              this.clients.set(prevClient.id, prevClient)

              this.setupClientHandlers(ws, prevClient)
              this.onClientConnected?.({
                clientId: prevClient.id,
                webContentsId: prevClient.webContentsId,
                workspaceId: prevClient.workspaceId,
                capabilities: [...prevClient.capabilities],
                isLocalElectronClient: prevClient.localBinding !== null,
              })
              return
            }

            // Identity mismatch — fall through to fresh connect
            transportLog.warn('Reconnect identity mismatch', {
              reconnectClientId: envelope.reconnectClientId,
            })
          }
          // reconnectClientId not found — fall through to fresh connect
        }

        // ── Normal fresh connect ──
        const clientId = randomUUID()
        const client: ClientConnection = {
          id: clientId,
          ws,
          workspaceId,
          webContentsId,
          localBinding,
          localBindingCandidate,
          principal,
          subscriptionFence: null,
          workspaceSession,
          capabilities: new Set(principal || workspaceSession ? [] : envelope.clientCapabilities ?? []),
          missedPongs: 0,
          alive: true,
          eventBuffer: [],
          lastAckedSeq: 0,
          lastSentSeq: 0,
        }
        if (principal) this.refreshSubscription(client)
        this.clients.set(clientId, client)
        handshakeCompleted = true

        // Send handshake_ack
        const ack: MessageEnvelope = {
          id: envelope.id,
          type: 'handshake_ack',
          protocolVersion: PROTOCOL_VERSION,
          serverVersion: this.serverVersion || undefined,
          clientId,
          registeredChannels: this.registeredChannelsFor(client),
          webContentsId: client.webContentsId ?? undefined,
          workspaceId: client.workspaceId ?? undefined,
          stale: this.workspaceAuthority && envelope.reconnectClientId ? true : undefined,
        }
        this.safeSend(ws, serializeEnvelope(ack))

        transportLog.info('Client connected', {
          clientId,
          webContentsId: client.webContentsId,
          workspaceId: client.workspaceId,
        })
        this.onClientConnected?.({
          clientId,
          webContentsId: client.webContentsId,
          workspaceId: client.workspaceId,
          capabilities: [...client.capabilities],
          isLocalElectronClient: client.localBinding !== null,
        })

        this.setupClientHandlers(ws, client)
        return
      }

      // Post-handshake: find the client for this ws
      const client = this.findClientByWs(ws)
      if (!client) {
        ws.close(4006, 'Unknown client')
        return
      }

      if (envelope.type === 'request') {
        await this.onRequest(client, envelope)
      } else if (envelope.type === 'response') {
        this.onClientResponse(envelope)
      } else if (envelope.type === 'sequence_ack') {
        const ackSeq = envelope.lastSeq
        if (typeof ackSeq === 'number' && ackSeq > client.lastAckedSeq) {
          client.lastAckedSeq = ackSeq
          // Evict acknowledged events
          const buf = client.eventBuffer
          let removeCount = 0
          while (removeCount < buf.length && buf[removeCount]!.seq <= ackSeq) {
            removeCount++
          }
          if (removeCount > 0) {
            buf.splice(0, removeCount)
          }
        }
      }
    })

    ws.on('close', () => {
      if (this.workspaceAuthority && handshakeTimeout) clearTimeout(handshakeTimeout)
    })
    ws.on('error', () => {
      // Connection errors are handled by the close event
    })
  }

  // -------------------------------------------------------------------------
  // Request dispatching
  // -------------------------------------------------------------------------

  /** Server-side timeout for RPC handler execution (ms). */
  private static readonly HANDLER_TIMEOUT_MS = 60_000

  private shouldEnforceLocalOnly(): boolean {
    if (this.requireAuth) return true
    const host = this.host
    return host !== '127.0.0.1' && host !== 'localhost' && host !== '::1'
  }

  private async onRequest(client: ClientConnection, envelope: MessageEnvelope): Promise<void> {
    const { channel, id, args } = envelope

    if (!channel) {
      this.sendResponseError(client.ws, id, undefined, 'CHANNEL_NOT_FOUND', 'Missing channel')
      return
    }

    // Local-Electron channels are denied before consulting the handler map.
    // This protects accidental registration in a remote/headless profile and
    // makes unbound clients observe the same result as an absent channel.
    if (!this.hasCurrentLocalBinding(client) && this.localElectronChannels.has(channel)) {
      this.sendResponseError(client.ws, id, channel, 'CHANNEL_NOT_FOUND', `No handler for: ${channel}`)
      return
    }
    if (!client.principal && !this.hasCurrentLocalBinding(client) && this.nativeOrLocalElectronChannels.has(channel)) {
      this.sendResponseError(client.ws, id, channel, 'CHANNEL_NOT_FOUND', `No handler for: ${channel}`)
      return
    }

    const registration = this.handlers.get(channel)
    if (!registration) {
      this.sendResponseError(client.ws, id, channel, 'CHANNEL_NOT_FOUND', `No handler for: ${channel}`)
      return
    }
    if ((registration.access === 'authenticatedWorkspace' && !client.workspaceSession)
      || (this.workspaceAuthority && registration.access !== 'authenticatedWorkspace')) {
      this.sendResponseError(client.ws, id, channel, 'CHANNEL_NOT_FOUND', `No handler for: ${channel}`)
      return
    }
    if (!this.canRequest(client, registration)) {
      this.sendResponseError(client.ws, id, channel, 'AUTH_FAILED', this.workspaceAuthority ? 'Request failed' : 'Workspace permission denied')
      return
    }
    if (this.workspaceAuthority && args !== undefined && !Array.isArray(args)) {
      this.sendResponseError(client.ws, id, channel, 'INVALID_PAYLOAD', 'Request failed')
      return
    }
    this.rpcCallCounter?.record(channel)

    // LOCAL_ONLY is a desktop-process gate, not a second handshake
    // capability. Electron-main proof (`localBinding`) already means
    // this client is the trusted desktop. `openFileDialog` remains a
    // fallback for tests that only advertise that capability.
    if (
      isLocalOnly(channel)
      && this.shouldEnforceLocalOnly()
      && client.localBinding === null
      && !client.capabilities.has(CLIENT_OPEN_FILE_DIALOG)
    ) {
      this.sendResponseError(
        client.ws,
        id,
        channel,
        'LOCAL_ONLY_DENIED',
        'Channel is only available to the local desktop client',
      )
      return
    }

    let ctx: RequestContext = {
      clientId: client.id,
      workspaceId: client.workspaceId,
      webContentsId: client.webContentsId,
      principal: client.principal ?? undefined,
    }
    const requestFence = this.requestPermissionFence(client, registration)
    if (client.principal && !requestFence) {
      this.sendResponseError(client.ws, id, channel, 'AUTH_FAILED', 'Workspace permission denied')
      return
    }

    let handlerTimeout: ReturnType<typeof setTimeout> | undefined
    try {
      const current = this.workspaceAuthority ? await this.refreshWorkspaceClient(client) : null
      ctx = {
        clientId: client.id, workspaceId: client.workspaceId, webContentsId: client.webContentsId,
        principal: client.principal ?? undefined,
        ...(current ? { actor: current.actor } : {}),
      }
      this.requestContexts.set(ctx, { socket: client.ws, registration, fence: requestFence })
      const result = await Promise.race([
        registration.handler(ctx, ...(args ?? [])),
        new Promise<never>((_, reject) =>
          handlerTimeout = setTimeout(() => {
            this.requestContexts.delete(ctx)
            reject(new Error(`Handler timeout: ${channel} (${registration.timeoutMs}ms)`))
          }, registration.timeoutMs),
        ),
      ])
      if (!this.canReturnResponse(client, registration, ctx, requestFence)) {
        this.sendResponseError(client.ws, id, channel, 'AUTH_FAILED', this.workspaceAuthority ? 'Request failed' : 'Workspace permission changed')
        return
      }
      const response: MessageEnvelope = {
        id,
        type: 'response',
        channel,
        result,
      }
      const outbound = this.workspaceAuthority ? await this.refreshWorkspaceClient(client) : null
      if (!this.canReturnResponse(client, registration, ctx, requestFence)) throw new CodedError('AUTH_FAILED', 'Workspace permission changed')
      if (registration.beforeResponse) {
        const guardedOutbound = this.workspaceAuthority ? await this.refreshWorkspaceClient(client) : outbound
        if (!this.canReturnResponse(client, registration, ctx, requestFence)) throw new CodedError('AUTH_FAILED', 'Workspace permission changed')
        await registration.beforeResponse({ ...ctx, ...(guardedOutbound ? { actor: guardedOutbound.actor } : {}) }, args ?? [], result)
        // Preserve native grant generations and the original caller binding
        // across every asynchronous host check.
        if (!this.canReturnResponse(client, registration, ctx, requestFence)) throw new CodedError('AUTH_FAILED', 'Workspace permission changed')
      }
      if (registration.beforeWorkspaceResponse) {
        // The final trusted admission checks live session/membership AND Resource
        // permission together. An identity-only await after it would stale that
        // Resource verdict, so this branch has no later asynchronous operation.
        const guardedOutbound = await this.refreshWorkspaceClient(client)
        if (!this.canReturnResponse(client, registration, ctx, requestFence)) throw new CodedError('AUTH_FAILED', 'Workspace permission changed')
        await registration.beforeWorkspaceResponse({ ...ctx, actor: guardedOutbound.actor }, args ?? [], result)
        if (!this.canReturnResponse(client, registration, ctx, requestFence)) throw new CodedError('AUTH_FAILED', 'Workspace permission changed')
      } else if (this.workspaceAuthority) {
        // Ordinary host checks can await while a session is revoked or replaced.
        // Re-admit its original identity before invoking any result serializer.
        await this.refreshWorkspaceClient(client)
        if (!this.canReturnResponse(client, registration, ctx, requestFence)) throw new CodedError('AUTH_FAILED', 'Workspace permission changed')
      }
      const data = serializeEnvelope(response)
      if (!this.canReturnResponse(client, registration, ctx, requestFence)) throw new CodedError('AUTH_FAILED', 'Workspace permission changed')
      this.safeSend(client.ws, data)
    } catch (err) {
      if (!this.canReturnResponse(client, registration, ctx, requestFence)) {
        this.sendResponseError(client.ws, id, channel, 'AUTH_FAILED', this.workspaceAuthority ? 'Request failed' : 'Workspace permission changed')
        return
      }
      const message = err instanceof Error ? err.message : String(err)
      const rawCode = err && typeof err === 'object' && 'code' in err ? err.code : undefined
      const code: ErrorCode = isErrorCode(rawCode) ? rawCode : 'HANDLER_ERROR'
      this.sendResponseError(client.ws, id, channel, code, this.workspaceAuthority || client.principal ? 'Request failed' : message)
    } finally {
      clearTimeout(handlerTimeout)
    }
  }

  // -------------------------------------------------------------------------
  // Heartbeat
  // -------------------------------------------------------------------------

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      for (const [, client] of this.clients) {
        // Skip sockets that are already closing/closed (e.g. terminated on a previous tick)
        if (client.ws.readyState !== client.ws.OPEN) continue

        if (!client.alive) {
          client.missedPongs++
          if (client.missedPongs >= HEARTBEAT_MAX_MISSED) {
            // Let the close handler (setupClientHandlers) handle all cleanup:
            // clients.delete, buffer retention for reconnect, onClientDisconnected.
            client.ws.terminate()
            continue
          }
        }
        client.alive = false
        client.ws.ping()
      }
    }, HEARTBEAT_INTERVAL_MS)
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Wire up close + pong handlers for a WebSocket ↔ ClientConnection pair. */
  private setupClientHandlers(ws: WebSocket, client: ClientConnection): void {
    ws.on('close', () => {
      if (this.workspaceAuthority && client.ws !== ws) return
      if (this.workspaceAuthority) {
        client.eventBuffer = []
        client.lastAckedSeq = 0
        client.lastSentSeq = 0
      }
      transportLog.info('Client disconnected', { clientId: client.id })
      this.clients.delete(client.id)

      // Retain buffer for potential reconnect
      const timer = setTimeout(() => {
        this.disconnectedClients.delete(client.id)
      }, DISCONNECTED_CLIENT_TTL_MS)
      this.disconnectedClients.set(client.id, { client, timer })

      // Cap disconnectedClients to prevent unbounded growth
      if (this.disconnectedClients.size > 50) {
        const oldestKey = this.disconnectedClients.keys().next().value
        if (oldestKey) {
          const oldest = this.disconnectedClients.get(oldestKey)
          if (oldest) clearTimeout(oldest.timer)
          this.disconnectedClients.delete(oldestKey)
        }
      }

      this.rejectPendingInvokesForClient(client.id)
      this.onClientDisconnected?.(client.id)
      for (const listener of this.disconnectHooks) {
        try { listener(client.id) } catch { /* One disposer must not prevent the others. */ }
      }
    })

    ws.on('pong', () => {
      client.alive = true
      client.missedPongs = 0
    })
  }

  /** Assign a per-client seq, retain the event for replay, and optionally send it immediately. */
  private bufferAndMaybeSendEvent(
    client: ClientConnection,
    channel: string,
    args: any[],
    timestamp: number,
    shouldSend: boolean,
  ): void {
    client.lastSentSeq += 1
    const seq = client.lastSentSeq

    const envelope: MessageEnvelope = {
      id: randomUUID(),
      type: 'event',
      channel,
      args,
      serverId: this.serverId,
      seq,
    }

    const data = serializeEnvelope(envelope)
    client.eventBuffer.push({ seq, data, timestamp })
    this.evictBuffer(client)

    if (shouldSend) {
      this.safeSend(client.ws, data)
    }
  }

  /** Evict stale/oversized entries from a client's event buffer via batch splice. */
  private evictBuffer(client: ClientConnection): void {
    const buf = client.eventBuffer
    if (buf.length === 0) return

    const now = Date.now()
    let removeCount = 0

    // Evict by TTL
    while (removeCount < buf.length &&
           now - buf[removeCount]!.timestamp > EVENT_BUFFER_TTL_MS) {
      removeCount++
    }

    // Evict by size (keep at most EVENT_BUFFER_MAX_SIZE after TTL eviction)
    const remaining = buf.length - removeCount
    if (remaining > EVENT_BUFFER_MAX_SIZE) {
      removeCount += remaining - EVENT_BUFFER_MAX_SIZE
    }

    // Single splice instead of O(n) shift loop
    if (removeCount > 0) {
      buf.splice(0, removeCount)
    }
  }

  private matchesTarget(client: ClientConnection, target: PushTarget): boolean {
    switch (target.to) {
      case 'all':
        return target.exclude ? client.id !== target.exclude : true
      case 'workspace':
        if (target.exclude && client.id === target.exclude) return false
        return client.workspaceId === target.workspaceId
      case 'client':
        return client.id === target.clientId
      default:
        return false
    }
  }

  /**
   * Legacy workspace updates are only valid for unbound remote clients.
   * A local-Electron binding is minted by Electron main and cannot be widened
   * or replaced by a request-path caller.
   */
  updateClientWorkspace(clientId: string, workspaceId: string): void {
    const client = this.clients.get(clientId)
    if (client && !client.localBinding && !client.workspaceSession) {
      if (client.principal
        ? !this.nativeAuthority?.authorize(client.principal, workspaceId, 'read')
        : this.nativeAuthority?.isRegisteredWorkspace(workspaceId)) {
        throw Object.assign(new Error('Workspace permission denied'), { code: 'AUTH_FAILED' })
      }
      client.eventBuffer.length = 0
      client.subscriptionFence = null
      client.workspaceId = workspaceId
    }
  }

  private findClientByWs(ws: WebSocket): ClientConnection | undefined {
    for (const client of this.clients.values()) {
      if (client.ws === ws) return client
    }
    return undefined
  }

  /** Handler/request errors — sent as type:'response' with error field. */
  private sendResponseError(
    ws: WebSocket, id: string, channel: string | undefined,
    code: ErrorCode, message: string,
  ): void {
    const envelope: MessageEnvelope = {
      id,
      type: 'response',
      channel,
      error: { code, message },
    }
    this.safeSend(ws, serializeEnvelope(envelope))
  }

  /** Protocol-level errors only (handshake rejection, version mismatch). May close connection. */
  private sendError(ws: WebSocket, id: string, code: ErrorCode, message: string): void {
    const envelope: MessageEnvelope = {
      id,
      type: 'error',
      error: { code, message },
    }
    this.safeSend(ws, serializeEnvelope(envelope))
  }

  private onClientResponse(envelope: MessageEnvelope): void {
    const pending = this.pendingInvokes.get(envelope.id)
    if (!pending) return

    this.pendingInvokes.delete(envelope.id)
    clearTimeout(pending.timeout)

    if (envelope.error) {
      const err = new Error(envelope.error.message)
      ;(err as any).code = envelope.error.code
      ;(err as any).data = envelope.error.data
      pending.reject(err)
    } else {
      pending.resolve(envelope.result)
    }
  }

  private rejectPendingInvokesForClient(clientId: string): void {
    for (const [id, pending] of this.pendingInvokes) {
      if (pending.clientId !== clientId) continue
      clearTimeout(pending.timeout)
      const err = new Error(`Client disconnected: ${clientId}`)
      ;(err as any).code = 'CLIENT_DISCONNECTED'
      pending.reject(err)
      this.pendingInvokes.delete(id)
    }
  }

  private safeSend(ws: WebSocket, data: string): void {
    if (ws.readyState === ws.OPEN) {
      ws.send(data)
    }
  }
}

function isTrustedLocalClientBinding(value: unknown): value is TrustedLocalClientBinding {
  if (!value || typeof value !== 'object') return false
  if (!('workspaceId' in value) || !('webContentsId' in value)) return false
  const { workspaceId, webContentsId } = value
  return typeof workspaceId === 'string'
    && workspaceId.length > 0
    && typeof webContentsId === 'number'
    && Number.isSafeInteger(webContentsId)
    && webContentsId > 0
}
