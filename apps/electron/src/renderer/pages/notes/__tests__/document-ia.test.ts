import { describe, expect, test } from 'bun:test'
import {
  applyPersistentFolds,
  defaultNoteCommands,
  extractColumns,
  extractComments,
  extractFootnotes,
  extractWikiLinks,
  foldIdForHeading,
  matchNoteCommands,
  noteBreadcrumbs,
  parseNoteDocument,
  parseNotesRailLayout,
  parsePersistedFolds,
  roundTripNoteMarkdown,
  sanitizePastedMarkdown,
  serializeColumns,
  serializeComment,
  serializeNotesRailLayout,
  upsertMarkdownComment,
} from '../document-ia'

const CORPUS = `---
title: Structured
tags: [alpha]
---

# Intro ^blk-intro

A paragraph with a [[Linked Note|alias]] and an embed ![[Daily]].

- [ ] Open task
- [x] Done task <!-- folded -->

See footnote.[^fn-1]

:::columns 2
:::column
Left cell
:::
:::column
Right cell
:::
:::

> [!spoiler]
> hidden

| Name | Value |
| --- | --- |
| a | 1 |

---

[^fn-1]: Footnote survives

<!-- rox:comment id="c1" quote="Intro" created="1" -->
Needs a second look
<!-- /rox:comment -->
`

describe('notes document IA', () => {
  test('round-trips headings, tasks, footnotes, wikilinks, comments and columns', () => {
    const parsed = parseNoteDocument(CORPUS)
    expect(parsed.headings.map((heading) => heading.text)).toEqual(['Intro'])
    expect(parsed.tasks).toEqual([
      { text: 'Open task', checked: false, folded: false },
      { text: 'Done task', checked: true, folded: true },
    ])
    expect(parsed.footnotes).toEqual([{ id: 'fn-1', body: 'Footnote survives' }])
    expect(extractWikiLinks(CORPUS)).toEqual([
      { target: 'Linked Note', alias: 'alias', embed: false },
      { target: 'Daily', embed: true },
    ])
    expect(parsed.columns).toEqual([{ columns: 2, cells: ['Left cell', 'Right cell'] }])
    expect(parsed.comments).toEqual([
      { id: 'c1', quote: 'Intro', body: 'Needs a second look', createdAt: 1 },
    ])
    expect(parsed.blockIds.map((block) => block.id)).toEqual(['blk-intro'])
    expect(parsed.tables).toBe(1)
    expect(parsed.horizontalRules).toBeGreaterThan(0)
    expect(parsed.embeds).toContain('Daily')

    const next = roundTripNoteMarkdown(CORPUS)
    const reparsed = parseNoteDocument(next)
    expect(reparsed.footnotes).toEqual(parsed.footnotes)
    expect(reparsed.comments).toEqual(parsed.comments)
    expect(reparsed.columns).toEqual(parsed.columns)
    expect(reparsed.wikiLinks).toEqual(parsed.wikiLinks)
  })

  test('persists rail widths and restores them after reopen', () => {
    const stored = serializeNotesRailLayout({
      vault: 320,
      toc: 200,
      comments: 240,
      inspector: 300,
      vaultCollapsed: false,
      tocCollapsed: true,
      commentsCollapsed: false,
    })
    const restored = parseNotesRailLayout(stored)
    expect(restored.vault).toBe(320)
    expect(restored.toc).toBe(200)
    expect(restored.comments).toBe(240)
    expect(restored.tocCollapsed).toBe(true)
    expect(parseNotesRailLayout('{"vault":12}').vault).toBe(140)
  })

  test('portable folds, comments and columns survive external markdown editing', () => {
    const folded = applyPersistentFolds('# Intro\n\nBody\n\n## Next\n\nMore\n', ['intro'])
    expect(folded).toContain('data-rox-fold="intro"')
    expect(foldIdForHeading('Intro')).toBe('intro')

    const withComment = upsertMarkdownComment('# Title\n', {
      id: 'c2',
      quote: 'Title',
      body: 'Ship it',
      createdAt: 9,
    })
    expect(extractComments(withComment)[0]?.body).toBe('Ship it')
    expect(serializeComment(extractComments(withComment)[0]!)).toContain('rox:comment')

    expect(extractColumns(serializeColumns(['A', 'B']))).toEqual([
      { columns: 2, cells: ['A', 'B'] },
    ])
    expect(extractFootnotes('x[^a]\n\n[^a]: hi')).toEqual([{ id: 'a', body: 'hi' }])
  })

  test('sanitizes pasted html and matches ! / @ command palettes', () => {
    expect(sanitizePastedMarkdown('<script>alert(1)</script>Hello javascript:void(0)')).toBe('Hello void(0)')
    const catalog = defaultNoteCommands({
      sessions: [{ id: 's1', title: 'Launch' }],
      agents: [{ id: 'rox', label: 'Rox' }],
      projects: [{ id: 'p1', name: 'Atlas' }],
      tasks: [{ id: 't1', text: 'Write spec' }],
      people: [{ id: 'u1', name: 'Ada' }],
      entities: [{ id: 'e1', name: 'Kernel' }],
    })
    expect(matchNoteCommands('!ag', catalog).map((item) => item.id)).toEqual(['bang:ask-agent'])
    expect(matchNoteCommands('@ada', catalog).map((item) => item.subject)).toEqual(['person'])
    expect(matchNoteCommands('nope', catalog)).toEqual([])
  })

  test('document breadcrumbs replace session-style modes', () => {
    expect(noteBreadcrumbs('ops/alpha/spec', 'Spec').map((crumb) => crumb.label)).toEqual([
      'vault',
      'ops',
      'alpha',
      'Spec',
    ])
    expect(parsePersistedFolds('["intro","tasks"]')).toEqual(['intro', 'tasks'])
  })
})
