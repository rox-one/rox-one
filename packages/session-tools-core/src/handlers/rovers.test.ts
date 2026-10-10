import { afterEach, describe, expect, it } from 'bun:test'
import { createRoversCatalogQuery, parseRoversCatalog } from '@rox/rovers-core-lite'

import type { SessionToolContext } from '../context.ts'
import {
  getSessionSafeAllowedToolNames,
  getToolDefsAsJsonSchema,
  SESSION_TOOL_NAMES,
  SESSION_TOOL_REGISTRY,
} from '../tool-defs.ts'
import { SESSION_MCP_ESSENTIAL_SUFFIXES } from '../tool-defs-filtering.ts'
import { clearRoversToolRuntime, registerRoversToolRuntime } from '../rovers/runtime.ts'
import { handleRoversList, handleRoversSearch, handleRoversShow } from './rovers.ts'

const ctx = {} as SessionToolContext

const catalog = parseRoversCatalog({
  version: 1,
  generated_at: '2026-10-10T00:00:00.000Z',
  source: { repo: 'agisota/2026-10-09-rox-rovers', commit: 'd'.repeat(40) },
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
      verified: true,
      deploy: { kind: 'none' },
    },
  ],
})

function parseText(result: { content: { text: string }[] }): unknown {
  return JSON.parse(result.content[0]!.text)
}

afterEach(() => clearRoversToolRuntime())

describe('rovers session tools — registration', () => {
  it('registers the three tools as read-only, Explore-safe registry tools', () => {
    for (const name of ['rovers_list', 'rovers_search', 'rovers_show']) {
      expect(SESSION_TOOL_NAMES.has(name)).toBe(true)
      const def = SESSION_TOOL_REGISTRY.get(name)!
      expect(def.executionMode).toBe('registry')
      expect(def.safeMode).toBe('allow')
      expect(def.readOnly).toBe(true)
      expect(def.handler).not.toBeNull()
    }
  })

  it('is essential in the MCP lens and allowed in Explore/Safe mode with the session prefix', () => {
    for (const name of ['rovers_list', 'rovers_search', 'rovers_show']) {
      expect(SESSION_MCP_ESSENTIAL_SUFFIXES.has(name)).toBe(true)
    }
    const safeAllowed = getSessionSafeAllowedToolNames({ prefix: 'mcp__session__' })
    expect(safeAllowed.has('mcp__session__rovers_list')).toBe(true)
    expect(safeAllowed.has('mcp__session__rovers_search')).toBe(true)
    expect(safeAllowed.has('mcp__session__rovers_show')).toBe(true)
  })

  it('is advertised through the JSON-schema view every agent backend consumes', () => {
    const names = getToolDefsAsJsonSchema({ prefix: 'mcp__session__' }).map((def) => def.name)
    expect(names).toContain('mcp__session__rovers_list')
    expect(names).toContain('mcp__session__rovers_search')
    expect(names).toContain('mcp__session__rovers_show')
  })
})

describe('rovers handlers', () => {
  it('answers ROVERS_UNAVAILABLE when no catalog is registered', async () => {
    const result = await handleRoversList(ctx, {})
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('ROVERS_UNAVAILABLE')
  })

  it('lists and filters entries as self-contained card JSON', async () => {
    registerRoversToolRuntime(createRoversCatalogQuery(catalog))
    const all = parseText(await handleRoversList(ctx, {})) as { entries: unknown[]; total: number }
    expect(all.total).toBe(2)
    const filtered = parseText(await handleRoversList(ctx, { category: 'vector-db' })) as { entries: { id: string }[] }
    expect(filtered.entries.map((entry) => entry.id)).toEqual(['qdrant'])
  })

  it('search requires a non-empty query', async () => {
    registerRoversToolRuntime(createRoversCatalogQuery(catalog))
    const empty = await handleRoversSearch(ctx, { query: '   ' })
    expect(empty.isError).toBe(true)
    expect(empty.content[0]!.text).toContain('INVALID_ARGS')
    const hit = parseText(await handleRoversSearch(ctx, { query: 'vector' })) as { entries: { id: string }[] }
    expect(hit.entries.map((entry) => entry.id)).toEqual(['qdrant'])
  })

  it('show returns the full entry and a typed error for an unknown id', async () => {
    registerRoversToolRuntime(createRoversCatalogQuery(catalog))
    const shown = parseText(await handleRoversShow(ctx, { id: 'ollama' })) as { entry: { homepage: string } }
    expect(shown.entry.homepage).toBe('https://github.com/ollama/ollama')
    const missing = await handleRoversShow(ctx, { id: 'nope' })
    expect(missing.isError).toBe(true)
    expect(missing.content[0]!.text).toContain('ROVERS_ENTRY_NOT_FOUND')
  })
})