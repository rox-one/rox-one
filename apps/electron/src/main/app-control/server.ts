/**
 * App-control UDS server (port row e2.7).
 *
 * One listening unix socket, a 0600 token file, and three gates before a
 * request is dispatched: peer UID, timestamp TTL, HMAC, replay. Every refusal
 * is a typed `AppControlResponse` carrying an `AppControlRefusalCode`, so the
 * client never has to parse a message. No Electron APIs.
 */

import { randomBytes, randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server, type Socket } from 'node:net'
import { dirname } from 'node:path'

import { FrameDecoder, encodeFrame, isLocalIpcFramingError } from '@rox/shared/local-ipc/framing'

import { APP_CONTROL_TOKEN_BYTES, NonceCache, appControlMacMatches, computeAppControlMac } from './auth.ts'
import { defaultPeerUidReader, type PeerUidReader } from './peer-uid.ts'
import {
  APP_CONTROL_PROTOCOL_VERSION,
  APP_CONTROL_TTL_MS,
  appControlError,
  appControlOk,
  parseAppControlRequest,
  type AppControlRefusalCode,
  type AppControlResponse,
} from './protocol.ts'

export interface AppControlContext {
  connectionId: string
  requestId: string
  socket: Socket
}

export type AppControlHandler = (method: string, payload: unknown, context: AppControlContext) => Promise<unknown> | unknown

export interface AppControlServerOptions {
  socketPath: string
  tokenPath: string
  handler: AppControlHandler
  /** Fixed secret (tests). Otherwise the token file is read, or created. */
  secret?: string
  now?: () => number
  ttlMs?: number
  peerUidReader?: PeerUidReader
  expectedUid?: number
  log?: (message: string, error?: unknown) => void
}

export class AppControlServer {
  readonly socketPath: string
  readonly tokenPath: string
  private readonly handler: AppControlHandler
  private readonly now: () => number
  private readonly ttlMs: number
  private readonly peerUidReader: PeerUidReader
  private readonly expectedUid: number | undefined
  private readonly nonces: NonceCache
  private readonly log: (message: string, error?: unknown) => void
  private readonly sockets = new Set<Socket>()
  /** Shared secret: set from options, or generated/read on `listen()`. */
  secret = ''
  private server: Server | null = null

  constructor(options: AppControlServerOptions) {
    this.socketPath = options.socketPath
    this.tokenPath = options.tokenPath
    this.handler = options.handler
    this.now = options.now ?? Date.now
    this.ttlMs = options.ttlMs ?? APP_CONTROL_TTL_MS
    this.peerUidReader = options.peerUidReader ?? defaultPeerUidReader()
    this.expectedUid = options.expectedUid ?? (typeof process.getuid === 'function' ? process.getuid() : undefined)
    this.nonces = new NonceCache(this.ttlMs)
    this.log = options.log ?? (() => {})
    if (options.secret !== undefined) this.secret = options.secret
  }

