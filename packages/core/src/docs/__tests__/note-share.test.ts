import { describe, expect, it } from 'bun:test'
import { applyNoteShareUpdate, constantTimeEqual, defaultNoteShare, normalizeNoteShare, noteShareBlocksWrite, noteShareUrl, resolveNoteShareAccess } from '@rox/core/docs'

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

describe('note share link access', () => {
  const mint = () => TOKEN_A
  const view = applyNoteShareUpdate(defaultNoteShare('Daily'), { enabled: true }, mint, 1)
  const edit = applyNoteShareUpdate(view, { role: 'edit' }, mint, 2)

  it('valid edit link opens editable', () => {
    const access = resolveNoteShareAccess(edit, TOKEN_A)
    expect(access).toEqual({ ok: true, noteId: 'Daily', role: 'edit' })
    expect(noteShareBlocksWrite(access, 'Daily')).toBe(false)
  })

  it('valid view link opens read-only and blocks writes', () => {
    const access = resolveNoteShareAccess(view, TOKEN_A)
    expect(access).toEqual({ ok: true, noteId: 'Daily', role: 'view' })
    expect(noteShareBlocksWrite(access, 'Daily')).toBe(true)
    expect(noteShareBlocksWrite(access, 'Other')).toBe(false)
  })

  it('URL role is ignored: stored view wins over a claimed edit', () => {
    // The resolver takes no role input at all; only the stored record decides.
    expect(resolveNoteShareAccess(view, TOKEN_A)).toMatchObject({ role: 'view' })
  })

  it('stale token after reset is revoked', () => {
    const reset = applyNoteShareUpdate(edit, { regenerate: true }, () => TOKEN_B, 3)
    expect(resolveNoteShareAccess(reset, TOKEN_A)).toMatchObject({ ok: false, reason: 'revoked' })
    expect(resolveNoteShareAccess(reset, TOKEN_B)).toMatchObject({ ok: true })
  })

  it('disabled, missing, and malformed links are rejected', () => {
    const off = applyNoteShareUpdate(edit, { enabled: false }, mint, 4)
    expect(resolveNoteShareAccess(off, TOKEN_A)).toMatchObject({ ok: false, reason: 'disabled' })
    expect(resolveNoteShareAccess(defaultNoteShare('Daily'), TOKEN_A)).toMatchObject({ ok: false, reason: 'invalid' })
    expect(resolveNoteShareAccess(edit, 'short')).toMatchObject({ ok: false, reason: 'invalid' })
    expect(resolveNoteShareAccess(edit, undefined)).toMatchObject({ ok: false, reason: 'invalid' })
  })

  it('rejected access blocks writes for that note', () => {
    expect(noteShareBlocksWrite({ ok: false, noteId: 'Daily', reason: 'revoked' }, 'Daily')).toBe(true)
    expect(noteShareBlocksWrite(null, 'Daily')).toBe(false)
  })

  it('constantTimeEqual', () => {
    expect(constantTimeEqual(TOKEN_A, TOKEN_A)).toBe(true)
    expect(constantTimeEqual(TOKEN_A, TOKEN_B)).toBe(false)
    expect(constantTimeEqual(TOKEN_A, TOKEN_A + 'x')).toBe(false)
  })
})
