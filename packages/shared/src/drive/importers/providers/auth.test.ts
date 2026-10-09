/**
 * Unit tests for the shared cloud-import auth manager.
 *
 * No disk, no network: tokens use the in-memory store and all HTTP goes through
 * an injected fake fetch.
 */
import { describe, test, expect } from 'bun:test'
import {
  ImportAuthManager,
  ImportProviderError,
  InMemoryImportTokenStore,
  fetchWithAuthRetry,
  type ImportTokens,
} from './auth'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const FAR_FUTURE = 4_000_000_000_000

describe('ImportAuthManager', () => {
  test('caches tokens and persists writes to the store', async () => {
    const store = new InMemoryImportTokenStore()
    const auth = new ImportAuthManager({ store })

    expect(await auth.getTokens('google-drive')).toBeNull()
    await auth.setTokens('google-drive', { accessToken: 'a', refreshToken: 'r', expiresAt: FAR_FUTURE })
    expect((await auth.getTokens('google-drive'))?.accessToken).toBe('a')

    // A fresh manager reading the same store sees the persisted token.
    const auth2 = new ImportAuthManager({ store })
    expect((await auth2.getTokens('google-drive'))?.refreshToken).toBe('r')

    await auth.clearTokens('google-drive')
    expect(await auth.getTokens('google-drive')).toBeNull()
    expect(await auth2.getTokens('google-drive')).toBeNull()
  })

  test('needsRefresh honors the skew and requires a refresh token', () => {
    const now = 1_000_000
    const auth = new ImportAuthManager({ store: new InMemoryImportTokenStore(), now: () => now, skewMs: 60_000 })

    expect(auth.needsRefresh({ accessToken: 'a', refreshToken: 'r', expiresAt: now + 120_000 })).toBe(false)
    expect(auth.needsRefresh({ accessToken: 'a', refreshToken: 'r', expiresAt: now + 30_000 })).toBe(true)
    expect(auth.needsRefresh({ accessToken: 'a', refreshToken: 'r', expiresAt: now - 1 })).toBe(true)
    // No refresh token → never "needs refresh" (nothing to do).
    expect(auth.needsRefresh({ accessToken: 'a', expiresAt: now - 1 })).toBe(false)
    // Unknown lifetime → do not speculatively refresh.
    expect(auth.needsRefresh({ accessToken: 'a', refreshToken: 'r' })).toBe(false)
  })

  test('refreshIfNeeded refreshes only an expiring token and persists the result', async () => {
    const store = new InMemoryImportTokenStore()
    const now = 1_000_000
    const auth = new ImportAuthManager({ store, now: () => now, skewMs: 60_000 })
    await auth.setTokens('onedrive', { accessToken: 'old', refreshToken: 'rt', expiresAt: now + 10_000 })

    let calls = 0
    auth.registerRefresher('onedrive', async (refreshToken) => {
      calls += 1
      return { accessToken: 'fresh', refreshToken, expiresAt: now + 3_600_000 }
    })

    const refreshed = await auth.refreshIfNeeded('onedrive')
    expect(calls).toBe(1)
    expect(refreshed.accessToken).toBe('fresh')
    expect((await store.load('onedrive'))?.accessToken).toBe('fresh')

    // Now valid long enough → no second refresh.
    await auth.refreshIfNeeded('onedrive')
    expect(calls).toBe(1)
  })

  test('refresh preserves the old refresh token when the server does not rotate it', async () => {
    const auth = new ImportAuthManager({ store: new InMemoryImportTokenStore(), now: () => 0 })
    await auth.setTokens('yandex-disk', { accessToken: 'old', refreshToken: 'keep-me', expiresAt: 0 })
    auth.registerRefresher('yandex-disk', async () => ({ accessToken: 'new' }))
    const result = await auth.refresh('yandex-disk')
    expect(result.accessToken).toBe('new')
    expect(result.refreshToken).toBe('keep-me')
  })

  test('requireTokens throws a typed auth-missing error', async () => {
    const auth = new ImportAuthManager({ store: new InMemoryImportTokenStore() })
    await expect(auth.requireTokens('google-drive')).rejects.toBeInstanceOf(ImportProviderError)
    try {
      await auth.requireTokens('google-drive')
    } catch (error) {
      expect((error as ImportProviderError).code).toBe('auth-missing')
    }
  })
})

describe('fetchWithAuthRetry', () => {
  test('retries exactly once after a 401 by refreshing the token', async () => {
    const store = new InMemoryImportTokenStore()
    const now = 1_000_000
    const auth = new ImportAuthManager({ store, now: () => now })
    await auth.setTokens('google-drive', { accessToken: 'stale', refreshToken: 'rt', expiresAt: now + 3_600_000 })

    const seenTokens: string[] = []
    let refreshed = 0
    auth.registerRefresher('google-drive', async (refreshToken) => {
      refreshed += 1
      return { accessToken: 'fresh', refreshToken, expiresAt: now + 3_600_000 }
    })

    const request = async (accessToken: string): Promise<Response> => {
      seenTokens.push(accessToken)
      return accessToken === 'fresh' ? json({ ok: true }) : json({ error: 'invalid_token' }, 401)
    }

    const { response, accessToken } = await fetchWithAuthRetry({ auth, provider: 'google-drive', request })
    expect(response.status).toBe(200)
    expect(accessToken).toBe('fresh')
    expect(seenTokens).toEqual(['stale', 'fresh'])
    expect(refreshed).toBe(1)
  })

  test('does not loop: a second 401 surfaces as unauthorized', async () => {
    const store = new InMemoryImportTokenStore()
    const auth = new ImportAuthManager({ store, now: () => 0 })
    await auth.setTokens('onedrive', { accessToken: 'a', refreshToken: 'rt', expiresAt: FAR_FUTURE })
    auth.registerRefresher('onedrive', async (refreshToken) => ({ accessToken: 'b', refreshToken, expiresAt: FAR_FUTURE }))

    let calls = 0
    const request = async (): Promise<Response> => {
      calls += 1
      return json({ error: 'invalid_token' }, 401)
    }
    await expect(fetchWithAuthRetry({ auth, provider: 'onedrive', request })).rejects.toMatchObject({
      name: 'ImportProviderError',
      code: 'unauthorized',
    })
    expect(calls).toBe(2)
  })

  test('401 without a refresh token is unauthorized, no retry', async () => {
    const auth = new ImportAuthManager({ store: new InMemoryImportTokenStore(), now: () => 0 })
    await auth.setTokens('yandex-disk', { accessToken: 'only', expiresAt: FAR_FUTURE })
    let calls = 0
    const request = async (): Promise<Response> => {
      calls += 1
      return json({ error: 'invalid_token' }, 401)
    }
    await expect(fetchWithAuthRetry({ auth, provider: 'yandex-disk', request })).rejects.toMatchObject({
      code: 'unauthorized',
    })
    expect(calls).toBe(1)
  })
})

describe('ImportProviderError', () => {
  test('carries code, provider, status and retryability', () => {
    const error = new ImportProviderError('nope', { code: 'rate-limited', provider: 'google-drive', status: 429, retryable: true })
    expect(error.code).toBe('rate-limited')
    expect(error.provider).toBe('google-drive')
    expect(error.status).toBe(429)
    expect(error.retryable).toBe(true)
    expect(error).toBeInstanceOf(Error)
  })
})

describe('token type sanity', () => {
  test('ImportTokens shape is provider-neutral', () => {
    const tokens: ImportTokens = { accessToken: 'x', refreshToken: 'y', expiresAt: 1, tokenType: 'Bearer' }
    expect(tokens.accessToken).toBe('x')
  })
})