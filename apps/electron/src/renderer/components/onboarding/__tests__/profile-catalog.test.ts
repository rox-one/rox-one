import { describe, expect, it } from 'bun:test'
import {
  PROFILE_BUBBLE_GROUPS,
  PROFILE_BUBBLE_GROUP_IDS,
  PROFILE_BUBBLE_GROUP_ORDER,
  PROFILE_BUBBLE_LABEL_BY_ID,
  rankDeepInterests,
} from '../profile-catalog'

describe('profile bubble catalog', () => {
  it('has seven groups of fifteen options each', () => {
    expect(PROFILE_BUBBLE_GROUP_IDS.length).toBe(7)
    expect(PROFILE_BUBBLE_GROUP_ORDER.length).toBe(7)
    for (const id of PROFILE_BUBBLE_GROUP_IDS) {
      expect(PROFILE_BUBBLE_GROUPS[id].items.length).toBe(15)
    }
  })

  it('uses globally unique ids and non-empty bilingual labels', () => {
    const ids = PROFILE_BUBBLE_GROUP_IDS.flatMap((id) => PROFILE_BUBBLE_GROUPS[id].items.map((item) => item.id))
    expect(ids.length).toBe(7 * 15)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of PROFILE_BUBBLE_GROUP_IDS) {
      for (const item of PROFILE_BUBBLE_GROUPS[id].items) {
        expect(item.ru.trim().length).toBeGreaterThan(0)
        expect(item.en.trim().length).toBeGreaterThan(0)
        expect(PROFILE_BUBBLE_LABEL_BY_ID[item.id]?.ru).toBe(item.ru)
      }
    }
  })

  it('marks exactly the deepInterests group as adaptive', () => {
    const adaptive = PROFILE_BUBBLE_GROUP_IDS.filter((id) => PROFILE_BUBBLE_GROUPS[id].adaptive)
    expect(adaptive).toEqual(['deepInterests'])
  })

  it('only the adaptive group carries scoring metadata', () => {
    for (const id of PROFILE_BUBBLE_GROUP_IDS) {
      if (id === 'deepInterests') continue
      for (const item of PROFILE_BUBBLE_GROUPS[id].items) {
        expect(item.relatedFunctions).toBeUndefined()
        expect(item.relatedAreas).toBeUndefined()
      }
    }
  })
})

describe('adaptive deep-interest ranking', () => {
  it('returns the whole base set in base order without context', () => {
    const base = PROFILE_BUBBLE_GROUPS.deepInterests.items.map((item) => item.id)
    expect(rankDeepInterests({ functions: [], areas: [] }).map((item) => item.id)).toEqual(base)
  })

  it('is deterministic for identical input', () => {
    const context = { functions: ['design'], areas: ['mediaEntertainment'] }
    const first = rankDeepInterests(context, ['games']).map((item) => item.id)
    const second = rankDeepInterests(context, ['games']).map((item) => item.id)
    expect(first).toEqual(second)
  })

  it('ranks matching interests first by descending score', () => {
    const ranked = rankDeepInterests({ functions: ['design'], areas: ['mediaEntertainment'] })
    const scored = ranked.map((item) => ({
      id: item.id,
      score:
        (item.relatedFunctions ?? []).filter((id) => id === 'design').length +
        (item.relatedAreas ?? []).filter((id) => id === 'mediaEntertainment').length,
    }))
    for (let i = 1; i < scored.length; i++) {
      expect(scored[i - 1].score).toBeGreaterThanOrEqual(scored[i].score)
    }
    // art (design + mediaEntertainment) outranks games (design + softwareIt/mediaEntertainment)
    expect(['art', 'music']).toContain(ranked[0].id)
  })

  it('filters out unmatched, unanchored interests but keeps anchors', () => {
    const ranked = rankDeepInterests({ functions: ['design'], areas: ['artsDesign'] }).map((item) => item.id)
    // psychology has no design/artsDesign link and is not an anchor.
    expect(ranked).not.toContain('psychology')
    // anchors (ai, science, art) always stay visible.
    expect(ranked).toContain('ai')
    expect(ranked).toContain('science')
  })

  it('keeps previously selected ids visible even when unmatched', () => {
    const ranked = rankDeepInterests({ functions: ['legal'], areas: ['law'] }, ['psychology']).map((item) => item.id)
    expect(ranked).toContain('psychology')
  })
})