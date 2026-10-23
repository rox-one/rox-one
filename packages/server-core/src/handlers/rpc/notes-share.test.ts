import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getNoteShareForRoot, updateNoteShareForRoot } from './notes'

let notesRoot: string
let extra: string[]

beforeEach(() => {
  extra = []
  notesRoot = mkdtempSync(join(tmpdir(), 'rox-notes-share-'))
  writeFileSync(join(notesRoot, 'Daily.md'), '# Daily\n', 'utf-8')
})

afterEach(() => {
  rmSync(notesRoot, { recursive: true, force: true })
  for (const root of extra) rmSync(root, { recursive: true, force: true })
})

const sidecar = (noteId = 'Daily') => join(notesRoot, '.rox', 'shares', `${Buffer.from(noteId, 'utf8').toString('base64url')}.json`)

describe('local note share sidecars', () => {
  it('defaults to private without writing a file', async () => {
    const share = await getNoteShareForRoot(notesRoot, 'Daily')
    expect(share.link.enabled).toBe(false)
    expect(existsSync(sidecar())).toBe(false)
  })

  it('enables, changes role, persists, and keeps the token stable', async () => {
    const on = await updateNoteShareForRoot(notesRoot, 'Daily', { enabled: true })
    expect(on.link.enabled).toBe(true)
    expect(on.link.token).toMatch(/^[A-Za-z0-9_-]{24}$/)
    const edit = await updateNoteShareForRoot(notesRoot, 'Daily', { role: 'edit' })
    expect(edit.link).toMatchObject({ role: 'edit', token: on.link.token })
    expect(JSON.parse(readFileSync(sidecar(), 'utf8')).link.role).toBe('edit')
    expect((await getNoteShareForRoot(notesRoot, 'Daily')).link.token).toBe(on.link.token)
    const regen = await updateNoteShareForRoot(notesRoot, 'Daily', { regenerate: true })
    expect(regen.link.token).not.toBe(on.link.token)
  })

  it('rejects missing notes, bad roles, and traversal ids', async () => {
    await expect(updateNoteShareForRoot(notesRoot, 'Missing', { enabled: true })).rejects.toThrow('Note not found')
    await expect(updateNoteShareForRoot(notesRoot, 'Daily', { role: 'owner' as never })).rejects.toThrow('Invalid share role')
    await expect(updateNoteShareForRoot(notesRoot, '../escape', { enabled: true })).rejects.toThrow()
  })

  it('refuses a symlinked shares directory', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'rox-notes-share-out-'))
    extra.push(outside)
    mkdirSync(join(notesRoot, '.rox'), { recursive: true })
    symlinkSync(outside, join(notesRoot, '.rox', 'shares'))
    await expect(updateNoteShareForRoot(notesRoot, 'Daily', { enabled: true })).rejects.toThrow()
  })

  it('treats a corrupt sidecar as private', async () => {
    mkdirSync(join(notesRoot, '.rox', 'shares'), { recursive: true })
    writeFileSync(sidecar(), '{not json', 'utf-8')
    expect((await getNoteShareForRoot(notesRoot, 'Daily')).link.enabled).toBe(false)
  })
})
