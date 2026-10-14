import { describe, expect, it } from 'bun:test'
import { HomeFetchService, parseRetryAfter } from './service'
import { getSharedKeys, resetSharedKeysForTest } from './shared-keys'
import { parseHomeFetchRequest, parseHomeSearchRequest } from '../../shared/home-fetch'

function setup(opts: { online?: () => boolean; key?: string; respond?: (url: string, init?: RequestInit) => Response | Promise<Response> } = {}) {
  let now = 1_000_000
  const calls: { url: string; init?: RequestInit }[] = []
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    return opts.respond ? opts.respond(String(url), init) : new Response('{"ok":1}', { status: 200 })
  }) as unknown as typeof fetch
  const svc = new HomeFetchService({
    fetch: fetchImpl,
    now: () => now,
    isOnline: opts.online ?? (() => true),
    getExaKey: () => opts.key,
    bucketCapacity: 3,
    bucketRefillMs: 1000,
    timeoutMs: 50,
    maxBodyBytes: 1000,
  })
  return { svc, calls, tick: (ms: number) => { now += ms } }
}

describe('HomeFetchService', () => {
  it('caches within max age and refetches after', async () => {
    const { svc, calls, tick } = setup()
    const a = await svc.fetch({ url: 'https://a.test/x', as: 'json', maxAgeMs: 60_000 })
    expect(a).toMatchObject({ status: 'ok', data: { ok: 1 }, fromCache: false })
    const b = await svc.fetch({ url: 'https://a.test/x', as: 'json', maxAgeMs: 60_000 })
    expect(b).toMatchObject({ status: 'ok', fromCache: true })
    expect(calls).toHaveLength(1)
    tick(61_000)
    await svc.fetch({ url: 'https://a.test/x', as: 'json', maxAgeMs: 60_000 })
    expect(calls).toHaveLength(2)
  })

  it('dedupes concurrent requests', async () => {
    const { svc, calls } = setup()
    const [a, b] = await Promise.all([svc.fetch({ url: 'https://a.test/y', as: 'text' }), svc.fetch({ url: 'https://a.test/y', as: 'text' })])
    expect(a).toEqual(b)
    expect(calls).toHaveLength(1)
  })

  it('rate-limits per host with a token bucket', async () => {
    const { svc, tick } = setup()
    for (let i = 0; i < 3; i++) expect((await svc.fetch({ url: `https://h.test/${i}`, as: 'text' })).status).toBe('ok')
    const limited = await svc.fetch({ url: 'https://h.test/4', as: 'text' })
    expect(limited).toMatchObject({ status: 'error', reason: 'rate-limited' })
    expect((await svc.fetch({ url: 'https://other.test/', as: 'text' })).status).toBe('ok')
    tick(1000)
    expect((await svc.fetch({ url: 'https://h.test/5', as: 'text' })).status).toBe('ok')
  })

  it('backs off a host after 429 honoring Retry-After and serves stale cache', async () => {
    let fail = false
    const { svc, tick } = setup({ respond: () => (fail ? new Response('', { status: 429, headers: { 'retry-after': '5' } }) : new Response('v1')) })
    await svc.fetch({ url: 'https://r.test/', as: 'text', maxAgeMs: 30_000 })
    fail = true
    tick(31_000)
    const res = await svc.fetch({ url: 'https://r.test/', as: 'text', maxAgeMs: 30_000 })
    expect(res).toMatchObject({ status: 'error', reason: 'rate-limited', httpStatus: 429, retryAfterMs: 5000, cached: { data: 'v1' } })
    const blocked = await svc.fetch({ url: 'https://r.test/', as: 'text', force: true })
    expect(blocked).toMatchObject({ status: 'error', reason: 'rate-limited' })
  })

  it('reports offline with cached data and does not call the network', async () => {
    let online = true
    const { svc, calls, tick } = setup({ online: () => online })
    await svc.fetch({ url: 'https://o.test/', as: 'json' })
    online = false
    tick(10 * 60_000)
    const res = await svc.fetch({ url: 'https://o.test/', as: 'json' })
    expect(res).toMatchObject({ status: 'error', reason: 'offline', cached: { data: { ok: 1 } } })
    expect(calls).toHaveLength(1)
  })

  it('maps http errors, bad json, oversize bodies and timeouts', async () => {
    const { svc } = setup({
      respond: (url) => {
        if (url.endsWith('/404')) return new Response('', { status: 404 })
        if (url.endsWith('/bad')) return new Response('{')
        if (url.endsWith('/big')) return new Response('x'.repeat(2000))
        return new Promise<Response>(() => {})
      },
    })
    expect(await svc.fetch({ url: 'https://e.test/404', as: 'text' })).toMatchObject({ reason: 'http', httpStatus: 404 })
    expect(await svc.fetch({ url: 'https://e.test/bad', as: 'json' })).toMatchObject({ reason: 'invalid' })
    expect(await svc.fetch({ url: 'https://e2.test/big', as: 'text' })).toMatchObject({ reason: 'too-large' })
  })

  it('search needs a key, sends it only to Exa and never returns it', async () => {
    expect(await setup().svc.search({ query: 'rox' })).toEqual({ status: 'error', reason: 'no-key' })
    const { svc, calls } = setup({
      key: 'test-key-123456',
      respond: () => new Response(JSON.stringify({ results: [{ title: 'T', url: 'https://x.y/', text: 'hello' }, { url: 'javascript:1' }] })),
    })
    const res = await svc.search({ query: 'rox', numResults: 3 })
    expect(res).toMatchObject({ status: 'ok', data: [{ title: 'T', url: 'https://x.y/', snippet: 'hello' }] })
    expect(calls[0]!.url).toBe('https://api.exa.ai/search')
    expect((calls[0]!.init!.headers as Record<string, string>)['x-api-key']).toBe('test-key-123456')
    expect(JSON.stringify(res)).not.toContain('test-key-123456')
    expect(svc.status()).toEqual({ online: true, searchAvailable: true })
  })
})

