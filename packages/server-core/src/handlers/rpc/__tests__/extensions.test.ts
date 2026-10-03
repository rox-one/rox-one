import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import { resetExtensionStateStoreCache } from '@rox/shared/extensions'
import { SiyuanKernelClient } from '@rox/core/knowledge/providers/siyuan'
import { HANDLED_CHANNELS, registerExtensionsHandlers } from '../extensions'
import {
  resetPluginBridgeFixture,
  __setPluginBridgeKernelClientForTests,
} from '../plugin-bridge'
import { __setSiyuanDataDirCandidatesForTests } from '../../../knowledge/siyuan-plugins-fs'

type Handler = (ctx: unknown, ...args: unknown[]) => unknown | Promise<unknown>

function createMockServer() {
  const handlers = new Map<string, Handler>()
  return {
    handlers,
    handle(channel: string, fn: Handler) {
      handlers.set(channel, fn)
    },
    push() {},
  }
}

describe('extensions RPC', () => {
  let dir: string
  let prev: string | undefined
  let prevConfPaths: string | undefined

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ext-rpc-'))
    prev = process.env.CRAFT_CONFIG_DIR
    process.env.CRAFT_CONFIG_DIR = dir
    // Avoid real SiYuan conf token fallback probing during catalog list.
    prevConfPaths = process.env.CRAFT_SIYUAN_CONF_PATHS
    process.env.CRAFT_SIYUAN_CONF_PATHS = join(dir, 'no-conf.json')
    resetExtensionStateStoreCache()
    resetPluginBridgeFixture()
    __setPluginBridgeKernelClientForTests(null)
    __setSiyuanDataDirCandidatesForTests([])
    // Use the exact shipped signed body. Unsigned arbitrary cache entries are
    // deliberately rejected by the marketplace trust boundary.
    const bundled = join(import.meta.dir, '../../../../../../apps/electron/resources/marketplace')
    const body = readFileSync(join(bundled, 'catalog.json'), 'utf8')
    const signature = readFileSync(join(bundled, 'catalog.json.sig'), 'utf8')
    const catalog = JSON.parse(body)
    const entry = catalog.entries.find((item: { id: string }) => item.id === 'superpowers')
    const mp = join(dir, 'marketplace')
    mkdirSync(mp, { recursive: true })
    writeFileSync(join(mp, 'catalog.cache.json'), JSON.stringify({ fetchedAt: Date.now(), body, signature }), 'utf8')
    writeFileSync(join(mp, 'lock.json'), JSON.stringify({
      version: 1,
      entries: {
        superpowers: {
          id: entry.id,
          kind: entry.kind,
          repo: entry.source.repo,
          ref: entry.source.ref,
          installedAt: Date.now(),
          status: 'installed',
          targets: [join(dir, 'skills', 'brainstorming')],
        },
      },
    }), 'utf8')
  })

  afterEach(() => {
    resetExtensionStateStoreCache()
    resetPluginBridgeFixture()
    __setPluginBridgeKernelClientForTests(undefined)
    __setSiyuanDataDirCandidatesForTests(null)
    if (prev === undefined) delete process.env.CRAFT_CONFIG_DIR
    else process.env.CRAFT_CONFIG_DIR = prev
    if (prevConfPaths === undefined) delete process.env.CRAFT_SIYUAN_CONF_PATHS
    else process.env.CRAFT_SIYUAN_CONF_PATHS = prevConfPaths
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  it('registers expected channels', () => {
    const server = createMockServer()
    registerExtensionsHandlers(server as never, {
      platform: { logger: { info() {}, error() {}, warn() {}, debug() {} } },
    } as never)
    expect(HANDLED_CHANNELS).toEqual([
      RPC_CHANNELS.extensions.LIST_CATALOG,
      RPC_CHANNELS.extensions.LIST_INSTALLED,
      RPC_CHANNELS.extensions.SET_ENABLED,
      RPC_CHANNELS.extensions.GET_STATE,
    ])
    for (const ch of HANDLED_CHANNELS) {
      expect(server.handlers.has(ch)).toBe(true)
    }
  })

  it('listCatalog uses Rox Kiro plus community registries and omits SiYuan Bazaar', async () => {
    const server = createMockServer()
    registerExtensionsHandlers(server as never, {
      platform: { logger: { info() {}, error() {}, warn() {}, debug() {} } },
    } as never)
    const list = server.handlers.get(RPC_CHANNELS.extensions.LIST_CATALOG)!
    const result = (await list({}, {})) as {
      entries: Array<{ id: string; runtime: string }>
      providers: Array<{ id: string; label: string; community?: boolean; docsUrl?: string }>
    }
    const ids = result.providers.map((p) => p.id).sort()
    expect(ids).toContain('craft-curated')
    expect(ids).toContain('community-anthropic')
    expect(ids).toContain('community-codex')
    expect(ids).toContain('community-cursor')
    expect(ids).toContain('community-hermes')
    expect(ids).toContain('community-opencode')
    expect(ids).toContain('community-openclaw')
    expect(ids).not.toContain('siyuan-bazaar')
    expect(result.providers.find((p) => p.id === 'craft-curated')?.label).toBe('Rox Kiro')
    expect(result.providers.find((p) => p.id === 'community-openclaw')?.community).toBe(true)
    expect(result.providers.find((p) => p.id === 'community-openclaw')?.docsUrl).toMatch(/^https:\/\//)
    expect(result.entries.some((e) => e.id === 'marketplace:superpowers')).toBe(true)
    expect(result.entries.find((e) => e.id === 'marketplace:superpowers')?.runtime).toBe('skill-pack')
  })

  it('listInstalled projects marketplace lock + setEnabled persists', async () => {
    const server = createMockServer()
    registerExtensionsHandlers(server as never, {
      platform: { logger: { info() {}, error() {}, warn() {}, debug() {} } },
    } as never)
    const listInstalled = server.handlers.get(RPC_CHANNELS.extensions.LIST_INSTALLED)!
    const setEnabled = server.handlers.get(RPC_CHANNELS.extensions.SET_ENABLED)!
    const getState = server.handlers.get(RPC_CHANNELS.extensions.GET_STATE)!

    const before = (await listInstalled({}, {})) as {
      records: Array<{ id: string; status: string }>
    }
    expect(before.records.some((r) => r.id === 'marketplace:superpowers')).toBe(true)
    expect(before.records.find((r) => r.id === 'marketplace:superpowers')?.status).toBe('enabled')

    await setEnabled({}, { id: 'marketplace:superpowers', enabled: false })
    const state = (await getState({})) as { state: { enabled: Record<string, boolean> } }
    expect(state.state.enabled['marketplace:superpowers']).toBe(false)

    const after = (await listInstalled({}, {})) as {
      records: Array<{ id: string; status: string }>
    }
    expect(after.records.find((r) => r.id === 'marketplace:superpowers')?.status).toBe('disabled')
  })

  it('never projects an unsigned cache entry into the trusted catalog', async () => {
    writeFileSync(join(dir, 'marketplace', 'catalog.cache.json'), JSON.stringify({
      fetchedAt: Date.now(),
      catalog: { catalogVersion: 1, entries: [{ id: 'unsigned-demo-pack', kind: 'skillpack', title: 'Untrusted' }] },
    }), 'utf8')
    const server = createMockServer()
    registerExtensionsHandlers(server as never, {
      platform: { logger: { info() {}, error() {}, warn() {}, debug() {} } },
    } as never)
    const result = await server.handlers.get(RPC_CHANNELS.extensions.LIST_CATALOG)!({}, {}) as { entries: Array<{ id: string }> }
    expect(result.entries.some((entry) => entry.id === 'marketplace:unsigned-demo-pack')).toBe(false)
  })

  it('catalog suggestions do not fabricate installations and preserve explicit disabled state', async () => {
    writeFileSync(join(dir, 'marketplace', 'lock.json'), JSON.stringify({ version: 1, entries: {} }), 'utf8')
    const server = createMockServer()
    registerExtensionsHandlers(server as never, {
      platform: { logger: { info() {}, error() {}, warn() {}, debug() {} } },
    } as never)
    const listInstalled = server.handlers.get(RPC_CHANNELS.extensions.LIST_INSTALLED)!
    const first = (await listInstalled({}, {})) as {
      records: Array<{ id: string; status: string }>
    }
    const pack = first.records.find((r) => r.id === 'marketplace:superpowers')
    expect(pack).toBeUndefined()
    expect(JSON.parse(readFileSync(join(dir, 'marketplace', 'lock.json'), 'utf8')).entries).toEqual({})
    const catalog = await server.handlers.get(RPC_CHANNELS.extensions.LIST_CATALOG)!({}, {}) as { entries: Array<{ id: string }> }
    expect(catalog.entries.some((entry) => entry.id === 'marketplace:superpowers')).toBe(true)

    const setEnabled = server.handlers.get(RPC_CHANNELS.extensions.SET_ENABLED)!
    await setEnabled({}, { id: 'marketplace:superpowers', enabled: false })
    const after = (await listInstalled({}, {})) as {
      records: Array<{ id: string; status: string }>
    }
    expect(after.records.some((r) => r.id === 'marketplace:superpowers')).toBe(false)
    const state = await server.handlers.get(RPC_CHANNELS.extensions.GET_STATE)!({}) as { state: { enabled: Record<string, boolean> } }
    expect(state.state.enabled['marketplace:superpowers']).toBe(false)
    expect(JSON.parse(readFileSync(join(dir, 'marketplace', 'lock.json'), 'utf8')).entries).toEqual({})
  })

  it('listInstalled projects siyuan-plugin from kernel-aware feed after mock install', async () => {
    type HandlerResult = { data?: unknown; code?: number; msg?: string }
    type FetchHandler = (body: Record<string, unknown>) => HandlerResult
    const installedPkgs: Array<Record<string, unknown>> = []
    const handlers: Record<string, FetchHandler> = {
      '/api/bazaar/getInstalledPlugin': () => ({ data: installedPkgs }),
      '/api/petal/loadPetals': () => ({
        data: installedPkgs.map((p) => ({ name: p.name, enabled: true })),
      }),
      '/api/bazaar/getBazaarPlugin': () => ({ data: { packages: [] } }),
    }
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      const endpoint = String(url).replace(/^https?:\/\/[^/]+/, '')
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      const handler = handlers[endpoint]
      if (!handler) throw new Error(`unmocked kernel endpoint: ${endpoint}`)
      const result = handler(body)
      return new Response(
        JSON.stringify({ code: result.code ?? 0, msg: result.msg ?? '', data: result.data }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }) as unknown as typeof fetch
    const client = new SiyuanKernelClient({
      baseUrl: 'http://127.0.0.1:6806',
      token: 'tok',
      fetchImpl,
    })
    __setPluginBridgeKernelClientForTests(client)

    const server = createMockServer()
    registerExtensionsHandlers(server as never, {
      platform: { logger: { info() {}, error() {}, warn() {}, debug() {} } },
    } as never)
    const listInstalled = server.handlers.get(RPC_CHANNELS.extensions.LIST_INSTALLED)!
    const listCatalog = server.handlers.get(RPC_CHANNELS.extensions.LIST_CATALOG)!

    const empty = (await listInstalled({}, {})) as {
      records: Array<{ id: string }>
    }
    expect(empty.records.some((r) => r.id.startsWith('siyuan-plugin:'))).toBe(false)

    // Simulate kernel install completing
    installedPkgs.push({ name: 'fresh-plugin', version: '1.2.3', enabled: true })

    const after = (await listInstalled({}, {})) as {
      records: Array<{ id: string; status: string; manifest: { name: string } }>
    }
    const hit = after.records.find((r) => r.id === 'siyuan-plugin:fresh-plugin')
    expect(hit).toBeTruthy()
    expect(hit?.manifest.name).toBe('fresh-plugin')
    expect(hit?.status).toBe('enabled')

    const catalog = (await listCatalog({}, {})) as {
      entries: Array<{ id: string }>
      providers: Array<{ id: string }>
    }
    expect(catalog.entries.some((e) => e.id === 'siyuan-plugin:fresh-plugin')).toBe(false)
    expect(catalog.providers.some((p) => p.id === 'siyuan-bazaar')).toBe(false)
  })
})
