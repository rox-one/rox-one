import { describe, expect, it } from 'bun:test'
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
    expect(result.payload?.page).toBe(2)
    expect(result.payload?.id).toBe('note-page-2')
  })

  it('renames native notes without changing id', () => {
    const store = createNotesProjectsStore([page2])
    const renamed = renameNote(store, 'note-page-2', 'Renamed', '1')
    expect(renamed.status).toBe('verified')
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
  })

  it('returns conflict on stale revision and ignores replay imports', () => {
    const store = createNotesProjectsStore([page2])
    expect(renameNote(store, 'note-page-2', 'X', '0').reason).toBe('conflicting-edit')
    const replay = replayImport(store, page2)
    expect(replay.status).toBe('duplicate')
    expect(replay.reason).toBe('replay-import')
    expect(replay.status).not.toBe('verified')
  })

  it('still imports a first-time native note while native replay stays duplicate', () => {
    const store = createNotesProjectsStore([page2])
    expect(replayImport(store, page2).status).toBe('duplicate')
    const fresh: NoteRecord = { ...page2, id: 'note-page-3', title: 'Third', page: 3 }
    const imported = replayImport(store, fresh)
    expect(imported.status).toBe('verified')
    expect(imported.reason).toBe('imported')
    expect(imported.live).toBe(false)
    expect(store.notes.get('note-page-3')?.title).toBe('Third')
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
    // Main's fake path returned verified + mutated the store without confirmWrite.
    expect(result.status).not.toBe('verified')
    expect(result.reason).not.toBe('imported')
    expect(result.status).toBe('blocked')
    expect(result.reason).toBe('unconfirmed-write')
    expect(result.live).toBe(false)
    expect(result.evidenceLevel).toBe('U1')
    expect(result.evidenceLevel).not.toBe('L4')
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