describe('home fetch request parsing', () => {
  it('accepts only http(s) without credentials and known keys', () => {
    expect(parseHomeFetchRequest({ url: 'https://a.b/c', as: 'json' })).toEqual({ url: 'https://a.b/c', as: 'json' })
    expect(parseHomeFetchRequest({ url: 'file:///etc/passwd', as: 'text' })).toBeNull()
    expect(parseHomeFetchRequest({ url: 'https://u:p@a.b/', as: 'text' })).toBeNull()
    expect(parseHomeFetchRequest({ url: 'https://a.b/', as: 'text', headers: {} })).toBeNull()
    expect(parseHomeFetchRequest({ url: 'https://a.b/', as: 'xml' })).toBeNull()
    expect(parseHomeSearchRequest({ query: '  hi ', numResults: 99 })).toEqual({ query: 'hi', numResults: 20 })
    expect(parseHomeSearchRequest({ query: '' })).toBeNull()
  })
  it('parses Retry-After seconds and dates', () => {
    expect(parseRetryAfter('3', 0)).toBe(3000)
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 0)).toBe(10_000)
    expect(parseRetryAfter('soon', 0)).toBeUndefined()
  })
  it('shared keys: env override, validation, absent module', () => {
    resetSharedKeysForTest({ exa: 'embedded-key-0001' })
    expect(getSharedKeys({})).toEqual({ exa: 'embedded-key-0001' })
    expect(getSharedKeys({ ROX_EXA_API_KEY: 'env-key-000001' })).toEqual({ exa: 'env-key-000001' })
    resetSharedKeysForTest({ exa: 'bad key with spaces' })
    expect(getSharedKeys({})).toEqual({ exa: undefined })
    resetSharedKeysForTest(null)
  })
})
