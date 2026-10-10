/**
 * e2.2 — device-auth challenge over the real transport.
 *
 * A real `WsRpcClient` and raw WS clients complete the `connect.challenge`
 * against a device-auth-enabled server. A replayed nonce (captured from another
 * connection), a wrong credential, and a client that skips the challenge are
 * each refused typed and receive NO `handshake_ack`.
 */

import { afterEach, describe, expect, it } from 'bun:test'
import WebSocket from 'ws'
import { PROTOCOL_VERSION } from '@rox/shared/protocol'
import { WsRpcServer } from '../server'
import { WsRpcClient } from '../client'
import { computeDeviceProof } from '../device-auth'
import { resolveRoxIdentityCredential } from '../identity-credential'

const CREDENTIAL = 'rox-identity:runtime-test:local'
const WRONG_CREDENTIAL = 'rox-identity:intruder:local'

const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function spinUp(deviceAuth: boolean | { credential: string } = { credential: CREDENTIAL }) {
  const server = new WsRpcServer({
    host: '127.0.0.1',
    port: 0,
    requireAuth: false,
    serverId: 'test',
    deviceAuth,
  })
  server.handle('fixture:ping', () => 'pong')
  await server.listen()
  cleanups.push(() => server.close())
  return { url: `ws://127.0.0.1:${server.port}` }
}

/** A handshake payload the raw client sends once it receives the challenge. */
type RawAnswer = Record<string, unknown>

interface RawOutcome {
  ack?: Record<string, unknown>
  error?: { code?: string; data?: unknown }
  sent?: RawAnswer
}

/**
 * Open a raw WS client. On `connect.challenge` it sends `answer(nonce)` as its
 * handshake; resolves on `handshake_ack` or `error` (server close).
 */
function rawClient(url: string, answer: (nonce: string) => RawAnswer | Promise<RawAnswer>): Promise<RawOutcome> {
  const ws = new WebSocket(url)
  const outcome: RawOutcome = {}
  const { promise, resolve } = Promise.withResolvers<RawOutcome>()
  let answered = false
  ws.on('message', async data => {
    const message = JSON.parse(data.toString()) as Record<string, unknown>
    if (message.type === 'connect.challenge' && !answered) {
      answered = true
      const extra = await answer(message.challengeNonce as string)
      outcome.sent = extra
      ws.send(JSON.stringify({ id: crypto.randomUUID(), type: 'handshake', protocolVersion: PROTOCOL_VERSION, ...extra }))
    } else if (message.type === 'handshake_ack') {
      outcome.ack = message
      ws.close()
      resolve(outcome)
    } else if (message.type === 'error') {
      outcome.error = message.error as RawOutcome['error']
      resolve(outcome)
    }
  })
  ws.on('close', () => resolve(outcome))
  ws.on('error', () => resolve(outcome))
  return promise
}

const validAnswer = async (nonce: string): Promise<RawAnswer> => ({
  challengeNonce: nonce,
  deviceProof: await computeDeviceProof(nonce, CREDENTIAL),
})

describe('device-auth challenge (real WS transport)', () => {
  it('a real client authenticates with the ROX identity credential from the store', async () => {
    const { url } = await spinUp(true) // deviceAuth: true ⇒ credential from the identity store

    const rpc = new WsRpcClient(url, {
      identityCredential: resolveRoxIdentityCredential(),
      autoReconnect: false,
      connectTimeout: 2_000,
    })
    cleanups.push(() => rpc.destroy())
    expect(await rpc.invoke('fixture:ping')).toBe('pong')
  })

  it('a client that completes the challenge connects (ack received)', async () => {
    const { url } = await spinUp()

    const rpc = new WsRpcClient(url, { identityCredential: CREDENTIAL, autoReconnect: false, connectTimeout: 2_000 })
    cleanups.push(() => rpc.destroy())
    expect(await rpc.invoke('fixture:ping')).toBe('pong')

    const raw = await rawClient(url, validAnswer)
    expect(raw.error).toBeUndefined()
    expect(typeof raw.ack?.clientId).toBe('string')
  })

  it('a replayed nonce captured from another connection is refused with no ack', async () => {
    const { url } = await spinUp()

    const first = await rawClient(url, validAnswer)
    expect(first.ack).toBeDefined() // captured (nonce, proof) pair
    expect(first.sent).toBeDefined()

    // Second connection replays the captured pair instead of its own challenge.
    const replayed = await rawClient(url, () => first.sent as RawAnswer)
    expect(replayed.ack).toBeUndefined()
    expect(replayed.error?.code).toBe('AUTH_FAILED')
  })

  it('a wrong credential is refused with no ack', async () => {
    const { url } = await spinUp()

    const wrong = await rawClient(url, async nonce => ({
      challengeNonce: nonce,
      deviceProof: await computeDeviceProof(nonce, WRONG_CREDENTIAL),
    }))
    expect(wrong.ack).toBeUndefined()
    expect(wrong.error?.code).toBe('AUTH_FAILED')
    expect((wrong.error?.data as { reason?: string } | undefined)?.reason).toBe('mismatched_credential')
  })

  it('a client that skips the challenge is refused with no ack', async () => {
    const { url } = await spinUp()

    const skipped = await rawClient(url, () => ({}))
    expect(skipped.ack).toBeUndefined()
    expect(skipped.error?.code).toBe('AUTH_FAILED')
    expect((skipped.error?.data as { reason?: string } | undefined)?.reason).toBe('missing_challenge')
  })
})