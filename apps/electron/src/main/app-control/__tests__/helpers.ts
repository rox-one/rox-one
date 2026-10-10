/**
 * Shared fixtures for the app-control tests: a temp-socket server factory, a
 * signed-frame builder, and a raw one-response exchange (used where the typed
 * refusal arrives before/without the client session, e.g. peer-UID mismatch).
 */

import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FrameDecoder, encodeFrame } from '@rox/shared/local-ipc/framing'

import { computeAppControlMac } from '../auth.ts'
import { AppControlServer, type AppControlServerOptions } from '../server.ts'
import {
  APP_CONTROL_PROTOCOL_VERSION,
  parseAppControlResponse,
  type AppControlResponse,
} from '../protocol.ts'

export interface TempEnv {
  dir: string
  socketPath: string
  tokenPath: string
  dispose: () => Promise<void>
}

export async function makeTempEnv(): Promise<TempEnv> {
  const dir = await mkdtemp(join(tmpdir(), 'rox-app-control-'))
  return {
    dir,
    socketPath: join(dir, 'app-control.sock'),
    tokenPath: join(dir, 'app-control.token'),
    dispose: () => rm(dir, { recursive: true, force: true }),
  }
}

/** A server whose peer reader always reports this process's UID. */
export async function startServer(options: Partial<AppControlServerOptions> & Pick<AppControlServerOptions, 'socketPath' | 'tokenPath' | 'handler'>): Promise<AppControlServer> {
  const server = new AppControlServer({
    expectedUid: process.getuid?.(),
    peerUidReader: () => process.getuid?.() ?? 0,
    ...options,
  })
  await server.listen()
  return server
}

export interface SignedFrameFields {
  method: string
  payload?: unknown
  id?: string
  nonce?: string
  ts?: number
  secret: string
  v?: number
}

export function buildSignedFrame(fields: SignedFrameFields): Buffer {
  const id = fields.id ?? randomUUID()
  const nonce = fields.nonce ?? randomUUID()
  const ts = fields.ts ?? Date.now()
  const mac = computeAppControlMac(fields.secret, { nonce, ts, payload: fields.payload })
  return encodeFrame({
    type: 'request',
    v: fields.v ?? APP_CONTROL_PROTOCOL_VERSION,
    id,
    method: fields.method,
    payload: fields.payload,
    auth: { nonce, ts, mac },
  })
}

/** Write one raw frame and resolve the first typed response (or reject on close). */
export async function rawExchange(socketPath: string, frame: Buffer): Promise<AppControlResponse> {
  const socket = createConnection(socketPath)
  const decoder = new FrameDecoder()
  const { promise, resolve, reject } = Promise.withResolvers<AppControlResponse>()
  let settled = false
  const finish = (run: () => void) => {
    if (settled) return
    settled = true
    socket.destroy()
    run()
  }
  socket.once('connect', () => socket.write(frame))
  socket.on('data', (chunk: Buffer) => {
    let frames: unknown[]
    try {
      frames = decoder.push(chunk)
    } catch (error) {
      finish(() => reject(error instanceof Error ? error : new Error(String(error))))
      return
    }
    for (const candidate of frames) {
      const response = parseAppControlResponse(candidate)
      if (response) {
        finish(() => resolve(response))
        return
      }
    }
  })
  socket.on('error', (error) => finish(() => reject(error)))
  socket.on('close', () => finish(() => reject(new Error('connection closed before a response frame'))))
  return promise
}

export function refusalCode(response: AppControlResponse): string {
  return response.ok ? 'ok' : response.error.code
}