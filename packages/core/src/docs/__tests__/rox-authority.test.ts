/** W1-06 (#1503) — `rox_authority` frontmatter reader. */
import { describe, expect, test } from 'bun:test'
import { readRoxAuthority, readRoxFrontmatter } from '../rox-authority.ts'

describe('readRoxFrontmatter', () => {
  test('a note without frontmatter or keys is local', () => {
    expect(readRoxFrontmatter('# Title\n\nBody')).toEqual({ authority: 'local', status: 'ok', subtype: 'doc', readOnlyMirror: false })
    expect(readRoxAuthority('---\ntitle: Заметка\n---\nТекст')).toBe('local')
  })

  test('reads every rox key of a migrated note', () => {
    const md = '---\ntitle: Plan\nrox_id: 7f0c\nrox_authority: workspace\nrox_doc_id: "doc-1"\nrox_subtype: minutes\n---\nBody\n'
    expect(readRoxFrontmatter(md)).toEqual({ authority: 'workspace', status: 'ok', roxId: '7f0c', docId: 'doc-1', subtype: 'minutes', readOnlyMirror: true })
    expect(readRoxAuthority(new TextEncoder().encode(md))).toBe('workspace')
  })

  test('explicit local stamp, CRLF and BOM', () => {
    expect(readRoxFrontmatter('\uFEFF---\r\nrox_authority: local\r\nrox_id: n1\r\n---\r\nx').authority).toBe('local')
    expect(readRoxFrontmatter('---\r\nrox_authority: workspace\r\n---\r\n').authority).toBe('workspace')
  })

  test('unknown or non-string values are invalid and fall back to local', () => {
    expect(readRoxFrontmatter('---\nrox_authority: cloud\n---\n')).toMatchObject({ authority: 'local', status: 'invalid', readOnlyMirror: false })
    expect(readRoxFrontmatter('---\nrox_authority: 1\n---\n')).toMatchObject({ authority: 'local', status: 'invalid' })
    expect(readRoxFrontmatter('---\nrox_authority: workspace\nrox_doc_id: ""\n---\n')).toMatchObject({ authority: 'workspace', status: 'invalid' })
    expect(readRoxFrontmatter('---\nmeta:\n  rox_authority: workspace\n---\n').authority).toBe('local')
  })

  test('unparseable frontmatter is unreadable and local (never blocks a save by accident)', () => {
    expect(readRoxFrontmatter('---\nrox_authority: workspace\nrox_authority: local\n---\n')).toMatchObject({ authority: 'local', status: 'unreadable' })
    expect(readRoxFrontmatter('---\n: [\n---\n')).toMatchObject({ authority: 'local', status: 'unreadable' })
  })
})
