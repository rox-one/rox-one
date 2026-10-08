/**
 * W1-07 (#1504): Omnibox entity provider contract (UI-SPEC §3.4).
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { createResourceProviderRegistry, type ResourceSearchContext } from '@rox/core/platform'
import { entityRoute } from '@rox/core/entities'
import {
  ENTITY_OMNIBOX_PROVIDER_ID,
  OMNIBOX_ENTITY_CHIPS,
  OMNIBOX_ENTITY_GROUP_LIMIT,
  __resetEntitySourcesForTests,
  clampEntityGroupLimit,
  createEntityOmniboxProvider,
  createEntitySourceRegistry,
  getEntitySourceRegistry,
  registerEntitySearchSource,
  type EntitySearchSource,
} from '../omnibox-entities'

const ctx = (query: string, limit?: number): ResourceSearchContext => ({ query, prefix: '', keys: {}, limit })

const goalsSource: EntitySearchSource = {
  id: 'goals.search',
  kinds: ['goal', 'project'],
  flag: 'fake.goals.v1',
  async search({ query }) {
    return Array.from({ length: 8 }, (_, index) => ({
      ref: { kind: index % 2 ? 'project' : 'goal', id: `g${index}` },
      title: `${query} ${index}`,
      container: 'Space › Project',
      score: 10 - index,
    }))
  },
}

afterEach(() => __resetEntitySourcesForTests())

describe('entity omnibox provider', () => {
  it('flags OFF / no sources: contributes nothing (⌘K = baseline)', async () => {
    const provider = createEntityOmniboxProvider({ registry: createEntitySourceRegistry(), getFlags: () => new Set() })
    expect(provider.id).toBe(ENTITY_OMNIBOX_PROVIDER_ID)
    expect(await provider.search(ctx('plan'))).toEqual([])
    const registry = createEntitySourceRegistry()
    registry.register(goalsSource)
    const gated = createEntityOmniboxProvider({ registry, getFlags: () => new Set() })
    expect(await gated.search(ctx('plan'))).toEqual([])
  })

  it('flag ON: rows are entity resources with #1499 refs and routes, capped per group', async () => {
    const registry = createEntitySourceRegistry()
    registry.register(goalsSource)
    const provider = createEntityOmniboxProvider({ registry, getFlags: () => new Set(['fake.goals.v1']) })
    const items = await provider.search(ctx('plan'))
    expect(items).toHaveLength(OMNIBOX_ENTITY_GROUP_LIMIT)
    expect(items[0]).toEqual({
      id: 'entity:goal:g0', kind: 'entity', title: 'plan 0', subtitle: 'Space › Project', icon: undefined,
      route: entityRoute({ kind: 'goal', id: 'g0' }),
      data: { ref: 'goal:g0', entityKind: 'goal', source: 'goals.search', statusKey: undefined },
      score: 10,
    })
  })

  it('per-source limit is clamped to OMNIBOX_ENTITY_GROUP_LIMIT whatever the host asks (review5 info #2)', async () => {
    const registry = createEntitySourceRegistry()
    const asked: number[] = []
    registry.register({ ...goalsSource, async search(query) { asked.push(query.limit); return goalsSource.search(query) } })
    registry.register({
      id: 'tasks.search', kinds: ['task'], flag: 'fake.goals.v1',
      async search({ query, limit }) {
        asked.push(limit)
        return Array.from({ length: 40 }, (_, index) => ({ ref: { kind: 'task' as const, id: `t${index}` }, title: `${query} t${index}`, score: 1 }))
      },
    })
    const provider = createEntityOmniboxProvider({ registry, getFlags: () => new Set(['fake.goals.v1']) })
    // The Omnibox passes RESOURCES_LIMIT (30): each source still gets at most 5.
    const items = await provider.search(ctx('plan', 30))
    expect(asked).toEqual([OMNIBOX_ENTITY_GROUP_LIMIT, OMNIBOX_ENTITY_GROUP_LIMIT])
    for (const source of ['goals.search', 'tasks.search']) {
      expect(items.filter((item) => item.data?.source === source)).toHaveLength(OMNIBOX_ENTITY_GROUP_LIMIT)
    }
    // A smaller request is honoured.
    asked.length = 0
    const few = await provider.search(ctx('plan', 2))
    expect(asked).toEqual([2, 2])
    expect(few).toHaveLength(4)
    expect(clampEntityGroupLimit(undefined)).toBe(5)
    expect(clampEntityGroupLimit(30)).toBe(5)
    expect(clampEntityGroupLimit(5)).toBe(5)
    expect(clampEntityGroupLimit(3.7)).toBe(3)
    expect(clampEntityGroupLimit(0)).toBe(5)
    expect(clampEntityGroupLimit(-1)).toBe(5)
    expect(clampEntityGroupLimit(Number.NaN)).toBe(5)
    expect(clampEntityGroupLimit(Number.POSITIVE_INFINITY)).toBe(5)
  })

  it('chip filter narrows kinds and skips non-matching sources', async () => {
    const registry = createEntitySourceRegistry()
    registry.register(goalsSource)
    let kinds: readonly string[] | null = ['project']
    const provider = createEntityOmniboxProvider({ registry, getFlags: () => new Set(['fake.goals.v1']), getKinds: () => kinds as never })
    const items = await provider.search(ctx('plan', 10))
    expect(items.every((item) => item.data?.entityKind === 'project')).toBe(true)
    kinds = ['person']
    expect(await provider.search(ctx('plan'))).toEqual([])
  })

  it('plugs into the existing resource registry (no second palette)', async () => {
    const resources = createResourceProviderRegistry()
    resources.register(createEntityOmniboxProvider({ getFlags: () => new Set(['fake.goals.v1']) }))
    registerEntitySearchSource(goalsSource)
    const items = await resources.search(ctx('plan'))
    expect(items.length).toBeGreaterThan(0)
    expect(items.every((item) => item.kind === 'entity')).toBe(true)
    expect(getEntitySourceRegistry().list().map((source) => source.id)).toEqual(['goals.search'])
  })

  it('negative: empty query, failing source, malformed ref and duplicate ids', async () => {
    const registry = createEntitySourceRegistry()
    registry.register({ id: 'bad.throws', kinds: ['task'], async search() { throw new Error('boom') } })
    registry.register({
      id: 'bad.ref', kinds: ['task'],
      async search() { return [{ ref: { kind: 'task', id: '' }, title: 'broken' }, { ref: { kind: 'task', id: 't1' }, title: 'ok' }] },
    })
    const provider = createEntityOmniboxProvider({ registry, getFlags: () => new Set() })
    expect(await provider.search(ctx('   '))).toEqual([])
    expect((await provider.search(ctx('x'))).map((item) => item.id)).toEqual(['entity:task:t1'])
    expect(() => registry.register({ id: 'bad.ref', kinds: [], async search() { return [] } })).toThrow('already registered')
  })

  it('chip row follows §3.4 order with surfaces.omnibox.chip.* keys', () => {
    expect(OMNIBOX_ENTITY_CHIPS.map((chip) => chip.id)).toEqual([
      'all', 'messages', 'docs', 'tasks', 'goals', 'projects', 'milestones', 'check-ins', 'spaces', 'people', 'calendar', 'files', 'bases', 'mail', 'sessions',
    ])
    for (const chip of OMNIBOX_ENTITY_CHIPS) expect(chip.titleKey.startsWith('surfaces.omnibox.chip.')).toBe(true)
  })
})
