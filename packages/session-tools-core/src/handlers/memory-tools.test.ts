/**
 * memory_search / memory_get host tools (c1.3): real handlers + registry wiring.
 */
import { describe, expect, test } from 'bun:test'
import { handleMemorySearch, MEMORY_SEARCH_MAX_LIMIT } from './memory-search.ts'
import { handleMemoryGet } from './memory-get.ts'
import { handleMemoryForget, MEMORY_FORGET_MAX_IDS } from './memory-forget.ts'
import { SESSION_TOOL_REGISTRY, getToolDefsAsJsonSchema } from '../tool-defs.ts'
import { SESSION_MCP_ESSENTIAL_SUFFIXES } from '../tool-defs-filtering.ts'
import { successResponse } from '../response.ts'
import type { MemoryToolCallbacks, SessionToolContext } from '../context.ts'

function ctxWithMemory(memory: MemoryToolCallbacks): SessionToolContext {
  return { memory } as unknown as SessionToolContext
}

describe('memory_search handler', () => {
  test('rejects an empty query without calling the backend', async () => {
    let called = false
    const ctx = ctxWithMemory({
      search: async () => {
        called = true
        return successResponse('nope')
      },
      get: async () => successResponse('nope'),
    })
    const result = await handleMemorySearch(ctx, { query: '   ' })
    expect(result.isError).toBe(true)
    expect(called).toBe(false)
  })

  test('reports a typed unavailable error when no backend is wired', async () => {
    const result = await handleMemorySearch({} as SessionToolContext, { query: 'anything' })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('unavailable')
  })

  test('clamps the limit and passes the query through', async () => {
    let received: { query: string; limit?: number; path?: string } | null = null
    const ctx = ctxWithMemory({
      search: async args => {
        received = args
        return successResponse('hit')
      },
      get: async () => successResponse('chunk'),
    })
    await handleMemorySearch(ctx, { query: 'vercel', limit: 999 })
    expect(received!.limit).toBe(MEMORY_SEARCH_MAX_LIMIT)
    expect(received!.query).toBe('vercel')
    await handleMemorySearch(ctx, { query: 'vercel', limit: 0 })
    expect(received!.limit).toBe(1)
    await handleMemorySearch(ctx, { query: 'vercel', path: 'projects/' })
    expect(received!.path).toBe('projects/')
  })

  test('surfaces backend failures as error results', async () => {
    const ctx = ctxWithMemory({
      search: async () => {
        throw new Error('index exploded')
      },
      get: async () => successResponse('x'),
    })
    const result = await handleMemorySearch(ctx, { query: 'x' })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('index exploded')
  })
})

describe('memory_get handler', () => {
  test('rejects an empty chunk id', async () => {
    const result = await handleMemoryGet({} as SessionToolContext, { chunkId: '' })
    expect(result.isError).toBe(true)
  })

  test('reports unavailable without a backend, else returns the chunk', async () => {
    expect((await handleMemoryGet({} as SessionToolContext, { chunkId: 'abc' })).isError).toBe(true)
    const ctx = ctxWithMemory({
      search: async () => successResponse('x'),
      get: async args => successResponse(`chunk ${args.chunkId}`),
    })
    const result = await handleMemoryGet(ctx, { chunkId: 'abc' })
    expect(result.isError).toBe(false)
    expect(result.content[0]?.text).toBe('chunk abc')
  })
})

describe('memory_forget handler', () => {
  test('rejects an empty id list without calling the backend', async () => {
    let called = false
    const ctx = ctxWithMemory({
      search: async () => successResponse('x'),
      get: async () => successResponse('x'),
      forget: async () => {
        called = true
        return successResponse('nope')
      },
    })
    expect((await handleMemoryForget(ctx, { ids: [] })).isError).toBe(true)
    expect((await handleMemoryForget(ctx, { ids: ['  '] })).isError).toBe(true)
    expect(called).toBe(false)
  })

  test('reports a typed unavailable error when the backend has no forget', async () => {
    const ctx = ctxWithMemory({ search: async () => successResponse('x'), get: async () => successResponse('x') })
    const result = await handleMemoryForget(ctx, { ids: ['abc'] })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('unavailable')
  })

  test('passes ids and reason through, capping the id list', async () => {
    let received: { ids: string[]; reason?: string } | null = null
    const ctx = ctxWithMemory({
      search: async () => successResponse('x'),
      get: async () => successResponse('x'),
      forget: async args => {
        received = args
        return successResponse('forgotten')
      },
    })
    const many = Array.from({ length: MEMORY_FORGET_MAX_IDS + 5 }, (_, i) => `c${i}`)
    await handleMemoryForget(ctx, { ids: many, reason: 'gdpr' })
    expect(received!.ids).toHaveLength(MEMORY_FORGET_MAX_IDS)
    expect(received!.reason).toBe('gdpr')
  })

  test('surfaces backend failures as error results', async () => {
    const ctx = ctxWithMemory({
      search: async () => successResponse('x'),
      get: async () => successResponse('x'),
      forget: async () => {
        throw new Error('forget exploded')
      },
    })
    const result = await handleMemoryForget(ctx, { ids: ['abc'] })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('forget exploded')
  })
})

describe('registry wiring', () => {
  test('memory tools are read-only, safe-mode allowed and essential', () => {
    for (const name of ['memory_search', 'memory_get']) {
      const def = SESSION_TOOL_REGISTRY.get(name)
      expect(def).toBeDefined()
      expect(def!.readOnly).toBe(true)
      expect(def!.safeMode).toBe('allow')
      expect(def!.executionMode).toBe('registry')
      expect(SESSION_MCP_ESSENTIAL_SUFFIXES.has(name)).toBe(true)
    }
    const names = getToolDefsAsJsonSchema().map(d => d.name)
    expect(names).toContain('memory_search')
    expect(names).toContain('memory_get')
  })

  test('memory_forget is registered as a mutating, safe-mode-blocked tool', () => {
    const def = SESSION_TOOL_REGISTRY.get('memory_forget')
    expect(def).toBeDefined()
    expect(def!.readOnly).toBe(false)
    expect(def!.safeMode).toBe('block')
    expect(def!.executionMode).toBe('registry')
    expect(getToolDefsAsJsonSchema().map(d => d.name)).toContain('memory_forget')
  })
})