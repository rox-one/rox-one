/**
 * secrets/providers/infisical.ts — Infisical v3 raw secrets API provider.
 * All HTTP is stubbed via an injected fetch; no network in tests.
 */
import { describe, expect, it } from 'bun:test'
import { SecretResolveError } from '../types.ts'
import { InfisicalProvider, type FetchLike } from '../providers/infisical.ts'

const BASE_OPTS = {
  baseUrl: 'https://infisical.test',
  token: 'st.test-token',
  projectId: 'proj-123',
  environment: 'dev',
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): {
  fetch: FetchLike
  calls: { url: string; init?: RequestInit }[]
} {
  const calls: { url: string; init?: RequestInit }[] = []
  const fetchFn: FetchLike = async (url, init) => {
    calls.push({ url: String(url), init })
    return handler(String(url), init)
  }
  return { fetch: fetchFn, calls }
}

describe('InfisicalProvider availability', () => {
  it('is available when token, projectId and environment are configured', async () => {
    const p = new InfisicalProvider({ ...BASE_OPTS, fetch: stubFetch(() => jsonResponse(404, {})).fetch })
    expect(p.id).toBe('infisical')
    expect(await p.isAvailable()).toBe(true)
  })

  it('is unavailable without a token', async () => {
    const p = new InfisicalProvider({ ...BASE_OPTS, token: undefined, fetch: stubFetch(() => jsonResponse(200, {})).fetch })
    expect(await p.isAvailable()).toBe(false)
  })

  it('is unavailable without projectId or environment', async () => {
    const f = stubFetch(() => jsonResponse(200, {}))
    expect(await new InfisicalProvider({ ...BASE_OPTS, projectId: undefined, fetch: f.fetch }).isAvailable()).toBe(false)
    expect(await new InfisicalProvider({ ...BASE_OPTS, environment: undefined, fetch: f.fetch }).isAvailable()).toBe(false)
  })

  it('resolve throws INFISICAL_UNAVAILABLE when not configured', async () => {
    const p = new InfisicalProvider({ token: undefined, fetch: stubFetch(() => jsonResponse(200, {})).fetch })
    try {
      await p.resolve({ name: 'x', ref: 'X' })
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(SecretResolveError)
      expect((e as SecretResolveError).code).toBe('INFISICAL_UNAVAILABLE')
    }
  })
})

describe('InfisicalProvider.resolve', () => {
  it('fetches the v3 raw endpoint with Bearer auth and scope query params', async () => {
    const { fetch, calls } = stubFetch(() =>
      jsonResponse(200, { secret: { secretKey: 'OPENAI_API_KEY', secretValue: 'sk-from-infisical' } }),
    )
    const p = new InfisicalProvider({ ...BASE_OPTS, secretPath: '/prod', fetch })
    const value = await p.resolve({ name: 'openai', ref: 'OPENAI_API_KEY' })

    expect(value).toBe('sk-from-infisical')
    expect(calls).toHaveLength(1)
    const { url, init } = calls[0]!
    expect(url.startsWith('https://infisical.test/api/v3/secrets/raw/OPENAI_API_KEY?')).toBe(true)
    expect(url).toContain('workspaceId=proj-123')
    expect(url).toContain('environment=dev')
    expect(url).toContain('secretPath=%2Fprod')
    expect((init?.headers as Record<string, string>)['Authorization']).toBe('Bearer st.test-token')
  })

  it('uses the logical name as the default ref and URL-encodes it', async () => {
    const { fetch, calls } = stubFetch(() => jsonResponse(404, { message: 'not found' }))
    const p = new InfisicalProvider({ ...BASE_OPTS, fetch })
    await p.resolve({ name: 'MY KEY/1' })
    expect(calls[0]!.url).toContain('/api/v3/secrets/raw/MY%20KEY%2F1?')
  })

  it('returns null on 404 (secret not found)', async () => {
    const { fetch } = stubFetch(() => jsonResponse(404, { statusCode: 404, message: 'Secret not found' }))
    const p = new InfisicalProvider({ ...BASE_OPTS, fetch })
    expect(await p.resolve({ name: 'x', ref: 'MISSING' })).toBeNull()
  })

  it('maps 401 and 403 to INFISICAL_AUTH_FAILED', async () => {
    for (const status of [401, 403]) {
      const { fetch } = stubFetch(() => jsonResponse(status, { statusCode: status, message: 'nope' }))
      const p = new InfisicalProvider({ ...BASE_OPTS, fetch })
      try {
        await p.resolve({ name: 'x', ref: 'X' })
        throw new Error('should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(SecretResolveError)
        expect((e as SecretResolveError).code).toBe('INFISICAL_AUTH_FAILED')
        expect((e as SecretResolveError).provider).toBe('infisical')
      }
    }
  })

  it('maps other HTTP statuses to INFISICAL_UNAVAILABLE', async () => {
    const { fetch } = stubFetch(() => jsonResponse(500, { statusCode: 500, message: 'boom' }))
    const p = new InfisicalProvider({ ...BASE_OPTS, fetch })
    try {
      await p.resolve({ name: 'x', ref: 'X' })
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as SecretResolveError).code).toBe('INFISICAL_UNAVAILABLE')
    }
  })

  it('maps network failures to INFISICAL_UNAVAILABLE', async () => {
    const fetch: FetchLike = async () => {
      throw new TypeError('fetch failed')
    }
    const p = new InfisicalProvider({ ...BASE_OPTS, fetch })
    try {
      await p.resolve({ name: 'x', ref: 'X' })
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as SecretResolveError).code).toBe('INFISICAL_UNAVAILABLE')
    }
  })

  it('maps malformed success payloads to INFISICAL_UNAVAILABLE', async () => {
    const { fetch } = stubFetch(() => jsonResponse(200, { unexpected: true }))
    const p = new InfisicalProvider({ ...BASE_OPTS, fetch })
    try {
      await p.resolve({ name: 'x', ref: 'X' })
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as SecretResolveError).code).toBe('INFISICAL_UNAVAILABLE')
    }
  })

  it('caches hits within the TTL and refetches after expiry', async () => {
    let clock = 1_000
    const { fetch, calls } = stubFetch(() =>
      jsonResponse(200, { secret: { secretKey: 'K', secretValue: 'cached-value' } }),
    )
    const p = new InfisicalProvider({ ...BASE_OPTS, fetch, ttlMs: 60_000, now: () => clock })

    expect(await p.resolve({ name: 'k', ref: 'K' })).toBe('cached-value')
    expect(await p.resolve({ name: 'k', ref: 'K' })).toBe('cached-value')
    expect(calls).toHaveLength(1)

    clock += 61_000
    expect(await p.resolve({ name: 'k', ref: 'K' })).toBe('cached-value')
    expect(calls).toHaveLength(2)
  })

  it('does not cache misses', async () => {
    const { fetch, calls } = stubFetch(() => jsonResponse(404, {}))
    const p = new InfisicalProvider({ ...BASE_OPTS, fetch })
    expect(await p.resolve({ name: 'k', ref: 'K' })).toBeNull()
    expect(await p.resolve({ name: 'k', ref: 'K' })).toBeNull()
    expect(calls).toHaveLength(2)
  })
})
