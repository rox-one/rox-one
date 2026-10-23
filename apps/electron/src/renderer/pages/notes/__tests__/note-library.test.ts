import { describe, expect, it } from 'bun:test'
import {
  mergeRecentsByOpened,
  readNoteCover,
  readNoteIcon,
  sanitizeTemplateId,
  touchRecentOpened,
  withNoteLibraryProperties,
} from '../note-library'

describe('note-library', () => {
  it('reads safe cover and icon values', () => {
    expect(readNoteCover({ cover: 'linear-gradient(red, blue)' })).toContain('linear-gradient')
    expect(readNoteCover({ cover: 'https://cdn.example/cover.jpg' })).toContain('https://')
    expect(readNoteCover({ cover: '#112233' })).toBe('#112233')
    expect(readNoteCover({ cover: 'javascript:alert(1)' })).toBeNull()
    expect(readNoteCover({ cover: 'linear-gradient(red, blue), url(https://evil.example/x.png)' })).toBeNull()
    expect(readNoteCover({ cover: 'url(https://cdn.example/x.png)' })).toBeNull()
    // CSS hex-escape bypass of url(...) — backslash must be rejected on non-URL covers.
    expect(readNoteCover({ cover: 'linear-gradient(red, \\75rl(file:///etc/passwd))' })).toBeNull()
    expect(readNoteCover({ cover: 'linear-gradient(red, blue)' })).toContain('linear-gradient')
    expect(readNoteIcon({ icon: '📝' })).toBe('📝')
    expect(readNoteIcon({ icon: 'x'.repeat(40) })).toBeNull()
  })

  it('patches cover/icon properties without dropping siblings', () => {
    const next = withNoteLibraryProperties({ title: 'A', tags: [], icon: '旧' }, { icon: '⭐', cover: '#112233' })
    expect(next.title).toBe('A')
    expect(next.icon).toBe('⭐')
    expect(next.cover).toBe('#112233')
    const cleared = withNoteLibraryProperties(next, { cover: null, icon: '' })
    expect(cleared.cover).toBeUndefined()
    expect(cleared.icon).toBeUndefined()
  })

  it('sanitizes template ids', () => {
    expect(sanitizeTemplateId(' My Standup!!.md ')).toBe('my-standup')
    expect(sanitizeTemplateId('../evil')).toBe('evil')
    expect(sanitizeTemplateId('team/weekly')).toBe('team/weekly')
    expect(sanitizeTemplateId('templates/evil')).toBe('')
    expect(sanitizeTemplateId('foo/templates/bar')).toBe('')
  })

  it('tracks opened recents and merges with updatedAt fallback', () => {
    expect(touchRecentOpened(['b', 'c'], 'a')).toEqual(['a', 'b', 'c'])
    expect(touchRecentOpened(['a', 'b'], 'b')).toEqual(['b', 'a'])
    const ids = mergeRecentsByOpened(
      [
        { id: 'old', updatedAt: 1 },
        { id: 'new', updatedAt: 9 },
        { id: 'mid', updatedAt: 5 },
        { id: 'pin', updatedAt: 8 },
      ],
      ['mid', 'missing'],
      ['pin'],
      3,
    )
    expect(ids).toEqual(['mid', 'new', 'old'])
  })
})
