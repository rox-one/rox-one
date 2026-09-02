import { describe, expect, it } from 'bun:test'
import {
  clampNoteRailWidth,
  getNoteRailWidth,
  parseDocumentOutline,
  parseStoredRailCollapsed,
  parseStoredRailWidth,
} from '../document-outline'

describe('parseDocumentOutline', () => {
  it('extracts markdown headings after frontmatter and ignores fenced code', () => {
    const outline = parseDocumentOutline(`---
title: Example
---

# Plan

\`\`\`md
# Not a heading
\`\`\`

## [[Rox|Rox note]] and \`code\`
### Final step ###
`, 'Fallback')

    expect(outline.title).toBe('Fallback')
    expect(outline.items).toEqual([
      { id: '2:plan', title: 'Plan', level: 1, line: 2, ordinal: 0, slug: 'plan' },
      {
        id: '8:rox-note-and-code',
        title: 'Rox note and code',
        level: 2,
        line: 8,
        ordinal: 1,
        slug: 'rox-note-and-code',
      },
      {
        id: '9:final-step',
        title: 'Final step',
        level: 3,
        line: 9,
        ordinal: 2,
        slug: 'final-step',
      },
    ])
    expect(outline.isBodyEmpty).toBe(false)
  })

  it('keeps duplicate heading slugs stable', () => {
    const outline = parseDocumentOutline('# Same\n## Same\n')
    expect(outline.items.map((item) => item.slug)).toEqual(['same', 'same-2'])
  })

  it('reports empty bodies without inventing headings', () => {
    const outline = parseDocumentOutline('---\ntitle: Empty\n---\n\n', 'Empty note')
    expect(outline.items).toEqual([])
    expect(outline.isBodyEmpty).toBe(true)
  })
})

describe('note rail helpers', () => {
  it('returns compact widths for collapsed rails', () => {
    expect(getNoteRailWidth('vault', true, 360)).toBe(44)
    expect(getNoteRailWidth('outline', true, 260)).toBe(38)
  })

  it('clamps expanded widths to each rail boundary', () => {
    expect(clampNoteRailWidth('vault', 100)).toBe(240)
    expect(clampNoteRailWidth('outline', 500)).toBe(320)
    expect(parseStoredRailWidth('inspector', '999')).toBe(420)
  })

  it('parses persisted collapse flags defensively', () => {
    expect(parseStoredRailCollapsed('true')).toBe(true)
    expect(parseStoredRailCollapsed('not-json', true)).toBe(true)
    expect(parseStoredRailCollapsed(null, false)).toBe(false)
  })
})
