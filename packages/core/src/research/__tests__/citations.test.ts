import { describe, expect, it } from 'bun:test'
import { citationMap, findCitationSpans, lookupCitation } from '../index.ts'
import type { RankedSource } from '../index.ts'

const source: RankedSource = {
  url: 'https://example.com/paper',
  canonicalUrl: 'https://example.com/paper',
  title: 'Example Paper on Rox',
  snippet: 'Abstract',
  publishedAt: '2026-01-02',
  reliability: 'high',
  contradiction: false,
  queryIds: ['primary-1'],
  providers: ['primary_url'],
  primary: true,
  rank: 1,
}

describe('citation spans', () => {
  it('marks sourced statements that cite title or URL', () => {
    const text = 'According to Example Paper on Rox the vault stays local. See https://example.com/paper.'
    const spans = findCitationSpans(text, [source])
    expect(spans.length).toBeGreaterThan(0)
    expect(spans[0]?.sourceUrl).toBe(source.url)
    expect(text.slice(spans[0]!.start, spans[0]!.end)).toContain('Example Paper')
  })

  it('looks up hover-card citations by canonical URL', () => {
    const map = citationMap([source])
    expect(lookupCitation('https://www.example.com/paper/', map)?.title).toBe(source.title)
    expect(lookupCitation('https://other.test', map)).toBeUndefined()
  })
})
