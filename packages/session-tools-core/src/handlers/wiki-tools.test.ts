/**
 * wiki_search / wiki_get / wiki_apply host tools (c1.7): handlers + registry wiring.
 *
 * The wiki tools are only usable (listed) once the backend wires the wiki
 * callbacks — an unwired context reports a typed "unavailable". wiki_apply is
 * mutating and blocked in the restrictive (Explore/Safe) mode.
 */
import { describe, expect, test } from 'bun:test'
import { handleWikiSearch, WIKI_SEARCH_MAX_LIMIT } from './wiki-search.ts'
import { handleWikiGet } from './wiki-get.ts'
import { handleWikiApply } from './wiki-apply.ts'
import { SESSION_TOOL_REGISTRY, getToolDefsAsJsonSchema, getSessionSafeBlockedToolNames, getSessionSafeAllowedToolNames } from '../tool-defs.ts'
import { SESSION_MCP_ESSENTIAL_SUFFIXES } from '../tool-defs-filtering.ts'
import { successResponse } from '../response.ts'
import type { MemoryToolCallbacks, SessionToolContext } from '../context.ts'

function ctxWithWiki(wiki: MemoryToolCallbacks['wiki']): SessionToolContext {
  const memory: MemoryToolCallbacks = {
    search: async () => successResponse('nope'),
    get: async () => successResponse('nope'),
    wiki,
  }
  return { memory } as unknown as SessionToolContext
}

const WORKING_WIKI: MemoryToolCallbacks['wiki'] = {
  search: async () => successResponse('search ok'),
  get: async () => successResponse('get ok'),
  apply: async () => successResponse('apply ok'),
}

describe('wiki tools are usable only when the callbacks are wired', () => {
  test('every wiki handler reports a typed unavailable error without callbacks', async () => {
    const ctx = {} as SessionToolContext
    expect((await handleWikiSearch(ctx, {})).isError).toBe(true)
    expect((await handleWikiGet(ctx, { id: 'c1' })).isError).toBe(true)
    expect((await handleWikiApply(ctx, { op: 'retract', claimId: 'c1' })).isError).toBe(true)
    expect((await handleWikiSearch(ctx, {})).content[0]?.text).toContain('unavailable')
  })

  test('the handlers run once the wiki callbacks are wired', async () => {
    const ctx = ctxWithWiki(WORKING_WIKI)
    const search = await handleWikiSearch(ctx, { query: 'x' })
    const get = await handleWikiGet(ctx, { id: 'c1' })
    const apply = await handleWikiApply(ctx, {
      op: 'upsert',
      claim: { id: 'c1', text: 'Deploys go through vercel.', status: 'active', evidence: [] },
    })
    expect(search.isError).toBe(false)
    expect(get.isError).toBe(false)
    expect(apply.isError).toBe(false)
    expect(search.content[0]?.text).toBe('search ok')
  })
})

describe('wiki_search handler', () => {
  test('clamps the limit and passes query/scope/status through', async () => {
    let received: { query: string; limit: number; scope?: string; status?: string } | null = null
    const ctx = ctxWithWiki({
      search: async (args) => {
        received = args as typeof received
        return successResponse('hit')
      },
      get: WORKING_WIKI.get,
      apply: WORKING_WIKI.apply,
    })
    await handleWikiSearch(ctx, { query: '  vercel  ', limit: 999 })
    expect(received!.limit).toBe(WIKI_SEARCH_MAX_LIMIT)
    expect(received!.query).toBe('vercel')
    await handleWikiSearch(ctx, { limit: 0, scope: 'workspace', status: 'active' })
    expect(received!.limit).toBe(1)
    expect(received!.scope).toBe('workspace')
    expect(received!.status).toBe('active')
  })
})

describe('wiki_apply handler', () => {
  test('rejects an upsert with empty text before calling the backend', async () => {
    let called = false
    const ctx = ctxWithWiki({
      search: WORKING_WIKI.search,
      get: WORKING_WIKI.get,
      apply: async () => {
        called = true
        return successResponse('nope')
      },
    })
    expect((await handleWikiApply(ctx, { op: 'upsert', claim: { id: 'c1', text: '   ', status: 'draft', evidence: [] } })).isError).toBe(true)
    expect((await handleWikiApply(ctx, { op: 'retract' })).isError).toBe(true)
    expect(called).toBe(false)
  })
})

describe('registry wiring', () => {
  test('wiki search/get are read-only and safe-mode allowed; apply is blocked', () => {
    for (const name of ['wiki_search', 'wiki_get']) {
      const def = SESSION_TOOL_REGISTRY.get(name)
      expect(def).toBeDefined()
      expect(def!.readOnly).toBe(true)
      expect(def!.safeMode).toBe('allow')
      expect(def!.executionMode).toBe('registry')
      expect(def!.handler).not.toBeNull()
      expect(SESSION_MCP_ESSENTIAL_SUFFIXES.has(name)).toBe(true)
    }
    const apply = SESSION_TOOL_REGISTRY.get('wiki_apply')
    expect(apply).toBeDefined()
    expect(apply!.readOnly).toBe(false)
    expect(apply!.safeMode).toBe('block')
    expect(getSessionSafeBlockedToolNames().has('wiki_apply')).toBe(true)
    expect(getSessionSafeAllowedToolNames().has('wiki_search')).toBe(true)
    const names = getToolDefsAsJsonSchema().map(d => d.name)
    expect(names).toContain('wiki_search')
    expect(names).toContain('wiki_get')
    expect(names).toContain('wiki_apply')
  })
})