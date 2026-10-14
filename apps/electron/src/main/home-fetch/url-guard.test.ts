import { describe, expect, it } from 'bun:test'
import { checkUrl, isBlockedAddress } from './url-guard'
import { HomeFetchService } from './service'

const publicDns = async () => ['93.184.216.34']

/** Stub responses dispatch on the parsed host, never on a URL prefix (CodeQL js/incomplete-url-substring-sanitization). */
const host = (url: string) => new URL(url).hostname

describe('isBlockedAddress', () => {
  const blocked = [
    '127.0.0.1', '127.8.8.8', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '169.254.1.1',
    '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '198.18.0.1',
    '::', '::1', 'fe80::1', 'fc00::1', 'fd00:ec2::254', 'fec0::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1',
    '::ffff:169.254.169.254', '64:ff9b::a9fe:a9fe', '2002:7f00:1::', '2001:db8::1', 'nonsense',
  ]
  for (const ip of blocked) it(`blocks ${ip}`, () => expect(isBlockedAddress(ip)).toBe(true))
  for (const ip of ['93.184.216.34', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])
    it(`allows ${ip}`, () => expect(isBlockedAddress(ip)).toBe(false))
})

describe('checkUrl', () => {
  it('allows public https on the default port and :443', async () => {
    expect((await checkUrl('https://example.com/feed', publicDns)).ok).toBe(true)
    expect((await checkUrl('https://example.com:443/feed', publicDns)).ok).toBe(true)
  })
  it('requires https', async () => {
    expect(await checkUrl('http://example.com/', publicDns)).toEqual({ ok: false, why: 'scheme' })
    expect(await checkUrl('file:///etc/passwd', publicDns)).toEqual({ ok: false, why: 'scheme' })
    expect((await checkUrl('http://example.com/', publicDns, { allowHttp: true })).ok).toBe(true)
  })
  it('allows only ports 80 and 443', async () => {
    expect(await checkUrl('https://example.com:8443/', publicDns)).toEqual({ ok: false, why: 'port' })
    expect(await checkUrl('https://example.com:80/', publicDns)).toEqual({ ok: false, why: 'port' })
    expect(await checkUrl('http://example.com:22/', publicDns, { allowHttp: true })).toEqual({ ok: false, why: 'port' })
  })
  it('rejects credentials, internal names and IP literals in private ranges', async () => {
    expect(await checkUrl('https://u:p@example.com/', publicDns)).toEqual({ ok: false, why: 'credentials' })
    for (const u of ['https://localhost/', 'https://foo.localhost/', 'https://metadata.google.internal/', 'https://printer.local/', 'https://intranet/'])
      expect(await checkUrl(u, publicDns)).toEqual({ ok: false, why: 'host' })
    for (const u of ['https://127.0.0.1/', 'https://169.254.169.254/latest/meta-data', 'https://[::1]/', 'https://[fd00::1]/', 'https://[::ffff:10.0.0.1]/'])
      expect(await checkUrl(u, publicDns)).toEqual({ ok: false, why: 'address' })
  })
  it('resolves DNS and blocks a name that points at an internal address', async () => {
    expect(await checkUrl('https://rebind.example/', async () => ['127.0.0.1'])).toEqual({ ok: false, why: 'address' })
    expect(await checkUrl('https://mixed.example/', async () => ['93.184.216.34', '10.0.0.5'])).toEqual({ ok: false, why: 'address' })
    expect(await checkUrl('https://v6.example/', async () => ['fe80::1'])).toEqual({ ok: false, why: 'address' })
    expect(await checkUrl('https://none.example/', async () => [])).toEqual({ ok: false, why: 'address' })
    expect(await checkUrl('https://fail.example/', async () => { throw new Error('ENOTFOUND') })).toEqual({ ok: false, why: 'dns' })
  })
})

