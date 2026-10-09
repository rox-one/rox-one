import { afterEach, describe, expect, it } from 'bun:test'
import {
  TelegramLinkError,
  createTelegramLinkClient,
  type TelegramLinkErrorCode,
} from '../client.ts'

const previous = globalThis.fetch
afterEach(() => { globalThis.fetch = previous })

const respond = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })

function client(fetchImpl: typeof fetch) {
  return createTelegramLinkClient({ baseUrl: 'https://link.test/', token: 'tok_secret', fetchImpl })
}

describe('telegram link client', () => {
  it('starts a link with the bearer token and account id, mapping expiresAt to ms', async () => {
    const wire: Array<{ url: string; method?: string; auth?: string; body?: unknown }> = []
    const fetchImpl = (async (url: Parameters<typeof fetch>[0], options?: Parameters<typeof fetch>[1]) => {
      wire.push({
        url: String(url),
        method: options?.method,
        auth: (options?.headers as Record<string, string> | undefined)?.authorization,
        body: options?.body ? JSON.parse(String(options.body)) : undefined,
      })
      return respond({ linkId: 'link-1', deepLink: 'tg://resolve?domain=rox_bot&start=1', expiresAt: '2100-01-01T00:00:00.000Z' })
    }) as unknown as typeof fetch

    const result = await client(fetchImpl).start('acct-1')
    expect(wire[0]?.url).toBe('https://link.test/api/link/start')
    expect(wire[0]?.method).toBe('POST')
    expect(wire[0]?.auth).toBe('Bearer tok_secret')
    expect(wire[0]?.body).toEqual({ accountId: 'acct-1' })
    expect(result.linkId).toBe('link-1')
    expect(result.deepLink).toContain('tg://')
    expect(result.expiresAt).toBe(Date.parse('2100-01-01T00:00:00.000Z'))
  })

  it('reads status with an encoded link id', async () => {
    let seen = ''
    const fetchImpl = (async (url: Parameters<typeof fetch>[0]) => {
      seen = String(url)
      return respond({ status: 'code_issued', code: 'ABCD1234', phoneMasked: '+7 *** 12' })
    }) as unknown as typeof fetch

    const result = await client(fetchImpl).status('a b/c')
    expect(seen).toBe('https://link.test/api/link/status?linkId=a%20b%2Fc')
    expect(result).toEqual({ status: 'code_issued', code: 'ABCD1234', phoneMasked: '+7 *** 12' })
  })

  it('confirms a code and accepts an expired envelope', async () => {
    const fetchImpl = (async () => respond({ status: 'confirmed' })) as unknown as typeof fetch
    await expect(client(fetchImpl).confirm('link-1', 'ABCD1234')).resolves.toEqual({ status: 'confirmed' })

    const expired = (async () => respond({ status: 'expired' })) as unknown as typeof fetch
    await expect(client(expired).confirm('link-1', 'ABCD1234')).rejects.toThrow('expired')
  })

  it('maps transport failures to stable, log-safe codes', async () => {
    const cases: Array<[number, TelegramLinkErrorCode]> = [
      [401, 'unauthorized'],
      [404, 'not_found'],
      [409, 'invalid_code'],
      [410, 'expired'],
      [429, 'rate_limited'],
      [500, 'server'],
      [418, 'http_error'],
    ]
    for (const [status, code] of cases) {
      const fetchImpl = (async () => respond({ error: 'nope' }, status)) as unknown as typeof fetch
      await expect(client(fetchImpl).status('link-1')).rejects.toMatchObject({ code })
    }

    const down = (async () => { throw new TypeError('socket hang up') }) as unknown as typeof fetch
    await expect(client(down).status('link-1')).rejects.toMatchObject({ code: 'network' })
  })

  it('rejects malformed envelopes and never leaks the token', async () => {
    const malformed = (async () => respond({ status: 'bogus' })) as unknown as typeof fetch
    const failure = await client(malformed).status('link-1').catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(TelegramLinkError)
    expect(JSON.stringify(failure)).not.toContain('tok_secret')

    const started = (async () => respond({ linkId: 'l', deepLink: '' })) as unknown as typeof fetch
    await expect(client(started).start('acct-1')).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('refuses to construct without a base url or token', () => {
    expect(() => createTelegramLinkClient({ baseUrl: '', token: 't' })).toThrow('missing base url')
    expect(() => createTelegramLinkClient({ baseUrl: 'https://x', token: '' })).toThrow('missing token')
  })
})