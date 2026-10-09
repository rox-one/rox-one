/**
 * W1-14 (#1511) — Storage ledger (TECH-SPEC §16.3, DATA-MODEL §5.15).
 *
 * `drive.used_bytes = Σ storage_ledger.delta_bytes`, maintained in the same
 * transaction as each ledger insert. The `reason` vocabulary is the DDL's, and
 * it is what makes the charge rules of D-v2-8 auditable: every version, every
 * trashed file and every chat attachment is one row with a reason.
 *
 * `trash` and `restore` are **informational** (`delta_bytes = 0`): the bytes
 * never left `used_bytes`, they moved into `trash_bytes`. Only `purge` debits.
 */

import type { EntityRef } from '../entities/refs.ts'

export const STORAGE_LEDGER_REASONS = [
  'upload',
  'version',
  'copy',
  'artifact',
  'recording',
  'trash',
  'restore',
  'purge',
  'transfer_in',
  'transfer_out',
  'adjust',
] as const

export type StorageLedgerReason = (typeof STORAGE_LEDGER_REASONS)[number]

export function isStorageLedgerReason(value: unknown): value is StorageLedgerReason {
  return typeof value === 'string' && (STORAGE_LEDGER_REASONS as readonly string[]).includes(value)
}

/** `storage_ledger` row (`16-drive-quota.sql`). */
export interface StorageLedgerEntry {
  entryId: string
  driveId: string
  deltaBytes: number
  reason: StorageLedgerReason
  fileId?: string
  versionNo?: number
  /** Unique per effect: a retried command never writes a second entry. */
  idempotencyKey: string
  createdAt: string
}

/** The three counters of a `drive` row. */
export interface DriveCounters {
  usedBytes: number
  reservedBytes: number
  trashBytes: number
}

/**
 * `delta_bytes` of a ledger entry. Charges are positive, `purge` /
 * `transfer_out` negative, `trash` / `restore` zero (informational), and
 * `adjust` uses the explicitly audited delta of the reconciler.
 */
export function ledgerDeltaBytes(reason: StorageLedgerReason, sizeBytes: number, adjustDelta?: number): number {
  switch (reason) {
    case 'upload':
    case 'version':
    case 'copy':
    case 'artifact':
    case 'recording':
    case 'transfer_in':
      return Math.abs(sizeBytes)
    case 'purge':
    case 'transfer_out':
      return -Math.abs(sizeBytes)
    case 'trash':
    case 'restore':
      return 0
    case 'adjust':
      return adjustDelta ?? 0
  }
}

/** `used_bytes` recomputed from the ledger — the reconciler's side of §16.3. */
export function usedBytesFromLedger(entries: readonly Pick<StorageLedgerEntry, 'deltaBytes'>[]): number {
  return entries.reduce((total, entry) => total + entry.deltaBytes, 0)
}

/**
 * The counters after one entry. `sizeBytes` is the size of the file the entry
 * is about; it moves `trash_bytes` for the informational reasons.
 */
export function applyLedgerEntry(counters: DriveCounters, reason: StorageLedgerReason, sizeBytes: number, adjustDelta?: number): DriveCounters {
  const delta = ledgerDeltaBytes(reason, sizeBytes, adjustDelta)
  const trashDelta = reason === 'trash' ? Math.abs(sizeBytes) : reason === 'restore' || reason === 'purge' ? -Math.abs(sizeBytes) : 0
  return {
    usedBytes: Math.max(0, counters.usedBytes + delta),
    reservedBytes: Math.max(0, counters.reservedBytes),
    trashBytes: Math.max(0, counters.trashBytes + trashDelta),
  }
}

/** Where a stored file came from (`file_object.source_ref`, DATA-MODEL §5.15). */
export type FileSource =
  | { kind: 'upload' }
  | { kind: 'session'; sessionRef: string }
  | { kind: 'channel-message'; chatId: string; seq: number }
  | { kind: 'note'; noteId: string }
  | { kind: 'call'; callId: string }
  | { kind: 'copy'; from: EntityRef }

/** `file_object.source_ref` string form (`session:… | channel-message:… | note:… | call:… | upload`). */
export function fileSourceRef(source: FileSource): string {
  switch (source.kind) {
    case 'upload':
      return 'upload'
    case 'session':
      return `session:${source.sessionRef}`
    case 'channel-message':
      return `channel-message:${source.chatId}#${source.seq}`
    case 'note':
      return `note:${source.noteId}`
    case 'call':
      return `call:${source.callId}`
    case 'copy':
      return `copy:${source.from.kind}:${source.from.id}`
  }
}

export interface ChargeContext {
  /** Owner of the drive the bytes are charged to by default. */
  driveOwnerId: string
  /** Who is performing the write; the uploader of a chat attachment. */
  actorId: string
  /** `file_object.source_ref`. */
  sourceRef?: string
  /** Organiser of the meeting whose recording is being stored. */
  organiserId?: string
  /** Owner of the agent whose artifact is being stored. */
  agentOwnerId?: string
}

/**
 * Who pays for these bytes (D-v2-8, DATA-MODEL §5.15):
 * - chat attachments are charged to the **uploader**, not to the chat;
 * - meeting recordings to the meeting **organiser**;
 * - agent artifacts to the agent's **owner**;
 * - everything else — versions, copies, a shared file someone else edits — to
 *   the **drive owner** (Google Drive semantics).
 */
export function chargePrincipal(reason: StorageLedgerReason, context: ChargeContext): string {
  if (context.sourceRef?.startsWith('channel-message:')) return context.actorId
  if (reason === 'recording') return context.organiserId ?? context.driveOwnerId
  if (reason === 'artifact') return context.agentOwnerId ?? context.driveOwnerId
  return context.driveOwnerId
}