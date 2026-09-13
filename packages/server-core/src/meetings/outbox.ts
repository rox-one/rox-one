/**
 * Follow-up mail outbox. Reserve is idempotent. Dispatch is fail-closed:
 * drafts are not sends, unknown entries are not auto-resent, and nothing
 * here is a live production send (L4 remains not_run).
 */

import { blocked, unknownEffect, type MeetingOpResult } from './types.ts'

export type OutboxKind = 'draft' | 'send'

export type OutboxStatus = 'queued' | 'unknown' | 'blocked'

export type OutboxEntry = {
  operationId: string
  idempotencyKey: string
  payloadHash: string
  kind?: OutboxKind
  status?: OutboxStatus
}

export function reserveOutbox(
  existing: readonly OutboxEntry[],
  next: OutboxEntry,
): { reserved: boolean; entry: OutboxEntry } {
  const found = existing.find((item) => item.idempotencyKey === next.idempotencyKey)
  if (found) return { reserved: false, entry: found }
  return { reserved: true, entry: next }
}

export function dispatchOutbox(entry: OutboxEntry): MeetingOpResult {
  if (entry.kind === 'draft') {
    return { status: 'pending', reason: 'draft-not-send', live: false, evidenceLevel: 'U1' }
  }
  if (entry.status === 'unknown') {
    return unknownEffect('no-automatic-resend')
  }
  if (entry.status === 'blocked') {
    return { status: 'duplicate', reason: 'already-queued', live: false, evidenceLevel: 'U1' }
  }
  entry.status = 'blocked'
  return blocked('followup-send-not-live')
}
