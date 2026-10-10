import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import { setBundledAssetsRoot } from '@rox/shared/utils'
import { clearRoversToolRuntime, getRoversToolRuntime } from '@rox/session-tools-core'
import type { HandlerFn, RequestContext, RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from '../../handler-deps'
import { registerRoversHandlers } from '../rovers.ts'

const roots: string[] = []
let previousOverride: string | undefined

const fixtureCatalog = {
  version: 1,
  generated_at: '2026-10-10T00:00:00.000Z',
  source: { repo: 'agisota/2026-10-09-rox-rovers', commit: 'e'.repeat(40) },
  entries: [
    {
      id: 'qdrant',
      name: 'Qdrant',
      category: 'vector-db',
      tagline: { ru: 'Векторная база', en: 'Vector database' },
      description: { ru: 'Хранит векторы.', en: 'Stores vectors.' },
      icon: 'icons/qdrant.svg',
      spdx: 'Apache-2.0',
      homepage: 'https://github.com/qdrant/qdrant',
      verified: true,
      deploy: { kind: 'none' },
    },
    {
      id: 'ollama',
      name: 'Ollama',
      category: 'llm-runtime',
      tagline: { ru: 'Локальные LLM', en: 'Local LLMs' },
      description: { ru: 'Запуск моделей.', en: 'Runs models.' },
      icon: 'icons/ollama.svg',
      spdx: 'MIT',
      homepage: 'https://github.com/ollama/ollama',
      verified: false,
      deploy: { kind: 'none' },
    },
  ],
}

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'rox-rovers-rpc-'))
  roots.push(root)
  return root
}

function writeCatalog(dir: string): string {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'catalog.json')
  writeFileSync(file, `${JSON.stringify(fixtureCatalog, null, 2)}\n`, 'utf8')
  return file
}

function fakeServer() {
  const handlers = new Map<string, HandlerFn>()
  const server = {
    handle(channel: string, handler: HandlerFn) {
      handlers.set(channel, handler)
    },
  } as unknown as RpcServer
  return { handlers, server }
}

const ctx = { clientId: 'c', workspaceId: null, webContentsId: null } as RequestContext

beforeEach(() => {
  previousOverride = process.env.ROX_ROVERS_CATALOG_PATH
  delete process.env.ROX_ROVERS_CATALOG_PATH
})
afterEach(() => {
  if (previousOverride === undefined) delete process.env.ROX_ROVERS_CATALOG_PATH
  else process.env.ROX_ROVERS_CATALOG_PATH = previousOverride
  setBundledAssetsRoot(undefined)
  clearRoversToolRuntime()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('rovers:list RPC', () => {
  it('registers exactly the rovers:list channel', () => {
    const { handlers, server } = fakeServer()
    registerRoversHandlers(server, {} as HandlerDeps)
    expect([...handlers.keys()]).toEqual([RPC_CHANNELS.rovers.LIST])
  })

  it('serves the catalog entries from the ROX_ROVERS_CATALOG_PATH override and publishes the tool runtime', async () => {
    process.env.ROX_ROVERS_CATALOG_PATH = writeCatalog(tempRoot())
    const { handlers, server } = fakeServer()
    registerRoversHandlers(server, {} as HandlerDeps)

    const result = (await handlers.get(RPC_CHANNELS.rovers.LIST)!(ctx)) as { entries: { id: string }[] }
    expect(result.entries.map((entry) => entry.id)).toEqual(['qdrant', 'ollama'])

    // The session tools in this process now share the same catalog view.
    const runtime = getRoversToolRuntime()
    expect(runtime).not.toBeNull()
    expect(runtime!.show('ollama')?.verified).toBe(false)
  })

  it('fails closed for an unsigned bundled catalog', async () => {
    const root = tempRoot()
    setBundledAssetsRoot(root)
    writeCatalog(join(root, 'resources', 'rovers'))
    const { handlers, server } = fakeServer()
    registerRoversHandlers(server, {} as HandlerDeps)

    await expect(handlers.get(RPC_CHANNELS.rovers.LIST)!(ctx)).rejects.toThrow(/ROVERS_UNSIGNED_BUNDLED_CATALOG/)
    // No runtime is published when the bundled catalog cannot be trusted.
    expect(getRoversToolRuntime()).toBeNull()
  })
})