/**
 * Mocked-fetch tests for the Google Drive import provider.
 * Covers full list pagination, ranged download, and 401 → refresh → retry.
 */
import { describe, test, expect } from 'bun:test'
import { ImportAuthManager, InMemoryImportTokenStore } from './auth'
import {
  GoogleDriveProvider,
  buildGoogleAuthUrl,
  generateGooglePkce,
  completeGoogleAuth,
  startGoogleDeviceCode,
  pollGoogleDeviceToken,
  listGoogleDriveTree,
  googleSkipReason,
  GOOGLE_NATIVE_SKIP_REASON,
  GOOGLE_SCOPES,
} from './google-drive'

const FAR_FUTURE = 4_000_000_000_000

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

async function authed(tokens: { accessToken: string; refreshToken?: string; expiresAt?: number } = { accessToken: 'tok', refreshToken: 'rt', expiresAt: FAR_FUTURE }) {
  const auth = new ImportAuthManager({ store: new InMemoryImportTokenStore(), now: () => 1_000_000 })
  await auth.setTokens('google-drive', tokens)
  return auth
}

describe('GoogleDriveProvider.list', () => {
  test('paginates and maps files/folders with size and modifiedAt', async () => {
    const auth = await authed()
    const seen: string[] = []
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input))
      expect(url.pathname).toBe('/drive/v3/files')
      expect(url.searchParams.get('q')).toBe("'root' in parents and trashed=false")
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer tok')
      const pageToken = url.searchParams.get('pageToken')
      seen.push(pageToken ?? 'first')
      if (!pageToken) {
        return json({
          nextPageToken: 'T2',
          files: [
            { id: 'f1', name: 'Папка', mimeType: 'application/vnd.google-apps.folder', modifiedTime: '2026-01-01T00:00:00Z' },
            { id: 'x1', name: 'a.txt', mimeType: 'text/plain', size: '12', modifiedTime: '2026-01-02T00:00:00Z' },
          ],
        })
      }
      return json({ files: [{ id: 'x2', name: 'b.txt', mimeType: 'text/plain' }] })
    }) as unknown as typeof fetch

    const provider = new GoogleDriveProvider({ auth, fetchImpl })
    const entries = await provider.list()

    expect(seen).toEqual(['first', 'T2'])
    expect(entries).toHaveLength(3)
    expect(entries[0]).toMatchObject({ id: 'f1', name: 'Папка', kind: 'folder' })
    expect(entries[0]?.sizeBytes).toBeUndefined()
    expect(entries[1]).toMatchObject({ id: 'x1', kind: 'file', sizeBytes: 12, modifiedAt: '2026-01-02T00:00:00Z' })
    expect(entries[2]).toMatchObject({ id: 'x2', kind: 'file' })
  })

  test('addresses a nested folder via q and escapes quotes', async () => {
    const auth = await authed()
    let q = ''
    const fetchImpl = (async (input: string | URL | Request) => {
      q = new URL(String(input)).searchParams.get('q') ?? ''
      return json({ files: [] })
    }) as unknown as typeof fetch
    const provider = new GoogleDriveProvider({ auth, fetchImpl })
    await provider.list("it's")
    expect(q).toBe("'it\\'s' in parents and trashed=false")
  })

  test('skips native Google documents that have no downloadable bytes', async () => {
    const auth = await authed()
    const fetchImpl = (async () => json({
      files: [
        { id: 'd1', name: 'Отчёт', mimeType: 'application/vnd.google-apps.document', modifiedTime: '2026-02-01T00:00:00Z' },
        { id: 's1', name: 'Бюджет', mimeType: 'application/vnd.google-apps.spreadsheet' },
        { id: 'x1', name: 'a.txt', mimeType: 'text/plain', size: '3' },
        { id: 'f1', name: 'Папка', mimeType: 'application/vnd.google-apps.folder' },
      ],
    })) as unknown as typeof fetch
    const provider = new GoogleDriveProvider({ auth, fetchImpl })
    const entries = await provider.list()

    expect(entries.map((entry) => entry.id)).toEqual(['x1', 'f1'])
    expect(entries.map((entry) => entry.kind)).toEqual(['file', 'folder'])
    expect(entries.some((entry) => entry.id === 'd1' || entry.id === 's1')).toBe(false)
  })

  test('googleSkipReason marks native documents but keeps folders and binaries', () => {
    expect(googleSkipReason('application/vnd.google-apps.document')).toBe(GOOGLE_NATIVE_SKIP_REASON)
    expect(googleSkipReason('application/vnd.google-apps.spreadsheet')).toBe(GOOGLE_NATIVE_SKIP_REASON)
    expect(googleSkipReason('application/vnd.google-apps.presentation')).toBe(GOOGLE_NATIVE_SKIP_REASON)
    expect(googleSkipReason('application/vnd.google-apps.folder')).toBeNull()
    expect(googleSkipReason('text/plain')).toBeNull()
    expect(googleSkipReason(undefined)).toBeNull()
  })
})

