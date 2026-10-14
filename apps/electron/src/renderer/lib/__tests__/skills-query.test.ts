import { describe, expect, it } from 'bun:test'
import type { LoadedSkill } from '../../../shared/types'
import {
  applySkillsChangedDelta,
  capSkillsLimit,
  readSkillsPage,
  shouldRefetchSkillsPage,
  SKILLS_UI_ACCUMULATE_CAP,
  SKILLS_UI_PAGE_SIZE,
} from '../skills-query'

function skill(slug: string, extra: Partial<LoadedSkill> = {}): LoadedSkill {
  return {
    slug,
    path: `/skills/${slug}`,
    source: 'workspace',
    content: '',
    contentLength: 8,
    metadata: { name: slug, description: `${slug} desc` },
    ...extra,
  }
}

describe('skills-query (ADR-0023 §7)', () => {
  it('caps a page well below a 10k catalog', () => {
    expect(capSkillsLimit(undefined)).toBe(SKILLS_UI_PAGE_SIZE)
    expect(capSkillsLimit(10_000)).toBe(SKILLS_UI_ACCUMULATE_CAP)
    expect(capSkillsLimit(0)).toBe(1)
  })

  it('refetches when a revision was missed', () => {
    expect(shouldRefetchSkillsPage(3, { revision: 4, changed: ['a'], removed: [] })).toBe(false)
    expect(shouldRefetchSkillsPage(3, { revision: 5, changed: ['a'], removed: [] })).toBe(true)
    expect(shouldRefetchSkillsPage(0, { revision: 1, changed: [], removed: [] })).toBe(true)
  })

  it('patches visible rows from a delta without keeping removed slugs', () => {
    const page = {
      items: [skill('alpha'), skill('beta'), skill('gamma')],
      total: 3,
      revision: 1,
    }
    const next = applySkillsChangedDelta({
      page,
      delta: { revision: 2, changed: ['beta'], removed: ['gamma'] },
      fetchedChanged: [skill('beta', { metadata: { name: 'Beta 2', description: 'updated' } })],
    })
    expect(next.revision).toBe(2)
    expect(next.items.map((row) => row.slug)).toEqual(['alpha', 'beta'])
    expect(next.items[1]?.metadata.name).toBe('Beta 2')
    expect(next.total).toBe(2)
  })

  it('inserts a matching new slug and ignores ones that fail the search', () => {
    const page = { items: [skill('alpha')], total: 1, revision: 4 }
    const next = applySkillsChangedDelta({
      page,
      delta: { revision: 5, changed: ['alpha-search', 'other'], removed: [] },
      fetchedChanged: [skill('alpha-search'), skill('other')],
      query: 'alpha',
    })
    expect(next.items.map((row) => row.slug)).toEqual(['alpha', 'alpha-search'])
    expect(next.total).toBe(2)
  })

  it('readSkillsPage uses querySkills and never materializes the full list', async () => {
    const seen: unknown[] = []
    const page = await readSkillsPage({
      querySkills: async (args) => {
        seen.push(args)
        return { items: [skill('one')], total: 10_000, revision: 9 }
      },
      getSkills: async () => {
        throw new Error('must not fall back to getSkills')
      },
    }, { workspaceId: 'ws', query: 'one', limit: 80 })
    expect(page.total).toBe(10_000)
    expect(page.items).toHaveLength(1)
    expect(seen).toEqual([{ workspaceId: 'ws', query: 'one', offset: 0, limit: 80 }])
  })

  it('legacy getSkills fallback slices instead of handing the caller 10k rows', async () => {
    const all = Array.from({ length: 250 }, (_, i) => skill(`s${i}`))
    const page = await readSkillsPage(
      { getSkills: async () => all },
      { workspaceId: 'ws', limit: 80, offset: 80 },
    )
    expect(page.total).toBe(250)
    expect(page.items).toHaveLength(80)
    expect(page.items[0]?.slug).toBe('s80')
  })
})
