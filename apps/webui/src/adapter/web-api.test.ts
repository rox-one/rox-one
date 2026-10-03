import { afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createWebuiHandler } from '../../../../packages/server-core/src/webui/http-server'
import type {
  buildSessionWindowUrl as BuildSessionWindowUrl,
  createWebApi as CreateWebApi,
} from './web-api'

// web-api → @rox/ui → pdfjs Vite `?url` import, which bun cannot load.
mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: () => ({}),
}))

const WEBUI_SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const INDEX_HTML = join(WEBUI_SRC, 'index.html')
const PUBLIC_DIR = join(WEBUI_SRC, 'public')

const TEMP_DIRS: string[] = []
const HANDLERS: Array<{ dispose: () => void }> = []
const CLIENTS: Array<{ destroy: () => void }> = []

let createWebApi: typeof CreateWebApi
let buildSessionWindowUrl: typeof BuildSessionWindowUrl

beforeAll(async () => {
  ;({ buildSessionWindowUrl, createWebApi } = await import('./web-api'))
})

describe('web session window links', () => {
  it('uses the canonical sessionId parameter consumed by the renderer', () => {
    const url = new URL(buildSessionWindowUrl('https://rox.example', 'session /?#1'))

    expect(url.origin).toBe('https://rox.example')
    expect(url.pathname).toBe('/')
    expect(url.searchParams.get('sessionId')).toBe('session /?#1')
    expect(url.searchParams.has('session')).toBe(false)
  })
})

function extractManifestHref(html: string): string | null {
  const link = html.match(/<link\b[^>]*\brel=["']manifest["'][^>]*>/i)
    ?? html.match(/<link\b[^>]*\bhref=["'][^"']+["'][^>]*\brel=["']manifest["'][^>]*>/i)
  if (!link) return null
  const href = link[0].match(/\bhref=["']([^"']+)["']/i)
  return href?.[1] ?? null
}

afterEach(() => {
  while (CLIENTS.length > 0) CLIENTS.pop()?.destroy()
  while (HANDLERS.length > 0) HANDLERS.pop()?.dispose()
  while (TEMP_DIRS.length > 0) {
    const dir = TEMP_DIRS.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('web adapter notification stubs', () => {
  it('resolves notification:getEnabled without opening an RPC connection', async () => {
    const { api, client } = createWebApi({ serverUrl: 'ws://127.0.0.1:1' })
    CLIENTS.push(client)

    const enabled = await Promise.race([
      api.getNotificationsEnabled(),
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error('getNotificationsEnabled still waits on RPC')),
          250,
        )
      }),
    ])

    expect(typeof enabled).toBe('boolean')
    expect(client.getConnectionState().status).toBe('idle')
  })

  it('resolves notification:setEnabled without opening an RPC connection', async () => {
    const { api, client } = createWebApi({ serverUrl: 'ws://127.0.0.1:1' })
    CLIENTS.push(client)

    await Promise.race([
      api.setNotificationsEnabled(false),
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error('setNotificationsEnabled still waits on RPC')),
          250,
        )
      }),
    ])

    expect(client.getConnectionState().status).toBe('idle')
  })
})

describe('web adapter acknowledged workspace metadata', () => {
  it('does not project the requested workspace before the server acknowledges it', async () => {
    const { api, client } = createWebApi({
      serverUrl: 'ws://127.0.0.1:1', workspaceId: 'requested-workspace', workspaceName: 'Appearance acceptance',
    })
    CLIENTS.push(client)

    expect(await api.getWorkspaces()).toEqual([])
    expect(await api.getWindowWorkspace()).toBeNull()
    expect(client.getConnectionState().status).toBe('idle')
  })

  it('projects only the acknowledged workspace without host paths or authority metadata', async () => {
    const { api, client } = createWebApi({
      serverUrl: 'ws://127.0.0.1:1', workspaceId: 'requested-workspace', workspaceName: 'Appearance acceptance',
    })
    CLIENTS.push(client)
    // Isolate the adapter projection; real handshake and scope rejection are
    // exercised by the WS appearance RPC integration tests.
    client.getAcknowledgedWorkspaceId = () => 'acknowledged-workspace'

    expect(await api.getWorkspaces()).toEqual([{
      id: 'acknowledged-workspace', name: 'Appearance acceptance', slug: 'acknowledged-workspace', rootPath: '', createdAt: 0,
    }])
    expect(await api.getWindowWorkspace()).toBe('acknowledged-workspace')
    expect(client.getConnectionState().status).toBe('idle')
  })
})

describe('web UI PWA manifest', () => {
  it('is reachable without a session cookie, or is not requested', async () => {
    const html = readFileSync(INDEX_HTML, 'utf8')
    const href = extractManifestHref(html)
    if (!href) return

    const webuiDir = mkdtempSync(join(tmpdir(), 'webui-manifest-'))
    TEMP_DIRS.push(webuiDir)
    cpSync(PUBLIC_DIR, webuiDir, { recursive: true })
    cpSync(INDEX_HTML, join(webuiDir, 'index.html'))

    const handler = createWebuiHandler({
      webuiDir,
      secret: 'test-server-token16',
      wsProtocol: 'ws',
      wsPort: 9100,
      getHealthCheck: () => ({ status: 'ok' }),
      logger: { info() {}, warn() {}, error() {}, debug() {} } as never,
    })
    HANDLERS.push(handler)

    const pathname = new URL(href, 'http://127.0.0.1/').pathname
    const res = await handler.fetch(new Request(`http://127.0.0.1${pathname}`))

    expect(res.status).not.toBe(401)
    expect(res.ok).toBe(true)
    expect(res.headers.get('content-type') ?? '').toContain('json')
  })
})
