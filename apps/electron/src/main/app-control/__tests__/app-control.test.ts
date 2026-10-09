import { afterEach, describe, expect, it } from 'bun:test'
import { stat } from 'node:fs/promises'
import { createConnection } from 'node:net'

import { FrameDecoder } from '@rox/shared/local-ipc/framing'

import { AppControlClient } from '../client.ts'
import { AppControlServer, type AppControlHandler } from '../server.ts'
import { parseAppControlResponse } from '../protocol.ts'
import { buildSignedFrame, makeTempEnv, rawExchange, refusalCode, startServer, type TempEnv } from './helpers.ts'

const envs: TempEnv[] = []
const servers: AppControlServer[] = []

async function tempEnv(): Promise<TempEnv> {
  const env = await makeTempEnv()
  envs.push(env)
  return env
}

async function server(options: { env: TempEnv; handler: AppControlHandler; peerUid?: () => number | null; expectedUid?: number; secret?: string }): Promise<AppControlServer> {
  const started = await startServer({
    socketPath: options.env.socketPath,
    tokenPath: options.env.tokenPath,
    handler: options.handler,
    ...(options.peerUid ? { peerUidReader: options.peerUid } : {}),
    ...(options.expectedUid !== undefined ? { expectedUid: options.expectedUid } : {}),
    ...(options.secret !== undefined ? { secret: options.secret } : {}),
  })
  servers.push(started)
  return started
}

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close()
  for (const env of envs.splice(0)) await env.dispose()
})

describe('app-control UDS server', () => {
  it('accepts a real signed client over a unix socket and writes a 0600 token', async () => {
    const env = await tempEnv()
    const started = await server({ env, handler: (_method, payload) => ({ echo: payload }) })

    const tokenStat = await stat(env.tokenPath)
    expect(tokenStat.mode & 0o777).toBe(0o600)
    expect(started.secret).toMatch(/^[0-9a-f]{64}$/)

    const client = new AppControlClient({ socketPath: env.socketPath, tokenPath: env.tokenPath })
    await expect(client.request('ping', { n: 1 })).resolves.toEqual({ echo: { n: 1 } })
  })

  it('dispatches methods with the validated payload', async () => {
    const env = await tempEnv()
    await server({ env, handler: (method, payload) => `${method}:${JSON.stringify(payload)}` })
    const client = new AppControlClient({ socketPath: env.socketPath, tokenPath: env.tokenPath })
    await expect(client.request('status', { verbose: true })).resolves.toBe('status:{"verbose":true}')
  })

  it('refuses a bad token as bad-token', async () => {
    const env = await tempEnv()
    await server({ env, handler: () => 'ok' })
    const response = await rawExchange(env.socketPath, buildSignedFrame({ method: 'ping', secret: 'wrong-secret' }))
    expect(refusalCode(response)).toBe('bad-token')
  })

  it('refuses a replayed nonce as replayed-nonce', async () => {
    const env = await tempEnv()
    await server({ env, handler: () => 'ok', secret: 'shared' })
    const frame = buildSignedFrame({ method: 'ping', secret: 'shared', nonce: 'nonce-1' })
    const first = await rawExchange(env.socketPath, frame)
    expect(refusalCode(first)).toBe('ok')
    const second = await rawExchange(env.socketPath, frame)
    expect(refusalCode(second)).toBe('replayed-nonce')
  })

  it('refuses a stale timestamp as stale-timestamp', async () => {
    const env = await tempEnv()
    await server({ env, handler: () => 'ok' })
    const response = await rawExchange(env.socketPath, buildSignedFrame({
      method: 'ping', secret: 'shared', ts: Date.now() - 60_000,
    }))
    expect(refusalCode(response)).toBe('stale-timestamp')
  })

  it('refuses an unsupported protocol version as unsupported-version', async () => {
    const env = await tempEnv()
    await server({ env, handler: () => 'ok' })
    const response = await rawExchange(env.socketPath, buildSignedFrame({ method: 'ping', secret: 'shared', v: 2 }))
    expect(refusalCode(response)).toBe('unsupported-version')
  })

  it('refuses a wrong peer UID as peer-uid-mismatch', async () => {
    const env = await tempEnv()
    const expected = process.getuid?.() ?? 0
    await server({ env, handler: () => 'ok', peerUid: () => expected + 1, expectedUid: expected })
    const response = await rawExchange(env.socketPath, buildSignedFrame({ method: 'ping', secret: 'shared' }))
    expect(refusalCode(response)).toBe('peer-uid-mismatch')
  })

  it('treats an unverifiable peer UID as a mismatch', async () => {
    const env = await tempEnv()
    await server({ env, handler: () => 'ok', peerUid: () => null, expectedUid: process.getuid?.() ?? 0 })
    const response = await rawExchange(env.socketPath, buildSignedFrame({ method: 'ping', secret: 'shared' }))
    expect(refusalCode(response)).toBe('peer-uid-mismatch')
  })
})

describe('app-control malformed frames', () => {
  it('closes the connection with a typed malformed-frame refusal', async () => {
    const env = await tempEnv()
    await server({ env, handler: () => 'ok' })

    const socket = createConnection(env.socketPath)
    const decoder = new FrameDecoder()
    const responses: string[] = []
    const closed = new Promise<void>((resolveClosed) => {
      socket.once('close', () => resolveClosed())
    })
    const connected = Promise.withResolvers<void>()
    socket.once('connect', () => connected.resolve())
    await connected.promise
    socket.on('data', (chunk: Buffer) => {
      for (const frame of decoder.push(chunk)) {
        const response = parseAppControlResponse(frame)
        if (response) responses.push(refusalCode(response))
      }
    })
    // Length prefix says 3 bytes; payload is not JSON.
    socket.write(Buffer.concat([Buffer.from([0, 0, 0, 3]), Buffer.from('abc')]))
    await closed
    expect(responses).toEqual(['malformed-frame'])
  })

  it('rejects a validated frame whose auth is missing', async () => {
    const env = await tempEnv()
    await server({ env, handler: () => 'ok' })
    const response = await rawExchange(env.socketPath, Buffer.concat([
      Buffer.from([0, 0, 0, 9]),
      Buffer.from('{"bad":1}'),
    ]))
    expect(refusalCode(response)).toBe('malformed-frame')
  })
})