function service(respond: (url: string, init?: RequestInit) => Response, resolve: (h: string) => Promise<string[]> = publicDns, bucketCapacity = 6) {
  const calls: { url: string; init?: RequestInit }[] = []
  const svc = new HomeFetchService({
    fetch: (async (url: string, init?: RequestInit) => { calls.push({ url: String(url), init }); return respond(String(url), init) }) as unknown as typeof fetch,
    now: () => 1_000_000,
    isOnline: () => true,
    getExaKey: () => 'k',
    resolveHost: resolve,
    bucketCapacity,
    timeoutMs: 1000,
  })
  return { svc, calls }
}

describe('HomeFetchService SSRF guard', () => {
  it('blocks before any network call when the target is internal', async () => {
    const { svc, calls } = service(() => new Response('{}'), async (h) => (h === 'evil.example' ? ['192.168.0.10'] : ['93.184.216.34']))
    expect(await svc.fetch({ url: 'https://evil.example/', as: 'json' })).toMatchObject({ status: 'error', reason: 'blocked' })
    expect(calls).toHaveLength(0)
  })
  it('uses manual redirects and re-checks every hop', async () => {
    const { svc, calls } = service((url) => host(url) === 'a.example'
      ? new Response(null, { status: 302, headers: { location: 'https://169.254.169.254/latest/meta-data' } })
      : new Response('{}'))
    expect(await svc.fetch({ url: 'https://a.example/', as: 'json' })).toMatchObject({ status: 'error', reason: 'blocked' })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.init?.redirect).toBe('manual')
  })
  it('blocks a redirect to http and to a non-standard port', async () => {
    for (const location of ['http://b.example/', 'https://b.example:8080/']) {
      const { svc } = service((url) => host(url) === 'a.example' ? new Response(null, { status: 301, headers: { location } }) : new Response('{}'))
      expect(await svc.fetch({ url: 'https://a.example/', as: 'json' })).toMatchObject({ status: 'error', reason: 'blocked' })
    }
  })
  it('follows a safe redirect chain', async () => {
    const { svc, calls } = service((url) => host(url) === 'a.example'
      ? new Response(null, { status: 307, headers: { location: 'https://b.example/final' } })
      : new Response('{"ok":true}'))
    expect(await svc.fetch({ url: 'https://a.example/', as: 'json' })).toMatchObject({ status: 'ok', data: { ok: true } })
    expect(calls.map((c) => c.url)).toEqual(['https://a.example/', 'https://b.example/final'])
  })
  it('never forwards the API key to another origin on redirect', async () => {
    const { svc, calls } = service((url) => host(url) === 'api.exa.ai'
      ? new Response(null, { status: 308, headers: { location: 'https://other.example/search' } })
      : new Response('{"results":[]}'))
    expect(await svc.search({ query: 'q' })).toMatchObject({ status: 'ok' })
    expect((calls[0]!.init?.headers as Record<string, string>)['x-api-key']).toBe('k')
    expect((calls[1]!.init?.headers as Record<string, string>)['x-api-key']).toBeUndefined()
  })
  it('stops after too many redirects', async () => {
    let n = 0
    const { svc } = service(() => new Response(null, { status: 302, headers: { location: `https://r${++n}.example/` } }))
    expect(await svc.fetch({ url: 'https://r0.example/', as: 'json' })).toMatchObject({ status: 'error', reason: 'http' })
    expect(n).toBe(6)
  })
  it('applies the per-host rate limit to each redirect hop', async () => {
    const { svc } = service((url) => host(url) === 'a.example'
      ? new Response(null, { status: 302, headers: { location: 'https://b.example/' } })
      : new Response('{}'), publicDns, 1)
    // Exhaust b.example's single token first.
    expect(await svc.fetch({ url: 'https://b.example/', as: 'json' })).toMatchObject({ status: 'ok' })
    expect(await svc.fetch({ url: 'https://a.example/', as: 'json' })).toMatchObject({ status: 'error', reason: 'rate-limited' })
  })
})