  /** Read/create the secret and start listening. Idempotent. */
  async listen(): Promise<AppControlServer> {
    if (this.server) return this
    this.secret = await this.resolveSecret()
    await mkdir(dirname(this.socketPath), { recursive: true, mode: 0o700 })
    await chmod(dirname(this.socketPath), 0o700).catch(() => {})
    await rm(this.socketPath, { force: true })
    const server = createServer((socket) => this.handleConnection(socket))
    this.server = server
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once('error', rejectListen)
      server.listen(this.socketPath, () => {
        server.off('error', rejectListen)
        resolveListen()
      })
    })
    await chmod(this.socketPath, 0o600).catch(() => {})
    return this
  }

  async close(): Promise<void> {
    for (const socket of this.sockets) socket.destroy()
    this.sockets.clear()
    const server = this.server
    this.server = null
    if (server) {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()))
    }
    await rm(this.socketPath, { force: true }).catch(() => {})
  }

  private async resolveSecret(): Promise<string> {
    if (this.secret) return this.secret
    try {
      const existing = (await readFile(this.tokenPath, 'utf8')).trim()
      if (existing.length > 0) return existing
    } catch {
      // No token file yet — create one below.
    }
    const secret = randomBytes(APP_CONTROL_TOKEN_BYTES).toString('hex')
    await mkdir(dirname(this.tokenPath), { recursive: true, mode: 0o700 })
    await writeFile(this.tokenPath, `${secret}\n`, { mode: 0o600 })
    await chmod(this.tokenPath, 0o600).catch(() => {})
    return secret
  }

  private handleConnection(socket: Socket): void {
    const connectionId = randomUUID()
    this.sockets.add(socket)
    socket.once('close', () => {
      this.sockets.delete(socket)
    })

    const peerUid = this.peerUidReader(socket)
    if (this.expectedUid !== undefined && peerUid !== this.expectedUid) {
      this.refuseAndClose(socket, '', 'peer-uid-mismatch', `peer uid ${String(peerUid)} is not ${this.expectedUid}`)
      return
    }

    const decoder = new FrameDecoder()
    socket.on('data', (chunk: Buffer) => {
      let frames: unknown[]
      try {
        frames = decoder.push(chunk)
      } catch (error) {
        const message = isLocalIpcFramingError(error) ? `${error.code}: ${error.message}` : String(error)
        this.refuseAndClose(socket, '', 'malformed-frame', message)
        return
      }
      for (const frame of frames) this.handleFrame(socket, connectionId, frame)
    })
    socket.on('error', (error) => this.log('[app-control] socket error', error))
    socket.on('end', () => {
      try {
        decoder.finish()
      } catch {
        // A client that disconnects mid-frame is not an error worth logging.
      }
    })
  }

  private handleFrame(socket: Socket, connectionId: string, frame: unknown): void {
    const request = parseAppControlRequest(frame)
    if (!request) {
      this.refuseAndClose(socket, '', 'malformed-frame', 'request frame failed validation')
      return
    }
    if (request.v !== APP_CONTROL_PROTOCOL_VERSION) {
      this.refuseAndClose(socket, request.id, 'unsupported-version', `protocol version ${request.v} is unsupported`)
      return
    }
    const now = this.now()
    if (!Number.isFinite(request.auth.ts) || Math.abs(now - request.auth.ts) > this.ttlMs) {
      this.refuse(socket, request.id, 'stale-timestamp', 'request timestamp is outside the replay window')
      return
    }
    const expectedMac = computeAppControlMac(this.secret, { nonce: request.auth.nonce, ts: request.auth.ts, payload: request.payload })
    if (!appControlMacMatches(expectedMac, request.auth.mac)) {
      this.refuse(socket, request.id, 'bad-token', 'request MAC did not verify')
      return
    }
    if (!this.nonces.accept(request.auth.nonce, request.auth.ts, now)) {
      this.refuse(socket, request.id, 'replayed-nonce', 'nonce was already used')
      return
    }
    void this.dispatch(socket, connectionId, request.id, request.method, request.payload)
  }

  private async dispatch(socket: Socket, connectionId: string, id: string, method: string, payload: unknown): Promise<void> {
    try {
      const result = await this.handler(method, payload, { connectionId, requestId: id, socket })
      this.write(socket, appControlOk(id, result))
    } catch (error) {
      this.log('[app-control] handler failed', error)
      this.write(socket, appControlError(id, 'internal-error', error instanceof Error ? error.message : String(error)))
    }
  }

  private refuse(socket: Socket, id: string, code: AppControlRefusalCode, message: string): void {
    this.write(socket, appControlError(id, code, message))
  }

  private refuseAndClose(socket: Socket, id: string, code: AppControlRefusalCode, message: string): void {
    if (socket.destroyed || socket.writableEnded) return
    // Graceful FIN, not destroy(): destroying immediately after the write can
    // reset the connection before the peer reads the frame, so the caller sees
    // a raw EPIPE instead of the typed refusal code it was sent.
    socket.end(encodeFrame(appControlError(id, code, message)))
  }

  private write(socket: Socket, response: AppControlResponse, after?: () => void): void {
    if (socket.destroyed || socket.writableEnded) return
    socket.write(encodeFrame(response), () => after?.())
  }
}