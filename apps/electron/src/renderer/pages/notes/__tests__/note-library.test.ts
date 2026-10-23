import { describe, expect, it } from 'bun:test'
import {
  isReservedTemplateId,
  mergeRecentsByOpened,
  patchNoteLibraryChromeContent,
  readNoteCover,
  readNoteIcon,
  sanitizeTemplateId,
  sanitizeTemplateIdDraft,
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
    expect(readNoteCover({ cover: 'data:image/svg+xml;base64,PHN2Zy8+' })).toBeNull()
    expect(readNoteCover({ cover: 'data:image/svg;base64,PHN2Zy8+' })).toBeNull()
    expect(readNoteCover({ cover: 'linear-gradient(red, image(https://evil.example/x.png))' })).toBeNull()
    expect(readNoteCover({ cover: 'linear-gradient(red, image-set(url(https://evil.example/x.png) 1x))' })).toBeNull()
    expect(readNoteCover({ cover: 'linear-gradient(red, element(#x))' })).toBeNull()
    expect(readNoteCover({ cover: 'linear-gradient(red, paint(foo))' })).toBeNull()
    expect(readNoteCover({ cover: 'linear-gradient(red, attr(data-x))' })).toBeNull()
    expect(readNoteIcon({ icon: '📝' })).toBe('📝')
    // ZWJ family emoji is one grapheme but many UTF-16 units — must not reject solely for length>32.
    const family = '👨\u200D👩\u200D👧\u200D👦'
    expect(family.length).toBeGreaterThan(8)
    expect(readNoteIcon({ icon: family })).toBe(family)
    expect(readNoteIcon({ icon: '😀😀😀😀😀😀😀😀😀' })).toBeNull() // 9 graphemes
    expect(readNoteIcon({ icon: 'x'.repeat(129) })).toBeNull()
    expect(readNoteIcon({ icon: `ok${String.fromCharCode(0)}bad` })).toBeNull()
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


  it('surgically patches cover/icon keys without rewriting the rest of the header', () => {
    const source = [
      '---',
      '# keep me',
      'title: Hello',
      'tags:',
      '  - a',
      'createdAt: 1700000000000',
      '---',
      '',
      'Body with --- fence',
      '',
    ].join('\n')
    const withCover = patchNoteLibraryChromeContent(source, { cover: '#112233' })
    expect(withCover).toContain('# keep me')
    expect(withCover).toContain('title: Hello')
    expect(withCover).toContain('tags:')
    expect(withCover).toContain('  - a')
    expect(withCover).toContain('createdAt: 1700000000000')
    expect(withCover).toContain('cover: "#112233"')
    expect(withCover).toContain('Body with --- fence')
    const withIcon = patchNoteLibraryChromeContent(withCover!, { icon: '⭐' })
    expect(withIcon).toContain('cover: "#112233"')
    expect(withIcon).toContain('icon: "⭐"')
    expect(withIcon).toContain('# keep me')
    const cleared = patchNoteLibraryChromeContent(withIcon!, { cover: null, icon: '' })
    expect(cleared).not.toContain('cover:')
    expect(cleared).not.toContain('icon:')
    expect(cleared).toContain('# keep me')
    expect(cleared).toContain('title: Hello')
    expect(patchNoteLibraryChromeContent(source, { cover: 'javascript:alert(1)' })).toBeNull()
    // No frontmatter — create a minimal header with only the chrome key.
    const bare = patchNoteLibraryChromeContent('Just prose\n', { icon: '📝' })
    expect(bare).toBe('---\nicon: "📝"\n---\nJust prose\n')
    // Block/folded scalar with blank line before indented body must refuse (no orphans).
    const blockBlank = [
      '---',
      'cover: |',
      '',
      '  multiline',
      'title: Keep',
      '---',
      '',
      'body',
      '',
    ].join('\n')
    expect(patchNoteLibraryChromeContent(blockBlank, { cover: '#112233' })).toBeNull()
    const folded = [
      '---',
      'icon: >-',
      '  soft',
      '---',
      '',
      'x',
      '',
    ].join('\n')
    expect(patchNoteLibraryChromeContent(folded, { icon: '⭐' })).toBeNull()
    // Duplicate top-level cover:/icon: — refuse.
    const dup = [
      '---',
      'cover: "#111111"',
      'title: A',
      'cover: "#222222"',
      '---',
      '',
      'body',
      '',
    ].join('\n')
    expect(patchNoteLibraryChromeContent(dup, { cover: '#112233' })).toBeNull()
  })

  it('sanitizes template ids', () => {
    expect(sanitizeTemplateId(' My Standup!!.md ')).toBe('my-standup')
    expect(sanitizeTemplateId('../evil')).toBe('evil')
    expect(sanitizeTemplateId('team/weekly')).toBe('team/weekly')
    expect(sanitizeTemplateId('templates/evil')).toBe('')
    expect(sanitizeTemplateId('foo/templates/bar')).toBe('')
    expect(sanitizeTemplateIdDraft('team/')).toBe('team/')
    expect(sanitizeTemplateIdDraft('team/weekly')).toBe('team/weekly')
    expect(sanitizeTemplateId('team/')).toBe('team')
    expect(isReservedTemplateId('Daily')).toBe(true)
    expect(isReservedTemplateId('daily.md')).toBe(true)
    expect(isReservedTemplateId('team/daily')).toBe(true)
    expect(isReservedTemplateId('standup')).toBe(false)
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
    // Duplicate opened ids must not consume extra slots.
    expect(mergeRecentsByOpened(
      [
        { id: 'a', updatedAt: 1 },
        { id: 'b', updatedAt: 2 },
        { id: 'c', updatedAt: 3 },
      ],
      ['a', 'a', 'b', 'a'],
      [],
      3,
    )).toEqual(['a', 'b', 'c'])
  })
})
