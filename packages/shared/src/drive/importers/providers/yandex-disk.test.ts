/**
 * Mocked-fetch tests for the Yandex Disk import provider.
 * Covers limit/offset pagination, ranged download via the pre-signed href, and
 * 401 → refresh → retry.
 */
import { describe, test, expect } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ImportAuthManager, InMemoryImportTokenStore } from './auth'
import { createImportJobRunner } from '../job-runner'
import {
  YandexDiskProvider,
  buildYandexAuthUrl,
  completeYandexAuth,
} from './yandex-disk'

const FAR_FUTURE = 4_000_000_000_000

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

async function authed(tokens = { accessToken: 'tok', refreshToken: 'rt', expiresAt: FAR_FUTURE }) {
  const auth = new ImportAuthManager({ store: new InMemoryImportTokenStore(), now: () => 1_000_000 })
  await auth.setTokens('yandex-disk', tokens)
  return auth
}

describe('YandexDiskProvider.list', () => {
  test('paginates with limit/offset until _embedded.total is reached', async () => {
    const auth = await authed()
    const offsets: string[] = []
    const fields: (string | null)[] = []
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input))
      expect(url.pathname).toBe('/v1/disk/resources')
      expect(url.searchParams.get('path')).toBe('disk:/')
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer tok')
      fields.push(url.searchParams.get('fields'))
      const offset = url.searchParams.get('offset') ?? ''
      offsets.push(offset)
      if (offset === '0') {
        return json({
          _embedded: {
            total: 3,
            items: [
              { name: 'Docs', path: 'disk:/Docs', type: 'dir', modified: '2026-01-01T00:00:00Z' },
              { name: 'a.txt', path: 'disk:/a.txt', type: 'file', size: 11, modified: '2026-01-02T00:00:00Z', mime_type: 'text/plain' },
            ],
          },
        })
      }
      return json({ _embedded: { total: 3, items: [{ name: 'b.txt', path: 'disk:/b.txt', type: 'file', size: 2, mime_type: 'application/octet-stream' }] } })
    }) as unknown as typeof fetch

    const provider = new YandexDiskProvider({ auth, fetchImpl, pageSize: 2 })
    const entries = await provider.list()

    expect(offsets).toEqual(['0', '2'])
    // The Disk API needs comma-separated dotted paths; the function-call syntax
    // `_embedded.items(...)` silently excludes the items array.
    expect(fields).toEqual([
      '_embedded.total,_embedded.items.name,_embedded.items.path,_embedded.items.type,_embedded.items.size,_embedded.items.modified,_embedded.items.mime_type',
      '_embedded.total,_embedded.items.name,_embedded.items.path,_embedded.items.type,_embedded.items.size,_embedded.items.modified,_embedded.items.mime_type',
    ])
    expect(entries).toHaveLength(3)
    expect(entries[0]).toMatchObject({ id: 'disk:/Docs', name: 'Docs', kind: 'folder' })
    expect(entries[1]).toMatchObject({ id: 'disk:/a.txt', kind: 'file', sizeBytes: 11, modifiedAt: '2026-01-02T00:00:00Z', mimeType: 'text/plain' })
    expect(entries[2]).toMatchObject({ id: 'disk:/b.txt', kind: 'file', mimeType: 'application/octet-stream' })
  })
})

describe('YandexDiskProvider.stream', () => {
  test('resolves the download href then applies the Range to the ranged GET', async () => {
    const auth = await authed()
    const ranges: (string | null)[] = []
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('https://cloud-api.yandex.net')) {
        expect(url).toContain('/resources/download?path=disk%3A%2Fa.txt')
        return json({ href: 'https://down.example/x?token=1', method: 'GET' })
      }
      expect(url).toBe('https://down.example/x?token=1')
      ranges.push(new Headers(init?.headers).get('range'))
      return new Response('abc', { status: 206 })
    }) as unknown as typeof fetch

    const provider = new YandexDiskProvider({ auth, fetchImpl })
    const stream = await provider.stream('disk:/a.txt', { start: 3, end: 5 })
    expect(await new Response(stream).text()).toBe('abc')
    expect(ranges).toEqual(['bytes=3-5'])
  })

  test('refreshes on 401 for the link request and retries once', async () => {
    const auth = await authed({ accessToken: 'stale', refreshToken: 'rt', expiresAt: FAR_FUTURE })
    const linkAuth: (string | null)[] = []
    let tokenPosts = 0
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'POST') {
        tokenPosts += 1
        expect(url).toBe('https://oauth.yandex.ru/token')
        expect(new URLSearchParams(String(init.body)).get('grant_type')).toBe('refresh_token')
        return json({ access_token: 'fresh', refresh_token: 'rt', expires_in: 3600 })
      }
      if (url.includes('/resources/download')) {
        const header = new Headers(init?.headers).get('authorization')
        linkAuth.push(header)
        return header === 'Bearer stale' ? json({ error: 'unauthorized' }, 401) : json({ href: 'https://down.example/x', method: 'GET' })
      }
      return new Response('ok', { status: 200 })
    }) as unknown as typeof fetch

    const provider = new YandexDiskProvider({ auth, fetchImpl })
    const stream = await provider.stream('disk:/f')
    expect(await new Response(stream).text()).toBe('ok')
    expect(linkAuth).toEqual(['Bearer stale', 'Bearer fresh'])
    expect(tokenPosts).toBe(1)
  })
})

