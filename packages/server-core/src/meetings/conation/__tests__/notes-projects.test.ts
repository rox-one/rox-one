import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { isLiveVerified } from '../../types.ts'
import {
  createNotesProjectsStore,
  getNote,
  renameNote,
  replayImport,
  type NoteRecord,
} from '../notes-projects.ts'

const page2: NoteRecord = {
  id: 'note-page-2',
  title: 'Second page',
  revision: '1',
  page: 2,
  origin: 'native',
}

describe('notes-projects (#377)', () => {
  it('reads a note that lives on page 2 by stable id', () => {
    const store = createNotesProjectsStore([page2])
    const result = getNote(store, 'note-page-2')
    expect(result.status).toBe('pending')
    expect(result.status).not.toBe('verified')
    expect(result.reason).toBe('read')
    expect(result.live).toBe(false)
    expect(isLiveVerified(result)).toBe(false)
    expect(result.payload?.page).toBe(2)
    expect(result.payload?.id).toBe('note-page-2')
  })

  it('renames native notes without changing id', () => {
    const store = createNotesProjectsStore([page2])
    const renamed = renameNote(store, 'note-page-2', 'Renamed', '1')
    expect(renamed.status).toBe('pending')
    expect(renamed.status).not.toBe('verified')
    expect(renamed.reason).toBe('renamed')
    expect(renamed.live).toBe(false)
    expect(isLiveVerified(renamed)).toBe(false)
    expect(renamed.payload?.id).toBe('note-page-2')
    expect(renamed.payload?.title).toBe('Renamed')
  })

  it('blocks unconfirmed Conation writes and denied ids', () => {
    const store = createNotesProjectsStore([{ ...page2, id: 'c1', origin: 'conation' }])
    expect(renameNote(store, 'c1', 'Nope', '1').status).toBe('blocked')
    store.deniedIds.add('note-page-2')
    store.notes.set('note-page-2', page2)
    expect(getNote(store, 'note-page-2').reason).toBe('denied')
  })

  it('marks offline cache stale', () => {
    const store = createNotesProjectsStore([page2])
    store.offline = true
    expect(getNote(store, 'note-page-2').reason).toBe('offline-stale')
    expect(getNote(store, 'note-page-2').payload?.stale).toBe(true)
    expect(getNote(store, 'note-page-2').status).toBe('pending')
    expect(getNote(store, 'note-page-2').live).toBe(false)
  })

  it('returns conflict on stale revision and ignores replay imports', () => {
    const store = createNotesProjectsStore([page2])
    expect(renameNote(store, 'note-page-2', 'X', '0').reason).toBe('conflicting-edit')
    expect(replayImport(store, page2).status).toBe('duplicate')
    const imported = replayImport(store, { ...page2, id: 'note-imported' })
    expect(imported.status).toBe('pending')
    expect(imported.status).not.toBe('verified')
    expect(imported.reason).toBe('imported')
    expect(imported.live).toBe(false)
    expect(isLiveVerified(imported)).toBe(false)
  })

  it('does not stamp verified / live:true / L4 on native Notes/Projects stubs', () => {
    const src = readFileSync(new URL('../notes-projects.ts', import.meta.url), 'utf8')
    expect(src).not.toMatch(/status:\s*'verified'/)
    expect(src).not.toMatch(/live:\s*true/)
    expect(src).not.toMatch(/evidenceLevel:\s*'L4'/)

    const store = createNotesProjectsStore([page2])
    for (const result of [
      getNote(store, 'note-page-2'),
      renameNote(store, 'note-page-2', 'Renamed', '1'),
      replayImport(store, { ...page2, id: 'note-fresh' }),
    ]) {
      expect(result.status).not.toBe('verified')
      expect(result.live).toBe(false)
      expect(result.evidenceLevel).not.toBe('L4')
      expect(isLiveVerified(result)).toBe(false)
    }
  })

  it('does not stamp verified when importing an unconfirmed Conation note', () => {
    const store = createNotesProjectsStore()
    const incoming: NoteRecord = {
      id: 'c-import',
      title: 'Remote note',
      revision: '1',
      page: 1,
      origin: 'conation',
    }
    const result = replayImport(store, incoming)
    expect(result.status).not.toBe('verified')
    expect(result.reason).not.toBe('imported')
    expect(result.status).toBe('blocked')
    expect(result.reason).toBe('unconfirmed-write')
    expect(result.live).toBe(false)
    expect(result.evidenceLevel).toBe('U1')
    expect(isLiveVerified(result)).toBe(false)
    expect(store.notes.has('c-import')).toBe(false)
    expect(store.notes.size).toBe(0)
  })

  it('does not mutate the store when a duplicate Conation import is still unconfirmed', () => {
    const existing: NoteRecord = {
      id: 'c1',
      title: 'Kept',
      revision: '1',
      page: 1,
      origin: 'conation',
    }
    const store = createNotesProjectsStore([existing])
    const result = replayImport(store, { ...existing, title: 'Clobber', revision: '2' })
    expect(result.status).toBe('blocked')
    expect(result.reason).toBe('unconfirmed-write')
    expect(result.status).not.toBe('duplicate')
    expect(result.status).not.toBe('verified')
    expect(result.live).toBe(false)
    expect(isLiveVerified(result)).toBe(false)
    expect(store.notes.get('c1')?.title).toBe('Kept')
    expect(store.notes.get('c1')?.revision).toBe('1')
    expect(store.notes.size).toBe(1)
  })
})
