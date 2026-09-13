import { describe, expect, it } from 'bun:test'
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
    expect(replayImport(store, page2).status).toBe('duplicate')
  })
})
