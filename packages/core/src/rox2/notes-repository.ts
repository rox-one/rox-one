/**
 * Unified Notes repository over Rox2 entity refs (ROX-AUD-016 / #324).
 * Native local notes never report a Conation origin. Conation rows stay
 * adapters with explicit sync state. This is not the Notes editor engine.
 */

import { formatRox2EntityId, parseRox2EntityId } from './platform-contract.ts'

export type NoteOrigin = 'native' | 'conation' | 'hybrid'
export type NoteSyncState = 'live' | 'cached' | 'stale' | 'offline' | 'denied'

export type Rox2NoteRecord = {
  entityId: string
  title: string
  body: string
  origin: NoteOrigin
  revision: string
  updatedAt: number
}

export type NoteReadResult =
  | { status: 'ok'; note: Rox2NoteRecord; sync: NoteSyncState }
  | { status: 'denied' }
  | { status: 'not_found' }
  | { status: 'unavailable'; message: string }

export type NotesRepository = {
  put(note: Rox2NoteRecord): void
  get(entityId: string, opts?: { online?: boolean; readable?: boolean }): NoteReadResult
}

export function createNotesRepository(seed: readonly Rox2NoteRecord[] = []): NotesRepository {
  const records = new Map<string, Rox2NoteRecord>()
  for (const note of seed) records.set(note.entityId, { ...note })
  return {
    put(note) {
      const { kind } = parseRox2EntityId(note.entityId)
      if (kind !== 'note') throw new Error('notes repository only stores note entities')
      records.set(note.entityId, { ...note })
    },
    get(entityId, opts) {
      const note = records.get(entityId)
      if (!note) return { status: 'not_found' }
      if (opts?.readable === false) return { status: 'denied' }
      if (opts?.online === false) {
        return { status: 'ok', note, sync: note.origin === 'native' ? 'cached' : 'stale' }
      }
      return { status: 'ok', note, sync: 'live' }
    },
  }
}

export function nativeNoteRecord(input: {
  id: string
  title: string
  body: string
  revision: string
  updatedAt: number
}): Rox2NoteRecord {
  return {
    entityId: formatRox2EntityId('note', input.id),
    title: input.title,
    body: input.body,
    origin: 'native',
    revision: input.revision,
    updatedAt: input.updatedAt,
  }
}
