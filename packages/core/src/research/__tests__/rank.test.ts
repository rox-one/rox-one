import { describe, expect, it } from 'bun:test'
import { canonicalUrl, dedupeAndRank, sourceReliability } from '../index.ts'
import type { SearchHit } from '../index.ts'

function hit(partial: Partial<SearchHit> & { url: string }): SearchHit {
  return {
    title: 'Title',
    snippet: 'Snippet',
    queryId: 'q1',
    provider: 'exa',
    ...partial,
  }
}

describe('canonicalUrl', () => {
  it('strips tracking params, hash, www, and trailing slash', () => {
    expect(canonicalUrl('https://www.Example.com/a/?utm_source=x&q=1#frag')).toBe(
      'https://example.com/a?q=1',
    )
  })
})

describe('dedupeAndRank', () => {
  it('dedupes aliases and keeps primary first with provenance', () => {
    const sources = dedupeAndRank(
      [
        hit({
          title: 'Paper',
          url: 'https://example.com/paper?utm_source=x',
          snippet: 'Primary abstract 2024',
          queryId: 'primary-1',
          provider: 'primary_url',
        }),
        hit({
          title: 'Paper mirror',
          url: 'https://www.example.com/paper/',
          snippet: 'Mirror',
          queryId: 'lang-2',
          provider: 'exa',
        }),
        hit({
          title: 'Gov note',
          url: 'https://nist.gov/x',
          snippet: 'Official 2024',
          queryId: 'lang-2',
          provider: 'exa',
        }),
      ],
      new Set(['https://example.com/paper']),
    )
    expect(sources).toHaveLength(2)
    expect(sources[0]?.primary).toBe(true)
    expect(sources[0]?.queryIds).toEqual(['primary-1', 'lang-2'])
    expect(sources[0]?.providers).toContain('exa')
    expect(sources[1]?.reliability).toBe('high')
  })

  it('flags year contradictions across overlapping sources', () => {
    const sources = dedupeAndRank([
      hit({
        title: 'Release notes',
        url: 'https://a.test/one',
        snippet: 'Widget released in 2020 after review',
        queryId: 'q1',
      }),
      hit({
        title: 'Release notes later',
        url: 'https://b.test/two',
        snippet: 'Widget released in 2024 after review',
        queryId: 'q2',
      }),
    ])
    expect(sources.some((s) => s.contradiction)).toBe(true)
  })
})

describe('sourceReliability', () => {
  it('treats http as low and missing URL as unknown', () => {
    expect(sourceReliability({ url: 'http://example.com' })).toBe('low')
    expect(sourceReliability({ url: 'not a url' })).toBe('unknown')
  })
})
