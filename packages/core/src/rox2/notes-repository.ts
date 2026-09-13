/**
 * Local NoteRepository over EntityRef/ExternalBinding (issue #324).
 * Conation is an injected origin, never inferred from a local write.
 * This is not a second Notes UI.
 */

import { formatRox2EntityRef, type Rox2EntityRef, type Rox2ExternalBinding } from './platform-contract.ts'

export type NoteOrigin = 'local' | 'conation'
export type NoteSyncState = 'local-only' | 'live' | 'cached' | 'offline' | 'denied'

export type Rox2Note = {
  ref: Rox2EntityRef
  title: string
  body: string
  origin: NoteOrigin
  syncState: NoteSyncState
  binding?: Rox2ExternalBinding
}

export type Rox2NoteRecord = Rox2Note & {
  updatedAt: number
}

export function noteOriginIsConation(note: Pick<Rox2Note, 'origin'>): boolean {
  return note.origin === 'conation'
}

export class Rox2NoteRepository {
  private notes = new Map<string, Rox2NoteRecord>()

  createLocal(input: { ref: Rox2EntityRef; title: string; body: string; now?: number }): Rox2NoteRecord {
    const record: Rox2NoteRecord = {
      ref: input.ref,
      title: input.title,
      body: input.body,
      origin: 'local',
      syncState: 'local-only',
      updatedAt: input.now ?? Date.now(),
    }
    this.notes.set(formatRox2EntityRef('note', input.ref), record)
    return structuredClone(record)
  }

  cacheRemote(input: {
    ref: Rox2EntityRef
    title: string
    body: string
    binding: Rox2ExternalBinding
    syncState: Exclude<NoteSyncState, 'local-only'>
    now?: number
  }): Rox2NoteRecord {
    const record: Rox2NoteRecord = {
      ref: input.ref,
      title: input.title,
      body: input.body,
      origin: 'conation',
      syncState: input.syncState,
      binding: input.binding,
      updatedAt: input.now ?? Date.now(),
    }
    this.notes.set(formatRox2EntityRef('note', input.ref), record)
    return structuredClone(record)
  }

  get(ref: Rox2EntityRef): Rox2NoteRecord | undefined {
    const found = this.notes.get(formatRox2EntityRef('note', ref))
    return found ? structuredClone(found) : undefined
  }

  list(): Rox2NoteRecord[] {
    return [...this.notes.values()].map((note) => structuredClone(note))
  }
}
