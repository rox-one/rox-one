/**
 * f.9 / e2.2 — thin node-mode client.
 *
 * The device half of the node plane: a node process (or test) uses this to
 * join a host as a device, keep its presence alive, and answer invokes. It is
 * a thin shell over the existing `WsRpcClient` — no Electron dependency — so
 * any package (subprocess, service, bridge) can act as a node.
 *
 * Responsibilities:
 * - `register()` — declare the node (caps/commands are CLAIMS; the host holds
 *   the authoritative allowlist);
 * - `heartbeat()` — refresh presence before the host TTL elapses;
 * - `subscribe()` — receive `nodes:invoke` pushes addressed to this connection;
 * - answer each invoke with `nodes:invokeResult` (`ok` payload or a typed
 *   error), which the host fences by connection identity.
 *
 * The node identity is the host-minted connection id: this client never sends
 * a `connId`, because a client cannot name another connection's identity.
 */

import { RPC_CHANNELS } from '@rox/shared/protocol'
import type { PresenceStatus } from './presence.ts'
import type { NodeView } from './registry.ts'
import { WsRpcClient, type WsRpcClientOptions } from '../transport/client.ts'

/** One dispatched command, as pushed by the host on `nodes:invoke`. */
export interface NodeInvokeRequest {
  readonly invokeId: string
  readonly nodeId: string
  readonly command: string
  readonly payload?: unknown
}

/** Result of an invoke handler: the payload, or an error thrown/rejected. */
export type NodeInvokeHandler = (request: NodeInvokeRequest) => Promise<unknown> | unknown

export interface NodeClientOptions {
  /** Host WS URL, e.g. `ws://127.0.0.1:19012`. */
  readonly url: string
  /** Node id declared to the host. */
  readonly nodeId: string
  /** Handles every `nodes:invoke` addressed to this connection. */
  readonly onInvoke: NodeInvokeHandler
  readonly declaredCaps?: readonly string[]
  readonly declaredCommands?: readonly string[]
  readonly kind?: string
  readonly platform?: string
  readonly label?: string
  /** Heartbeat period. Default 10s; must stay below the host presence TTL. */
  readonly heartbeatIntervalMs?: number
  readonly token?: string
  readonly workspaceId?: string
  readonly requestTimeout?: number
  readonly connectTimeout?: number
  readonly autoReconnect?: boolean
}

const DEFAULT_HEARTBEAT_INTERVAL_MS = 10_000

/** Platform interval handle (kept as a named, module-private contract). */
type HeartbeatTimer = ReturnType<typeof setInterval>

/** A node's own error code; string, matching `InvokeErrorCode`. */
function nodeErrorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' && code.length > 0 ? code : 'NODE_ERROR'
}

export class NodeClient {
  private readonly options: NodeClientOptions
  private readonly rpc: WsRpcClient
  private heartbeatTimer: HeartbeatTimer | null = null
  private unlisten: (() => void) | null = null
  private registered = false

  constructor(options: NodeClientOptions) {
    this.options = options
    const clientOptions: WsRpcClientOptions = {
      ...(options.token !== undefined ? { token: options.token } : {}),
      ...(options.workspaceId !== undefined ? { workspaceId: options.workspaceId } : {}),
      ...(options.requestTimeout !== undefined ? { requestTimeout: options.requestTimeout } : {}),
      ...(options.connectTimeout !== undefined ? { connectTimeout: options.connectTimeout } : {}),
      ...(options.autoReconnect !== undefined ? { autoReconnect: options.autoReconnect } : {}),
    }
    this.rpc = new WsRpcClient(options.url, clientOptions)
    this.subscribe()
  }

  /** Raw transport, for tests/embedders that need the connection directly. */
  get client(): WsRpcClient {
    return this.rpc
  }

  /** Subscribe to `nodes:invoke` and answer each push through `onInvoke`. */
  subscribe(): () => void {
    this.unlisten?.()
    this.unlisten = this.rpc.on(RPC_CHANNELS.nodes.INVOKE, (...args: unknown[]) => {
      void this.answer(args[0])
    })
    return this.unlisten
  }

  /** Declare this node to the host and record the returned view. */
  async register(): Promise<NodeView> {
    const view = (await this.rpc.invoke(RPC_CHANNELS.nodes.REGISTER, {
      nodeId: this.options.nodeId,
      ...(this.options.declaredCaps !== undefined ? { declaredCaps: [...this.options.declaredCaps] } : {}),
      ...(this.options.declaredCommands !== undefined ? { declaredCommands: [...this.options.declaredCommands] } : {}),
      ...(this.options.kind !== undefined ? { kind: this.options.kind } : {}),
      ...(this.options.platform !== undefined ? { platform: this.options.platform } : {}),
      ...(this.options.label !== undefined ? { label: this.options.label } : {}),
    })) as NodeView
    this.registered = true
    return view
  }

  /** Refresh presence; the host refuses a superseded connection typed. */
  async heartbeat(): Promise<PresenceStatus> {
    return (await this.rpc.invoke(RPC_CHANNELS.nodes.PRESENCE, { nodeId: this.options.nodeId })) as PresenceStatus
  }

  /** Register and begin heartbeating. Returns the registration view. */
  async start(): Promise<NodeView> {
    const view = await this.register()
    this.startHeartbeat()
    return view
  }

  /** Start the heartbeat interval if it is not already running. */
  startHeartbeat(): void {
    if (this.heartbeatTimer) return
    this.heartbeatTimer = setInterval(() => {
      void this.heartbeat().catch(() => { /* refused/offline heartbeats are re-tried next tick */ })
    }, this.options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS)
  }

  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  /** Stop heartbeating and drop the connection. */
  destroy(): void {
    this.stopHeartbeat()
    this.unlisten?.()
    this.unlisten = null
    this.registered = false
    this.rpc.destroy()
  }

  get isRegistered(): boolean {
    return this.registered
  }

  private async answer(raw: unknown): Promise<void> {
    if (typeof raw !== 'object' || raw === null) return
    const request = raw as Partial<NodeInvokeRequest>
    if (typeof request.invokeId !== 'string' || typeof request.command !== 'string') return
    const invoke: NodeInvokeRequest = {
      invokeId: request.invokeId,
      nodeId: typeof request.nodeId === 'string' ? request.nodeId : this.options.nodeId,
      command: request.command,
      ...(request.payload !== undefined ? { payload: request.payload } : {}),
    }
    try {
      const payload = await this.options.onInvoke(invoke)
      await this.rpc.invoke(RPC_CHANNELS.nodes.INVOKE_RESULT, { invokeId: invoke.invokeId, payload })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // The host fences settlements by connection identity, so a superseded or
      // impostor node's error report is refused too — absorb it, don't reject.
      await this.rpc.invoke(RPC_CHANNELS.nodes.INVOKE_RESULT, {
        invokeId: invoke.invokeId,
        error: { code: nodeErrorCode(error), message },
      }).catch(() => { /* refused: the invoke is settled or owned elsewhere */ })
    }
  }
}