describe('GoogleDriveProvider.stream', () => {
  test('honors an inclusive byte range and streams the response body', async () => {
    const auth = await authed()
    const ranges: (string | null)[] = []
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      ranges.push(new Headers(init?.headers).get('range'))
      expect(String(input)).toContain('/files/file-1?alt=media')
      return new Response('hello', { status: 206, headers: { 'content-range': 'bytes 0-4/5' } })
    }) as unknown as typeof fetch

    const provider = new GoogleDriveProvider({ auth, fetchImpl })
    const stream = await provider.stream('file-1', { start: 0, end: 4 })

    expect(await new Response(stream).text()).toBe('hello')
    expect(ranges).toEqual(['bytes=0-4'])
  })

  test('refreshes on 401 and retries the download exactly once', async () => {
    const auth = await authed({ accessToken: 'stale', refreshToken: 'rt', expiresAt: FAR_FUTURE })
    const authHeaders: (string | null)[] = []
    let tokenPosts = 0
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') {
        tokenPosts += 1
        const body = new URLSearchParams(String(init.body))
        expect(body.get('grant_type')).toBe('refresh_token')
        return json({ access_token: 'fresh', expires_in: 3600, token_type: 'Bearer' })
      }
      const header = new Headers(init?.headers).get('authorization')
      authHeaders.push(header)
      return header === 'Bearer stale' ? json({ error: 'invalid_token' }, 401) : new Response('data', { status: 200 })
    }) as unknown as typeof fetch

    const provider = new GoogleDriveProvider({ auth, fetchImpl })
    const stream = await provider.stream('f')

    expect(await new Response(stream).text()).toBe('data')
    expect(authHeaders).toEqual(['Bearer stale', 'Bearer fresh'])
    expect(tokenPosts).toBe(1)
    expect((await auth.getTokens('google-drive'))?.accessToken).toBe('fresh')
  })
})

describe('Google OAuth helpers', () => {
  test('buildGoogleAuthUrl carries PKCE, scopes and offline access', () => {
    const pkce = generateGooglePkce()
    expect(pkce.codeChallenge).not.toBe(pkce.codeVerifier)
    const url = new URL(buildGoogleAuthUrl({
      redirectUri: 'http://127.0.0.1:1234/cb',
      clientId: 'cid',
      state: 'st',
      codeChallenge: pkce.codeChallenge,
    }))
    expect(`${url.origin}${url.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('code_challenge')).toBe(pkce.codeChallenge)
    expect(url.searchParams.get('scope')).toContain('https://www.googleapis.com/auth/drive.readonly')
    expect(url.searchParams.get('scope')).not.toContain('drive.file')
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:1234/cb')
  })

  test('GOOGLE_SCOPES requests read-only Drive access and never drive.file', () => {
    expect(GOOGLE_SCOPES).toContain('openid')
    expect(GOOGLE_SCOPES).toContain('email')
    expect(GOOGLE_SCOPES).toContain('https://www.googleapis.com/auth/drive.readonly')
    expect(GOOGLE_SCOPES.some((scope) => scope.includes('drive.file'))).toBe(false)
  })

  test('completeGoogleAuth exchanges the code and computes expiresAt', async () => {
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe('https://oauth2.googleapis.com/token')
      const body = new URLSearchParams(String(init?.body))
      expect(body.get('grant_type')).toBe('authorization_code')
      expect(body.get('code_verifier')).toBe('verifier')
      return json({ access_token: 'at', refresh_token: 'rt', expires_in: 3599, token_type: 'Bearer', scope: 's' })
    }) as unknown as typeof fetch

    const tokens = await completeGoogleAuth({
      code: 'code', codeVerifier: 'verifier', redirectUri: 'http://127.0.0.1/cb',
      clientId: 'cid', fetchImpl, now: () => 1000,
    })
    expect(tokens.accessToken).toBe('at')
    expect(tokens.refreshToken).toBe('rt')
    expect(tokens.expiresAt).toBe(1000 + 3599 * 1000)
  })

  test('device code start + poll handles pending, slow_down, then success', async () => {
    const started = await startGoogleDeviceCode({
      clientId: 'cid',
      fetchImpl: (async (_input: string | URL | Request, init?: RequestInit) => {
        const body = new URLSearchParams(String(init?.body))
        expect(body.get('client_id')).toBe('cid')
        expect(body.get('scope')).toContain('https://www.googleapis.com/auth/drive.readonly')
        return json({ device_code: 'dc', user_code: 'UC', verification_url: 'https://g.co/device', expires_in: 600, interval: 1 })
      }) as unknown as typeof fetch,
    })
    expect(started).toEqual({ deviceCode: 'dc', userCode: 'UC', verificationUrl: 'https://g.co/device', expiresIn: 600, interval: 1 })

    let n = 0
    const sleeps: number[] = []
    const tokens = await pollGoogleDeviceToken({
      deviceCode: 'dc',
      clientId: 'cid',
      interval: 1,
      sleep: async (ms) => { sleeps.push(ms) },
      now: () => 0,
      fetchImpl: (async () => {
        n += 1
        if (n === 1) return json({ error: 'authorization_pending' }, 400)
        if (n === 2) return json({ error: 'slow_down' }, 400)
        return json({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 })
      }) as unknown as typeof fetch,
    })
    expect(tokens.accessToken).toBe('at')
    expect(sleeps).toEqual([1000, 6000])
  })
})

describe('listGoogleDriveTree', () => {
  test('nests folder children recursively', async () => {
    // Test double: only `list` is exercised by the tree walker.
    const fakeProvider = {
      list: async (folderId?: string) => {
        if (!folderId) {
          return [
            { id: 'f1', name: 'Docs', kind: 'folder' as const },
            { id: 'x1', name: 'root.txt', kind: 'file' as const },
          ]
        }
        return [{ id: 'c1', name: 'inner.txt', kind: 'file' as const }]
      },
    } as unknown as GoogleDriveProvider

    const tree = await listGoogleDriveTree(fakeProvider)
    expect(tree).toHaveLength(2)
    expect(tree[0]?.children?.map((n) => n.name)).toEqual(['inner.txt'])
    expect(tree[1]?.children).toBeUndefined()
  })
})