/**
 * App-control UDS client (port row e2.7). Signs every request with the shared
 * token and speaks the shared length-prefixed framing. No Electron APIs.
 */

import { randomBytes, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createConnection, type Socket } from 'node:net'

import { FrameDecoder, encodeFrame } from '@rox/shared/local-ipc/framing'

import { computeAppControlMac } from './auth.ts'
import {
  APP_CONTROL_PROTOCOL_VERSION,
  AppControlError,
  parseAppControlResponse,
  type AppControlAuth,
  type AppControlRequest,
  type AppControlResponse,
} from './protocol.ts'

export interface AppControlClientOptions {
  socketPath: string
  /** Shared secret. When omitted, `tokenPath` is read on first use. */
  secret?: string
  tokenPath?: string
  now?: () => number
  timeoutMs?: number
}

/** Per-request overrides so callers (and tests) can forge one field. */
export interface AppControlRequestOverrides {
  secret?: string
  nonce?: string
  ts?: number
  id?: string
  v?: number
}

interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

const DEFAULT_TIMEOUT_MS = 5000

export class AppControlSession {
  private readonly decoder = new FrameDecoder()
  private readonly pending = new Map<string, Pending>()

  constructor(
    private readonly socket: Socket,
    private readonly getSecret: () => Promise<string>,
    private readonly now: () => number,
    private readonly timeoutMs: number,
  ) {
    socket.on('data', (chunk: Buffer) => this.onData(chunk))
    socket.on('error', (error) => this.failAll(error))
    socket.on('close', () => this.failAll(new AppControlError('internal-error', 'app-control connection closed')))
  }

  async send<R = unknown>(method: string, payload?: unknown, overrides: AppControlRequestOverrides = {}): Promise<R> {
    const id = overrides.id ?? randomUUID()
    const secret = overrides.secret ?? await this.getSecret()
    const auth: AppControlAuth = {
      nonce: overrides.nonce ?? randomBytes(16).toString('hex'),
      ts: overrides.ts ?? this.now(),
      mac: '',
    }
    auth.mac = computeAppControlMac(secret, { nonce: auth.nonce, ts: auth.ts, payload })
    const version = (overrides.v ?? APP_CONTROL_PROTOCOL_VERSION) as typeof APP_CONTROL_PROTOCOL_VERSION
    const request: AppControlRequest = { type: 'request', v: version, id, method, payload, auth }

    const settled = new Promise<R>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new AppControlError('internal-error', 'app-control request timed out'))
      }, this.timeoutMs)
      timer.unref?.()
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value as R) },
        reject: (error) => { clearTimeout(timer); reject(error) },
      })
    })
    this.socket.write(encodeFrame(request))
    return settled
  }

  close(): void {
    this.socket.destroy()
  }

  private onData(chunk: Buffer): void {
    let frames: unknown[]
    try {
      frames = this.decoder.push(chunk)
    } catch (error) {
      this.failAll(error instanceof Error ? error : new Error(String(error)))
      return
    }
    for (const frame of frames) this.handleResponse(frame)
  }

  private handleResponse(frame: unknown): void {
    const response: AppControlResponse | null = parseAppControlResponse(frame)
    if (!response) {
      this.failAll(new AppControlError('malformed-frame', 'app-control response failed validation'))
      return
    }
    const pending = this.pending.get(response.id)
    if (!pending) return
    this.pending.delete(response.id)
    if (response.ok) {
      pending.resolve(response.result)
    } else {
      pending.reject(new AppControlError(response.error.code, response.error.message))
    }
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }
}

export class AppControlClient {
  private readonly socketPath: string
  private readonly now: () => number
  private readonly timeoutMs: number
  private secret: string | null
  private readonly tokenPath: string | undefined

  constructor(options: AppControlClientOptions) {
    this.socketPath = options.socketPath
    this.secret = options.secret ?? null
    this.tokenPath = options.tokenPath
    this.now = options.now ?? Date.now
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  private readonly readSecret = async (): Promise<string> => {
    if (this.secret !== null) return this.secret
    if (!this.tokenPath) throw new AppControlError('bad-token', 'no app-control secret or token path configured')
    this.secret = (await readFile(this.tokenPath, 'utf8')).trim()
    return this.secret
  }

  async connect(): Promise<AppControlSession> {
    const socket = await new Promise<Socket>((resolveConnect, rejectConnect) => {
      const connection = createConnection(this.socketPath)
      connection.once('connect', () => {
        connection.off('error', rejectConnect)
        resolveConnect(connection)
      })
      connection.once('error', rejectConnect)
    })
    return new AppControlSession(socket, this.readSecret, this.now, this.timeoutMs)
  }

  async request<R = unknown>(method: string, payload?: unknown, overrides: AppControlRequestOverrides = {}): Promise<R> {
    const session = await this.connect()
    try {
      return await session.send<R>(method, payload, overrides)
    } finally {
      session.close()
    }
  }
}