import { describe, expect, it } from 'bun:test'
import { PostHogClient } from './posthog.ts'

interface FetchCall {
  url: string
  init: RequestInit | undefined
}

/** Records requests; `respond` can override the Response per call. */
function recordingFetch(
  calls: FetchCall[],
  respond: (call: FetchCall, index: number) => Response | Promise<Response> = () => new Response('{}', { status: 200 }),
): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const call: FetchCall = { url: String(input), init }
    calls.push(call)
    return respond(call, calls.length - 1)
  }) as typeof fetch
}

function bodyOf(call: FetchCall): { api_key: string; batch: Array<Record<string, unknown>> } {
  return JSON.parse(String(call.init?.body)) as { api_key: string; batch: Array<Record<string, unknown>> }
}

describe('PostHogClient capture', () => {
  it('batches events into one /batch/ POST with distinct_id and $lib', async () => {
    const calls: FetchCall[] = []
    const client = new PostHogClient({
      host: 'https://posthog.rox.one/',
      apiKey: 'ph-key',
      distinctId: 'anon-123',
      fetchImpl: recordingFetch(calls),
      now: () => 1_700_000_000_000,
    })
    client.capture('onboarding_step_viewed', { step: 'username' })
    client.capture('registration_completed')
    expect(await client.flush()).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('https://posthog.rox.one/batch/')
    const body = bodyOf(calls[0]!)
    expect(body.api_key).toBe('ph-key')
    expect(body.batch).toHaveLength(2)
    expect(body.batch[0]!.distinct_id).toBe('anon-123')
    expect(body.batch[0]!.event).toBe('onboarding_step_viewed')
    expect((body.batch[0]!.properties as Record<string, unknown>).$lib).toBe('rox-desktop')
    expect((body.batch[0]!.properties as Record<string, unknown>).step).toBe('username')
  })

  it('flushes automatically at maxBatchSize', async () => {
    const calls: FetchCall[] = []
    const client = new PostHogClient({
      host: 'https://h', apiKey: 'k', distinctId: 'd',
      fetchImpl: recordingFetch(calls), maxBatchSize: 3, flushIntervalMs: 1_000_000,
    })
    client.capture('a')
    client.capture('b')
    client.capture('c')
    await client.flush() // awaits the auto-flush triggered by the 3rd capture
    expect(calls).toHaveLength(1)
    expect(bodyOf(calls[0]!).batch.map((event) => event.event)).toEqual(['a', 'b', 'c'])
  })

  it('drops oldest events past maxBufferSize', async () => {
    const calls: FetchCall[] = []
    const client = new PostHogClient({
      host: 'https://h', apiKey: 'k', distinctId: 'd',
      fetchImpl: recordingFetch(calls), maxBufferSize: 3, maxBatchSize: 20,
    })
    for (const event of ['e0', 'e1', 'e2', 'e3', 'e4']) client.capture(event)
    await client.flush()
    expect(bodyOf(calls[0]!).batch.map((event) => event.event)).toEqual(['e2', 'e3', 'e4'])
  })

  it('retries once, then re-queues without throwing', async () => {
    const failing: FetchCall[] = []
    const client = new PostHogClient({
      host: 'https://h', apiKey: 'k', distinctId: 'd',
      fetchImpl: recordingFetch(failing, () => { throw new Error('offline') }),
    })
    client.capture('a')
    expect(await client.flush()).toBe(false)
    expect(failing).toHaveLength(2) // one retry max
    // Re-queued: a subsequent successful flush still delivers the event.
    const ok: FetchCall[] = []
    const recovering = new PostHogClient({
      host: 'https://h', apiKey: 'k', distinctId: 'd', fetchImpl: recordingFetch(ok),
    })
    recovering.capture('a')
    expect(await recovering.flush()).toBe(true)
    expect(bodyOf(ok[0]!).batch.map((event) => event.event)).toEqual(['a'])
  })

  it('is inert (no fetch) without a host or key', async () => {
    const calls: FetchCall[] = []
    const client = new PostHogClient({ host: '', apiKey: 'k', distinctId: 'd', fetchImpl: recordingFetch(calls) })
    client.capture('a')
    await client.flush()
    expect(client.enabled).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('redacts sensitive props before sending', async () => {
    const calls: FetchCall[] = []
    const client = new PostHogClient({
      host: 'https://h', apiKey: 'k', distinctId: 'd', fetchImpl: recordingFetch(calls),
    })
    client.capture('evt', {
      step: 'username',
      token: 'secret-token',
      email: 'a@b.com',
      content: 'message contents',
      note: '/Users/someone/secret.txt',
    })
    await client.flush()
    const properties = bodyOf(calls[0]!).batch[0]!.properties as Record<string, unknown>
    expect(properties.step).toBe('username')
    // Sensitive keys are dropped entirely.
    expect(properties.token).toBeUndefined()
    expect(properties.email).toBeUndefined()
    expect(properties.content).toBeUndefined()
    // A path smuggled through a harmless key is redacted by value.
    expect(properties.note).toBe('[redacted]')
  })
})

describe('PostHogClient feature flags', () => {
  it('caches decide results for the TTL', async () => {
    const calls: FetchCall[] = []
    let now = 0
    const client = new PostHogClient({
      host: 'https://h', apiKey: 'k', distinctId: 'd',
      fetchImpl: recordingFetch(calls, () => new Response(JSON.stringify({ featureFlags: { beta: true } }), { status: 200 })),
      now: () => now, flagCacheTtlMs: 5 * 60_000,
    })
    expect(await client.getFlag('beta')).toBe(true)
    expect(await client.getFlag('beta')).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('https://h/decide/?v=3')
    now += 5 * 60_000 + 1
    expect(await client.getFlag('beta')).toBe(true)
    expect(calls).toHaveLength(2)
  })

  it('falls back to the local map and trips the kill switch on non-200', async () => {
    const calls: FetchCall[] = []
    const client = new PostHogClient({
      host: 'https://h', apiKey: 'k', distinctId: 'd',
      fetchImpl: recordingFetch(calls, () => new Response('nope', { status: 500 })),
      fallbackFlags: { beta: 'control' },
    })
    expect(await client.getFlag('beta')).toBe('control')
    expect(await client.getFlag('beta')).toBe('control')
    expect(calls).toHaveLength(1) // kill switch: no second decide call
  })

  it('normalizes the legacy string[] flag shape', async () => {
    const client = new PostHogClient({
      host: 'https://h', apiKey: 'k', distinctId: 'd',
      fetchImpl: recordingFetch([], () => new Response(JSON.stringify({ featureFlags: ['alpha'] }), { status: 200 })),
    })
    expect(await client.getFlag('alpha')).toBe(true)
  })

  it('never fetches /decide when flagsEnabled is false', async () => {
    const calls: FetchCall[] = []
    const client = new PostHogClient({
      host: 'https://h', apiKey: 'k', distinctId: 'd',
      flagsEnabled: false, fallbackFlags: { beta: true },
      fetchImpl: recordingFetch(calls),
    })
    expect(await client.getFlag('beta')).toBe(true)
    expect(calls).toHaveLength(0)
  })
})