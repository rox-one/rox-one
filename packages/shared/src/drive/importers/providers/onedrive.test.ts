/**
 * Mocked-fetch tests for the OneDrive (Microsoft Graph) import provider.
 * Covers @odata.nextLink pagination, ranged download, and 401 → refresh → retry.
 */
import { describe, test, expect } from 'bun:test'
import { ImportAuthManager, InMemoryImportTokenStore } from './auth'
import {
  OneDriveProvider,
  startMsDeviceCode,
  pollMsDeviceToken,
} from './onedrive'

const FAR_FUTURE = 4_000_000_000_000

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

async function authed(tokens = { accessToken: 'tok', refreshToken: 'rt', expiresAt: FAR_FUTURE }) {
  const auth = new ImportAuthManager({ store: new InMemoryImportTokenStore(), now: () => 1_000_000 })
  await auth.setTokens('onedrive', tokens)
  return auth
}

describe('OneDriveProvider.list', () => {
  test('follows @odata.nextLink to completion and maps entries', async () => {
    const auth = await authed()
    const urls: string[] = []
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      urls.push(url)
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer tok')
      if (url.includes('$skiptoken')) {
        return json({ value: [{ id: 'x2', name: 'b.txt', file: {}, size: 7 }] })
      }
      return json({
        value: [
          { id: 'f1', name: 'Папка', folder: { childCount: 1 } },
          { id: 'x1', name: 'a.txt', file: {}, size: 5, lastModifiedDateTime: '2026-01-02T00:00:00Z' },
        ],
        '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/drive/root/children?$skiptoken=abc',
      })
    }) as unknown as typeof fetch

    const provider = new OneDriveProvider({ auth, fetchImpl })
    const entries = await provider.list()

    expect(urls).toHaveLength(2)
    expect(urls[0]).toBe('https://graph.microsoft.com/v1.0/me/drive/root/children?$top=200')
    expect(urls[1]).toContain('$skiptoken=abc')
    expect(entries).toHaveLength(3)
    expect(entries[0]).toMatchObject({ id: 'f1', kind: 'folder' })
    expect(entries[1]).toMatchObject({ id: 'x1', kind: 'file', sizeBytes: 5, modifiedAt: '2026-01-02T00:00:00Z' })
    expect(entries[2]).toMatchObject({ id: 'x2', kind: 'file' })
  })

  test('uses the folder-scoped children endpoint for a folder id', async () => {
    const auth = await authed()
    let requested = ''
    const fetchImpl = (async (input: string | URL | Request) => {
      requested = String(input)
      return json({ value: [] })
    }) as unknown as typeof fetch
    const provider = new OneDriveProvider({ auth, fetchImpl })
    await provider.list('folder id/42')
    expect(requested).toBe('https://graph.microsoft.com/v1.0/me/drive/items/folder%20id%2F42/children?$top=200')
  })
})

describe('OneDriveProvider.stream', () => {
  test('sends an inclusive Range and streams the body', async () => {
    const auth = await authed()
    const ranges: (string | null)[] = []
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe('https://graph.microsoft.com/v1.0/me/drive/items/file-1/content')
      ranges.push(new Headers(init?.headers).get('range'))
      return new Response('part', { status: 206, headers: { 'content-range': 'bytes 10-13/100' } })
    }) as unknown as typeof fetch

    const provider = new OneDriveProvider({ auth, fetchImpl })
    const stream = await provider.stream('file-1', { start: 10, end: 13 })
    expect(await new Response(stream).text()).toBe('part')
    expect(ranges).toEqual(['bytes=10-13'])
  })

  test('refreshes on 401 and retries once', async () => {
    const auth = await authed({ accessToken: 'stale', refreshToken: 'rt', expiresAt: FAR_FUTURE })
    const authHeaders: (string | null)[] = []
    let tokenPosts = 0
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') {
        tokenPosts += 1
        expect(String(input)).toBe('https://login.microsoftonline.com/consumers/oauth2/v2.0/token')
        expect(new URLSearchParams(String(init.body)).get('grant_type')).toBe('refresh_token')
        return json({ access_token: 'fresh', refresh_token: 'rt2', expires_in: 3600, token_type: 'Bearer' })
      }
      const header = new Headers(init?.headers).get('authorization')
      authHeaders.push(header)
      return header === 'Bearer stale' ? json({ error: 'InvalidAuthenticationToken' }, 401) : new Response('data', { status: 200 })
    }) as unknown as typeof fetch

    const provider = new OneDriveProvider({ auth, fetchImpl })
    const stream = await provider.stream('f')
    expect(await new Response(stream).text()).toBe('data')
    expect(authHeaders).toEqual(['Bearer stale', 'Bearer fresh'])
    expect(tokenPosts).toBe(1)
    expect((await auth.getTokens('onedrive'))?.accessToken).toBe('fresh')
  })
})

describe('Microsoft device code flow', () => {
  test('starts the flow and polls through authorization_pending to success', async () => {
    const started = await startMsDeviceCode({
      clientId: 'cid',
      fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
        expect(String(input)).toBe('https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode')
        const body = new URLSearchParams(String(init?.body))
        expect(body.get('scope')).toBe('Files.Read offline_access User.Read')
        return json({ device_code: 'dc', user_code: 'UC', verification_uri: 'https://microsoft.com/devicelogin', expires_in: 900, interval: 1, message: 'go' })
      }) as unknown as typeof fetch,
    })
    expect(started.userCode).toBe('UC')
    expect(started.interval).toBe(1)

    let n = 0
    const tokens = await pollMsDeviceToken({
      deviceCode: started.deviceCode,
      clientId: 'cid',
      interval: 1,
      sleep: async () => {},
      now: () => 0,
      fetchImpl: (async (_input: string | URL | Request, init?: RequestInit) => {
        n += 1
        expect(new URLSearchParams(String(init?.body)).get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:device_code')
        if (n === 1) return json({ error: 'authorization_pending' }, 400)
        return json({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 })
      }) as unknown as typeof fetch,
    })
    expect(tokens.accessToken).toBe('at')
    expect(n).toBe(2)
  })
})