describe('Yandex OAuth helpers', () => {
  test('buildYandexAuthUrl targets oauth.yandex.ru with the disk.read scope', () => {
    const url = new URL(buildYandexAuthUrl({ redirectUri: 'http://127.0.0.1:9/cb', clientId: 'cid', state: 'st' }))
    expect(`${url.origin}${url.pathname}`).toBe('https://oauth.yandex.ru/authorize')
    expect(url.searchParams.get('scope')).toBe('cloud_api:disk.read')
    expect(url.searchParams.get('response_type')).toBe('code')
  })

  test('completeYandexAuth posts the code and computes expiresAt', async () => {
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe('https://oauth.yandex.ru/token')
      const body = new URLSearchParams(String(init?.body))
      expect(body.get('grant_type')).toBe('authorization_code')
      expect(body.get('code')).toBe('c1')
      return json({ access_token: 'at', refresh_token: 'rt', expires_in: 3600, token_type: 'bearer' })
    }) as unknown as typeof fetch
    const tokens = await completeYandexAuth({ code: 'c1', clientId: 'cid', fetchImpl, now: () => 500 })
    expect(tokens.accessToken).toBe('at')
    expect(tokens.expiresAt).toBe(500 + 3600 * 1000)
  })
})

describe('YandexDiskProvider timeouts', () => {
  test('aborts a hung listing with a typed provider error', async () => {
    const auth = await authed()
    const fetchImpl = ((_input: string | URL | Request, init?: RequestInit) => {
      const { promise, reject } = Promise.withResolvers<Response>()
      const signal = init?.signal
      if (!signal) return promise
      if (signal.aborted) {
        reject(signal.reason)
        return promise
      }
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      return promise
    }) as unknown as typeof fetch
    const provider = new YandexDiskProvider({ auth, fetchImpl, requestTimeoutMs: 20 })
    await expect(provider.list()).rejects.toMatchObject({ name: 'ImportProviderError', code: 'network' })
  })

  test('does not abort a download that keeps producing bytes', async () => {
    const auth = await authed()
    // Real timers on purpose: exercises the live stall watchdog against a reader.
    // The window sits well above `bun test`'s stream-pull latency; the companion
    // stall test uses a tight window for the other side.
    const fetchImpl = (async (input: string | URL | Request) => {
      if (String(input).includes('/resources/download')) {
        return json({ href: 'https://down.example/x', method: 'GET' })
      }
      return new Response(new ReadableStream<Uint8Array>({
        async start(controller) {
          for (let i = 0; i < 3; i += 1) {
            await new Promise(resolve => setTimeout(resolve, 10))
            controller.enqueue(new Uint8Array([i]))
          }
          controller.close()
        },
      }), { status: 200 })
    }) as unknown as typeof fetch
    const provider = new YandexDiskProvider({ auth, fetchImpl, stallTimeoutMs: 5000 })
    const body = await provider.stream('disk:/f')
    expect(new Uint8Array(await new Response(body).arrayBuffer()).byteLength).toBe(3)
  })

  test('aborts a stalled download with a typed timeout error', async () => {
    const auth = await authed()
    const fetchImpl = (async (input: string | URL | Request) => {
      if (String(input).includes('/resources/download')) {
        return json({ href: 'https://down.example/x', method: 'GET' })
      }
      return new Response(
        new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([1])) } }),
        { status: 200 },
      )
    }) as unknown as typeof fetch
    const provider = new YandexDiskProvider({ auth, fetchImpl, stallTimeoutMs: 20 })
    const body = await provider.stream('disk:/f')
    await expect(new Response(body).arrayBuffer()).rejects.toMatchObject({ name: 'FetchTimeoutError' })
  })
})

describe('YandexDiskProvider content type propagation', () => {
  test('carries the entry mimeType through to the upload target', async () => {
    const auth = await authed()
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('/resources/download')) return json({ href: 'https://down.example/x', method: 'GET' })
      if (url.includes('/resources')) {
        return json({ _embedded: { total: 1, items: [{ name: 'a.txt', path: 'disk:/a.txt', type: 'file', size: 3, mime_type: 'text/plain' }] } })
      }
      return new Response('abc', { status: 200 })
    }) as unknown as typeof fetch
    const provider = new YandexDiskProvider({ auth, fetchImpl })
    const stateDir = await mkdtemp(join(tmpdir(), 'rox-yandex-ct-'))
    try {
      const puts: Array<{ key: string; contentType?: string }> = []
      const runner = createImportJobRunner({
        target: { async put(key, _body, opts) { puts.push({ key, contentType: opts?.contentType }) } },
        stateDir,
        providers: [provider],
        concurrency: 1,
      })
      const job = await runner.plan('yandex-disk')
      await runner.start(job.id)
      expect(puts).toEqual([{ key: `${job.id}/a.txt`, contentType: 'text/plain' }])
    } finally {
      await rm(stateDir, { recursive: true, force: true })
    }
  })
})