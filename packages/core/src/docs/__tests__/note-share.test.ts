import { describe, expect, it } from 'bun:test'
import { applyNoteShareUpdate, defaultNoteShare, normalizeNoteShare, noteShareUrl } from '@rox/core/docs'

const TOKEN_A = 'aaaaaaaaaaaaaaaaaaaaaa'
const TOKEN_B = 'bbbbbbbbbbbbbbbbbbbbbb'

describe('note share model', () => {
  it('defaults to a private view link', () => {
    const s = defaultNoteShare('Daily')
    expect(s.link).toEqual({ enabled: false, role: 'view', token: null, createdAt: null })
    expect(noteShareUrl(s)).toBeNull()
  })

  it('mints a token on first enable and keeps it across disable/enable', () => {
    let n = 0
    const mint = () => [TOKEN_A, TOKEN_B][n++]!
    const on = applyNoteShareUpdate(defaultNoteShare('Daily'), { enabled: true }, mint, 10)
    expect(on.link).toMatchObject({ enabled: true, token: TOKEN_A, createdAt: 10 })
    const off = applyNoteShareUpdate(on, { enabled: false }, mint, 11)
    expect(off.link.token).toBe(TOKEN_A)
    const back = applyNoteShareUpdate(off, { enabled: true, role: 'edit' }, mint, 12)
    expect(back.link).toMatchObject({ enabled: true, role: 'edit', token: TOKEN_A })
    expect(noteShareUrl(back)).toBe(`rox://notes/note/Daily?share=${TOKEN_A}&role=edit`)
  })

  it('regenerate revokes the old token', () => {
    const on = applyNoteShareUpdate(defaultNoteShare('a/b c'), { enabled: true }, () => TOKEN_A, 1)
    const next = applyNoteShareUpdate(on, { regenerate: true }, () => TOKEN_B, 2)
    expect(next.link.token).toBe(TOKEN_B)
    expect(noteShareUrl(next)).toBe(`rox://notes/note/a/b%20c?share=${TOKEN_B}&role=view`)
  })

  it('rejects invalid roles and tokens', () => {
    expect(() => applyNoteShareUpdate(defaultNoteShare('x'), { role: 'owner' as never }, () => TOKEN_A, 1)).toThrow('Invalid share role')
    expect(() => applyNoteShareUpdate(defaultNoteShare('x'), { enabled: true }, () => 'short', 1)).toThrow('Invalid share token')
  })

  it('normalizes malformed sidecars closed', () => {
    expect(normalizeNoteShare(null, 'x').link.enabled).toBe(false)
    expect(normalizeNoteShare({ link: { enabled: true, token: 'bad', role: 'admin' } }, 'x').link).toEqual({ enabled: false, role: 'view', token: null, createdAt: null })
    expect(normalizeNoteShare({ noteId: 'other', link: { enabled: true, token: TOKEN_A, role: 'edit', createdAt: 5 }, updatedAt: 6 }, 'x')).toEqual({
      schemaVersion: 1, noteId: 'x', link: { enabled: true, role: 'edit', token: TOKEN_A, createdAt: 5 }, updatedAt: 6,
    })
  })
})
