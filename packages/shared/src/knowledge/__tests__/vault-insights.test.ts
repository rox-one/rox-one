import { describe, expect, it } from 'bun:test'
import {
  aliasesFromProperties,
  applyEntityMerge,
  applyLinkSuggestion,
  buildVaultInsights,
  diagnoseFootnotes,
  extractNamedEntities,
  insertFootnote,
  nextFootnoteId,
  rankLinkSuggestions,
  removeFootnote,
  undoEntityMerge,
  updateFootnoteDefinition,
} from '../vault-insights.ts'

const catalog = [
  { id: 'projects/alpha', title: 'Alpha', aliases: ['A1'] },
  { id: 'projects/beta', title: 'Beta', aliases: ['Bee'] },
  { id: 'people/alice-smith', title: 'Alice Smith', aliases: [] },
]

describe('vault named entities', () => {
  it('extracts people, dates, proper names and wikilink provenance', () => {
    const content = `---
title: Ops
people:
  - Alice Smith
---

Met Alice Smith on 2026-09-12 about [[Beta]].

The North River plant is blocked.
`
    const entities = extractNamedEntities('ops', content, catalog, { people: ['Alice Smith'] })
    expect(entities.some((item) => item.name === 'Alice Smith' && item.kind === 'person')).toBe(true)
    expect(entities.some((item) => item.name === '2026-09-12' && item.kind === 'date')).toBe(true)
    expect(entities.some((item) => item.name === 'North River' && item.kind === 'person')).toBe(true)
    expect(entities.some((item) => item.name === 'Beta' && item.kind === 'note')).toBe(true)
    expect(entities.find((item) => item.name === 'Beta')?.evidence).toContain('[[Beta]]')
  })
})

describe('ranked link suggestions', () => {
  it('ranks unlinked title and alias mentions and skips existing wikilinks', () => {
    const content = `Talk to Bee about Alpha and the rest.

Already linked [[Beta]].
`
    const suggestions = rankLinkSuggestions('inbox', content, catalog)
    expect(suggestions.some((item) => item.targetTitle === 'Beta' && item.mention === 'Bee' && item.reason === 'alias')).toBe(true)
    expect(suggestions.some((item) => item.targetTitle === 'Alpha' && item.reason === 'title')).toBe(true)
    expect(suggestions.every((item) => item.preview !== 'Already linked [[Beta]].' || item.mention !== 'Beta')).toBe(true)
  })

  it('wraps the first unlinked mention as a reversible wikilink', () => {
    const applied = applyLinkSuggestion('Talk to Bee later.', 'Bee', 'Beta')
    expect(applied).toBe('Talk to [[Beta|Bee]] later.')
    expect(applyLinkSuggestion('See Alpha now.', 'Alpha', 'Alpha')).toBe('See [[Alpha]] now.')
  })

  it('reads aliases from note properties so inspector catalogs match the vault index', () => {
    const fromProperties = [
      { id: 'projects/beta', title: 'Beta', aliases: aliasesFromProperties({ aliases: ['Bee', 'B'] }) },
    ]
    const suggestions = rankLinkSuggestions('inbox', 'Talk to Bee about the rest.', fromProperties)
    expect(suggestions.some((item) => item.targetTitle === 'Beta' && item.mention === 'Bee' && item.reason === 'alias')).toBe(true)
  })
})

describe('broken links, merges and footnotes', () => {
  it('builds insights with broken links, ranked suggestions, merges and footnote chrome', () => {
    const content = `Alice Smith also appears as A. Smith and met Bee.

See missing [[Ghost]] and known [[Beta]].

A claim[^fn].
Another[^missing].

[^fn]: footnote body
[^spare]: unused
`
    const insights = buildVaultInsights({
      documentId: 'ops',
      content,
      links: [
        { target: 'Ghost', line: 3 },
        { target: 'Beta', line: 3 },
      ],
      catalog,
      properties: { people: ['Alice Smith'] },
    })
    expect(insights.brokenLinks.map((item) => item.target)).toEqual(['Ghost'])
    expect(insights.linkSuggestions.some((item) => item.targetTitle === 'Beta')).toBe(true)
    expect(insights.suggestedMerges.some((item) => item.fromName === 'Bee' && item.toName === 'Beta')).toBe(true)
    expect(insights.footnotes.find((item) => item.id === 'fn')).toEqual(expect.objectContaining({ hasRef: true, hasDef: true, orphan: false, unused: false }))
    expect(insights.footnotes.find((item) => item.id === 'missing')).toEqual(expect.objectContaining({ orphan: true, unused: false }))
    expect(insights.footnotes.find((item) => item.id === 'spare')).toEqual(expect.objectContaining({ unused: true, orphan: false }))
  })

  it('creates, edits and removes footnotes without rewriting surrounding prose', () => {
    const start = 'Hello world.'
    const inserted = insertFootnote(start, 'source', start.length)
    expect(inserted.id).toBe('1')
    expect(inserted.markdown).toContain('Hello world.[^1]')
    expect(inserted.markdown).toContain('[^1]: source')
    const withExisting = insertFootnote('A claim[^fn].\n\n[^fn]: source\n', 'extra')
    expect(withExisting.markdown).toContain('A claim[^fn].[^1]')
    expect(withExisting.markdown).toMatch(/\[\^fn\]: source/)
    expect(withExisting.markdown).toMatch(/\[\^1\]: extra/)
    expect(withExisting.markdown).not.toContain('[^fn]: source[^1]')
    const edited = updateFootnoteDefinition(inserted.markdown, '1', 'updated source')
    expect(edited).toContain('[^1]: updated source')
    expect(diagnoseFootnotes(edited).map((item) => item.id)).toEqual(['1'])
    expect(nextFootnoteId(edited)).toBe('2')
    const removed = removeFootnote(edited, '1')
    expect(removed).not.toContain('[^1]')
  })

  it('applies and undoes an entity merge via alias wikilink', () => {
    const applied = applyEntityMerge('Ask Alice Smith later.', 'Alice Smith', 'Alice Smith')
    expect(applied).toBe('Ask [[Alice Smith]] later.')
    const aliased = applyEntityMerge('Ask A. Smith later.', 'A. Smith', 'Alice Smith')
    expect(aliased).toBe('Ask [[Alice Smith|A. Smith]] later.')
    expect(undoEntityMerge(aliased, 'A. Smith', 'Alice Smith')).toBe('Ask A. Smith later.')
  })
})
