/**
 * Local NoteRepository over EntityRef/ExternalBinding (issue #324).
 * Conation is an injected origin, never inferred from a local write.
 * This is not a second Notes UI.
 *
 * Identity is workspaceId+entityId. Rename and revision bumps do not mint a
 * new EntityId (issue #371 / I015).
 */

import { formatRox2EntityRef, type Rox2EntityRef, type Rox2ExternalBinding } from './platform-contract.ts'
import { Rox2RevisionConflict } from './identity.ts'

export type NoteOrigin = 'local' | 'conation'
export type NoteSyncState = 'local-only' | 'live' | 'cached' | 'offline' | 'denied'
export type NoteAudience = 'private' | 'shared'

export type Rox2Note = {
  ref: Rox2EntityRef
  title: string
  body: string
  origin: NoteOrigin
  syncState: NoteSyncState
  binding?: Rox2ExternalBinding
  properties?: Record<string, unknown>
  audience?: NoteAudience
}

export type Rox2NoteRecord = Rox2Note & {
  updatedAt: number
}

export function noteOriginIsConation(note: Pick<Rox2Note, 'origin'>): boolean {
  return note.origin === 'conation'
}

export function noteIdentityKey(ref: Pick<Rox2EntityRef, 'workspaceId' | 'entityId'>): string {
  return `note:${ref.workspaceId}:${ref.entityId}`
}

export function bumpNoteRevision(revisionId: string): string {
  const n = Number(revisionId)
  if (Number.isInteger(n) && n >= 0) return String(n + 1)
  return `${revisionId}.1`
}

function revisionNumber(revisionId: string): number {
  const n = Number(revisionId)
  return Number.isFinite(n) ? n : 0
}

export class Rox2NoteRepository {
  private notes = new Map<string, Rox2NoteRecord>()

  createLocal(input: {
    ref: Rox2EntityRef
    title: string
    body: string
    now?: number
    properties?: Record<string, unknown>
    audience?: NoteAudience
  }): Rox2NoteRecord {
    const record: Rox2NoteRecord = {
      ref: input.ref,
      title: input.title,
      body: input.body,
      origin: 'local',
      syncState: 'local-only',
      updatedAt: input.now ?? Date.now(),
      properties: { ...(input.properties ?? {}) },
      audience: input.audience ?? 'shared',
    }
    this.notes.set(noteIdentityKey(input.ref), record)
    return structuredClone(record)
  }

  cacheRemote(input: {
    ref: Rox2EntityRef
    title: string
    body: string
    binding: Rox2ExternalBinding
    syncState: Exclude<NoteSyncState, 'local-only'>
    now?: number
    properties?: Record<string, unknown>
    audience?: NoteAudience
  }): Rox2NoteRecord {
    const record: Rox2NoteRecord = {
      ref: input.ref,
      title: input.title,
      body: input.body,
      origin: 'conation',
      syncState: input.syncState,
      binding: input.binding,
      updatedAt: input.now ?? Date.now(),
      properties: { ...(input.properties ?? {}) },
      audience: input.audience ?? 'shared',
    }
    this.notes.set(noteIdentityKey(input.ref), record)
    return structuredClone(record)
  }

  get(ref: Rox2EntityRef): Rox2NoteRecord | undefined {
    const found = this.notes.get(noteIdentityKey(ref)) ?? this.notes.get(formatRox2EntityRef('note', ref))
    return found ? structuredClone(found) : undefined
  }

  getByEntityId(workspaceId: string, entityId: string): Rox2NoteRecord | undefined {
    const found = this.notes.get(noteIdentityKey({ workspaceId, entityId }))
    return found ? structuredClone(found) : undefined
  }

  list(): Rox2NoteRecord[] {
    return [...this.notes.values()].map((note) => structuredClone(note))
  }

  rename(ref: Rox2EntityRef, title: string, expectedRevision?: string, now?: number): Rox2NoteRecord {
    return this.write(ref, { title }, expectedRevision, now)
  }

  update(
    ref: Rox2EntityRef,
    patch: { title?: string; body?: string; properties?: Record<string, unknown>; audience?: NoteAudience },
    expectedRevision?: string,
    now?: number,
  ): Rox2NoteRecord {
    return this.write(ref, patch, expectedRevision, now)
  }

  restore(records: readonly Rox2NoteRecord[]): void {
    this.notes.clear()
    for (const note of records) {
      this.notes.set(noteIdentityKey(note.ref), structuredClone(note))
    }
  }

  private write(
    ref: Rox2EntityRef,
    patch: { title?: string; body?: string; properties?: Record<string, unknown>; audience?: NoteAudience },
    expectedRevision?: string,
    now?: number,
  ): Rox2NoteRecord {
    const key = noteIdentityKey(ref)
    const existing = this.notes.get(key)
    if (!existing) throw new Error(`Unknown note ${key}`)
    if (expectedRevision != null && existing.ref.revisionId !== expectedRevision) {
      throw new Rox2RevisionConflict(revisionNumber(expectedRevision), revisionNumber(existing.ref.revisionId))
    }
    const next: Rox2NoteRecord = {
      ...existing,
      title: patch.title ?? existing.title,
      body: patch.body ?? existing.body,
      audience: patch.audience ?? existing.audience,
      properties: patch.properties
        ? { ...(existing.properties ?? {}), ...patch.properties }
        : { ...(existing.properties ?? {}) },
      ref: { ...existing.ref, revisionId: bumpNoteRevision(existing.ref.revisionId) },
      updatedAt: now ?? Date.now(),
    }
    this.notes.set(key, next)
    return structuredClone(next)
  }
}
