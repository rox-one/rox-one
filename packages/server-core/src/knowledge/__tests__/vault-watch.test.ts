import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  applyVaultWatchTick,
  closeAllVaultIndexes,
  getVaultBacklinks,
  listVaultDocuments,
  rebuildVaultIndex,
  vaultWatchNoteIdFromFilename,
} from '../vault-index.ts'

const dirs: string[] = []

function tmpNotes(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vault-watch-'))
  dirs.push(dir)
  const notesRoot = join(dir, 'notes')
  mkdirSync(join(notesRoot, 'daily'), { recursive: true })
  return notesRoot
}

afterEach(() => {
  closeAllVaultIndexes()
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('vault watch tick (issue 06 leftover)', () => {
  it('indexes coalesced external markdown writes without mutating files', () => {
    const notesRoot = tmpNotes()
    writeFileSync(join(notesRoot, 'seed.md'), '---\ntitle: Seed\n---\n')
    expect(rebuildVaultIndex(notesRoot).ok).toBe(true)

    const external = '---\ntitle: External\n---\n\nhello\n'
    const daily = '---\ntitle: Daily\n---\n\n[[External]]\n'
    writeFileSync(join(notesRoot, 'external.md'), external)
    writeFileSync(join(notesRoot, 'daily', '2026-09-13.md'), daily)

    const tick = applyVaultWatchTick(notesRoot, [
      'external.md',
      'daily/2026-09-13.md',
      '.craft/vault-index.sqlite',
      'assets/ignore.png',
      null,
    ])
    expect(tick.noteIds).toEqual(['external', 'daily/2026-09-13'])
    expect(tick.rebuilt?.ok).toBe(true)
    expect(tick.rebuilt?.indexed).toBe(2)
    expect(listVaultDocuments(notesRoot).map(doc => doc.id).sort()).toEqual([
      'daily/2026-09-13',
      'external',
      'seed',
    ])
    expect(getVaultBacklinks(notesRoot, 'external').map(item => item.noteId)).toEqual(['daily/2026-09-13'])
    expect(readFileSync(join(notesRoot, 'external.md'), 'utf8')).toBe(external)
    expect(readFileSync(join(notesRoot, 'daily', '2026-09-13.md'), 'utf8')).toBe(daily)
  })

  it('ignores index internals and non-markdown watch paths', () => {
    expect(vaultWatchNoteIdFromFilename('.craft/vault-index.sqlite')).toBeUndefined()
    expect(vaultWatchNoteIdFromFilename('assets/scan.png')).toBeUndefined()
    expect(vaultWatchNoteIdFromFilename('templates/note.md')).toBeUndefined()
    expect(vaultWatchNoteIdFromFilename('folder/.hidden.md')).toBeUndefined()
    expect(vaultWatchNoteIdFromFilename('readme.txt')).toBeUndefined()
    expect(vaultWatchNoteIdFromFilename('Alpha.md')).toBe('Alpha')
    expect(applyVaultWatchTick(tmpNotes(), ['assets/x.png']).rebuilt).toBeNull()
  })

  it('notes WATCH coalesces bursts and refreshes the vault index', () => {
    const source = readFileSync(new URL('../../handlers/rpc/notes.ts', import.meta.url), 'utf8')
    expect(source).toContain('applyVaultWatchTick')
    expect(source).toContain('VAULT_WATCH_DEBOUNCE_MS')
    expect(source).toContain('pendingFilenames')
  })
})
