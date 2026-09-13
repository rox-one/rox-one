import { describe, expect, test } from 'bun:test'
import {
  findNoteByWikiTarget,
  matchWikiLinkCandidates,
  parseWikiCreateTarget,
  wikiMatchSubtitle,
} from '../wiki-autocomplete'

const notes = [
  { id: 'ops/alpha', title: 'Alpha', relativePath: 'ops/alpha.md', properties: { aliases: ['A1'] } },
  { id: 'ops/beta', title: 'Beta', relativePath: 'ops/beta.md', properties: { aliases: ['Bee'] } },
  { id: 'daily/2026-09-12', title: '2026-09-12', relativePath: 'daily/2026-09-12.md' },
]

describe('wiki-link autocomplete', () => {
  test('matches titles, paths and aliases, ranked exact first', () => {
    expect(matchWikiLinkCandidates(notes, 'Bee').map((note) => note.id)).toEqual(['ops/beta'])
    expect(matchWikiLinkCandidates(notes, 'al').map((note) => note.id)).toEqual(['ops/alpha'])
    expect(matchWikiLinkCandidates(notes, 'ops/').map((note) => note.id)).toEqual(['ops/alpha', 'ops/beta'])
    expect(matchWikiLinkCandidates(notes, 'Bee', { excludeId: 'ops/beta' })).toEqual([])
  })

  test('treats aliases as existing targets so create is not offered', () => {
    expect(findNoteByWikiTarget(notes, 'Bee')?.id).toBe('ops/beta')
    expect(findNoteByWikiTarget(notes, 'alpha')?.id).toBe('ops/alpha')
    expect(findNoteByWikiTarget(notes, 'missing')).toBeNull()
  })

  test('shows the matching alias in the subtitle', () => {
    expect(wikiMatchSubtitle(notes[1]!, 'Bee')).toBe('ops/beta · Bee')
    expect(wikiMatchSubtitle(notes[0]!, 'Alpha')).toBe('ops/alpha')
  })

  test('parses foldered create targets without rewriting markdown', () => {
    expect(parseWikiCreateTarget('projects/Launch')).toEqual({ title: 'Launch', folder: 'projects' })
    expect(parseWikiCreateTarget('Bee.md')).toEqual({ title: 'Bee' })
  })
})
