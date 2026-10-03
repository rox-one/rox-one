import { describe, it, expect } from 'bun:test'
import {
  createSessionsProvider,
  createSettingsProvider,
  createSkillsProvider,
  createSourcesProvider,
  createAutomationsProvider,
  createKnowledgeProvider,
} from '../omnibox-providers'
import type { ResourceSearchContext } from '@craft-agent/core/platform'
import { parseRoute } from '../../../shared/route-parser'
import { searchHitRoute } from '@/knowledge/KnowledgeHome'

function ctx(partial: Partial<ResourceSearchContext> = {}): ResourceSearchContext {
  return { query: '', prefix: '', keys: {}, ...partial }
}

describe('omnibox providers', () => {
  it('sessions: filters hidden, ranks by query, builds route', async () => {
    const provider = createSessionsProvider(
      () => [
        { id: 's1', name: 'Memory design', lastMessageAt: 100 },
        { id: 's2', name: 'Other', hidden: true },
        { id: 's3', preview: 'agent memory notes', lastMessageAt: 200 },
      ],
      (id) => `allSessions/session/${id}`,
    )
    const hits = await provider.search(ctx({ query: 'memory', prefix: '' }))
    expect(hits.every((h) => h.kind === 'session')).toBe(true)
    expect(hits.some((h) => h.id === 'session:s2')).toBe(false)
    expect(hits[0]?.route).toContain('session/')
    expect(hits.some((h) => h.title.toLowerCase().includes('memory') || h.id.includes('s3'))).toBe(true)
  })

  it('sessions participates in @ prefix only among configured prefixes', () => {
    const provider = createSessionsProvider(() => [], () => '')
    expect(provider.prefixes).toContain('')
    expect(provider.prefixes).toContain('@')
    expect(provider.prefixes).not.toContain('>')
  })

  it('settings: matches label and id', async () => {
    const provider = createSettingsProvider(
      [
        { id: 'runtime', label: 'Runtime', description: 'AI runtime' },
        { id: 'shortcuts', label: 'Keyboard Shortcuts' },
      ],
      (id) => `settings/${id}`,
    )
    const hits = await provider.search(ctx({ query: 'short' }))
    expect(hits).toHaveLength(1)
    expect(hits[0]?.id).toBe('settings:shortcuts')
    expect(hits[0]?.route).toBe('settings/shortcuts')
  })

  it('skills: only on "" and / prefixes; skips shadowed', async () => {
    const provider = createSkillsProvider(
      () => [
        { slug: 'memory-search', metadata: { name: 'Memory Search', description: 'find stuff' } },
        { slug: 'omp-dup', metadata: { name: 'Dup' }, shadowedByCraft: true },
      ],
      (slug) => `skills/skill/${slug}`,
    )
    expect(provider.prefixes).toEqual(['', '/'])
    const hits = await provider.search(ctx({ query: 'memory', prefix: '/' }))
    expect(hits).toHaveLength(1)
    expect(hits[0]?.data?.slug).toBe('memory-search')
  })

  it('sources: skips builtins', async () => {
    const provider = createSourcesProvider(
      () => [
        { config: { name: 'Docs', slug: 'docs', type: 'local' } },
        { config: { name: 'Builtin', slug: 'builtin' }, isBuiltin: true },
      ],
      (slug) => `sources/source/${slug}`,
    )
    const hits = await provider.search(ctx({ query: 'doc' }))
    expect(hits).toHaveLength(1)
    expect(hits[0]?.id).toBe('source:docs')
  })

  it('automations: ! prefix and name match', async () => {
    const provider = createAutomationsProvider(
      () => [
        { id: 'a1', name: 'Nightly digest', summary: 'cron', event: 'SchedulerTick' },
        { id: 'a2', name: 'On label', event: 'LabelAdd' },
      ],
      (id) => `automations/automation/${id}`,
    )
    expect(provider.prefixes).toContain('!')
    const hits = await provider.search(ctx({ query: 'night', prefix: '!' }))
    expect(hits).toHaveLength(1)
    expect(hits[0]?.title).toBe('Nightly digest')
  })

  it('knowledge: requires query length ≥ 2 and uses search fn', async () => {
    const calls: string[] = []
    const provider = createKnowledgeProvider(async (q) => {
      calls.push(q)
      return [
        {
          ref: { scheme: 'siyuan', kind: 'document', id: 'doc1' },
          title: 'Agent Memory.md',
          snippet: 'episodic',
          score: 0.9,
        },
      ]
    })
    expect(await provider.search(ctx({ query: 'a' }))).toEqual([])
    expect(calls).toEqual([])

    const hits = await provider.search(ctx({ query: 'agent', prefix: '@' }))
    expect(calls).toEqual(['agent'])
    expect(hits).toHaveLength(1)
    expect(hits[0]?.kind).toBe('knowledge')
    expect(parseRoute(hits[0]?.route ?? '')).toEqual({
      type: 'view',
      name: 'notes',
      params: {},
    })
  })
  it('knowledge go-to opens a resolvable Rox note and falls back to Notes for opaque refs', async () => {
    const provider = createKnowledgeProvider(async () => [
      {
        ref: { scheme: 'siyuan', kind: 'document', id: 'research/Agent Memory.md' },
        title: 'Agent Memory.md',
      },
      {
        ref: { scheme: 'siyuan', kind: 'document', id: 'opaque-document-id' },
        title: 'Imported document',
      },
    ], searchHitRoute)
    const hits = await provider.search(ctx({ query: 'document' }))

    expect(parseRoute(hits.find((hit) => hit.id.endsWith('research/Agent Memory.md'))?.route ?? '')).toEqual({
      type: 'view',
      name: 'note-info',
      id: 'research/Agent Memory.md',
      params: {},
    })
    expect(parseRoute(hits.find((hit) => hit.id.endsWith('opaque-document-id'))?.route ?? '')).toEqual({
      type: 'view',
      name: 'notes',
      params: {},
    })
  })

  it('knowledge: returns empty when search fn yields null (disconnected)', async () => {
    const provider = createKnowledgeProvider(async () => null)
    expect(await provider.search(ctx({ query: 'agent' }))).toEqual([])
  })
})
