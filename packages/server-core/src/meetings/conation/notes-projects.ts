/**
 * RMA-I021 / #377 — Conation Notes/Projects identity.
 * One EntityId. Unconfirmed writes stay BLOCKED. Offline cache is stale.
 * In-memory Maps are not a live Notes/Projects receipt: stamps stay pending
 * (live:false, not verified; L4 remains not_run).
 */

import { confirmWrite } from './capabilities.ts'
import { blocked, denied, type EvidenceLevel, type MeetingOpResult } from '../types.ts'

/** Local native identity only. Never a live/L4 verified receipt. */
function localApplied<T extends string, P = unknown>(
  reason: T,
  evidenceLevel: EvidenceLevel = 'C2',
  payload?: P,
): MeetingOpResult<T, P> {
  return payload === undefined
    ? { status: 'pending', reason, live: false, evidenceLevel }
    : { status: 'pending', reason, live: false, evidenceLevel, payload }
}

export type NoteRecord = {
  readonly id: string
  readonly title: string
  readonly revision: string
  readonly page: number
  readonly origin: 'native' | 'conation'
  readonly stale?: boolean
}

export type NotesProjectsStore = {
  notes: Map<string, NoteRecord>
  deniedIds: Set<string>
  offline: boolean
}

export function createNotesProjectsStore(notes: readonly NoteRecord[] = []): NotesProjectsStore {
  return {
    notes: new Map(notes.map((note) => [note.id, note])),
    deniedIds: new Set(),
    offline: false,
  }
}

export function getNote(store: NotesProjectsStore, id: string): MeetingOpResult<string, NoteRecord> {
  if (store.deniedIds.has(id)) return denied('denied')
  const note = store.notes.get(id)
  if (!note) return { status: 'unsupported', reason: 'not_found', live: false, evidenceLevel: 'U1' }
  if (store.offline) {
    return {
      status: 'pending',
      reason: 'offline-stale',
      live: false,
      evidenceLevel: 'C2',
      payload: { ...note, stale: true },
    }
  }
  return localApplied('read', 'C2', note)
}

export function renameNote(
  store: NotesProjectsStore,
  id: string,
  title: string,
  baseRevision: string,
): MeetingOpResult<string, NoteRecord> {
  const existing = store.notes.get(id)
  if (!existing) return denied('not_found')
  if (store.deniedIds.has(id)) return denied('denied')
  if (existing.origin === 'conation') {
    const write = confirmWrite({
      moduleId: 'GraphqlSoupDocument',
      operation: 'edit',
      authPresent: true,
    })
    if (!write.allowed) return blocked('unconfirmed-write')
  }
  if (existing.revision !== baseRevision) {
    return { status: 'conflict', reason: 'conflicting-edit', live: false, evidenceLevel: 'C2' }
  }
  const next = { ...existing, title, revision: String(Number(existing.revision) + 1) }
  store.notes.set(id, next)
  return localApplied('renamed', 'C2', next)
}

export function replayImport(store: NotesProjectsStore, note: NoteRecord): MeetingOpResult {
  if (store.notes.has(note.id)) {
    return { status: 'duplicate', reason: 'replay-import', live: false, evidenceLevel: 'C2', payload: store.notes.get(note.id) }
  }
  store.notes.set(note.id, note)
  return localApplied('imported')
}
