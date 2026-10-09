/**
 * W1-06 (#1503) — Reference-handler backend contract.
 *
 * Reference handlers are thin, CRUD-level handlers for every catalogue
 * command (PLAN §1 "Reference handlers"); wave-2 packages replace them. They
 * write through a `RecordBackend` chosen from the executor's transaction
 * handle: in-memory, local (`{workspaceRoot}/work/` + the PersonalTask v3
 * store + the W1-02 link store) or Postgres (W1-05 tables).
 */

import type { DomainEventDraft } from '@rox/core/events'

export type RecordData = Record<string, unknown>

export interface StoredRecord {
  id: string
  revision: number
  data: RecordData
}

export interface RecordWrite {
  collection: string
  id: string
  /** Revision the write replaces (`null` = insert). */
  expectedRevision: number | null
  data: RecordData
}

export interface RecordBackend {
  readonly name: 'memory' | 'local' | 'postgres'
  get(collection: string, id: string): Promise<StoredRecord | null>
  /** CAS write; returns the new revision, or `conflict` with the current record. */
  put(write: RecordWrite): Promise<{ status: 'accepted'; revision: number } | { status: 'conflict'; current: StoredRecord | null }>
  /** Hard delete of an association row. */
  remove(collection: string, id: string): Promise<boolean>
  /** Extra events the backend needs committed with the receipt (Postgres snapshots). */
  drainEvents?(): DomainEventDraft[]
}
