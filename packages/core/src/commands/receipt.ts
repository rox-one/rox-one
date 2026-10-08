/**
 * W1-03 (#1500) — Command receipt (TECH-SPEC §3.4).
 *
 * A receipt is the only answer to a command. `applied` receipts are stored in
 * `command_receipt` so a replay of the same idempotency key returns
 * `duplicate` with the original receipt and causes no second effect.
 */

import type { EntityRef } from '../entities/refs.ts'
import type { CommandErrorCode } from './errors.ts'

export const COMMAND_RECEIPT_STATUSES = ['applied', 'duplicate', 'conflict', 'rejected', 'queued'] as const
export type CommandReceiptStatus = (typeof COMMAND_RECEIPT_STATUSES)[number]

export interface CommandReceiptError {
  code: CommandErrorCode
  message: string
  details?: Record<string, unknown>
}

export interface CommandReceipt {
  commandId: string
  status: CommandReceiptStatus
  /** Ref of the created / changed entity. */
  ref?: EntityRef
  /** Aggregate revision after the command. */
  revision?: number
  /** `domain_event` ids written in the command transaction. */
  eventIds?: string[]
  /** Handler-specific result (e.g. created ids). JSON only. */
  result?: unknown
  conflict?: { currentRevision: number; current?: unknown }
  error?: CommandReceiptError
  /** For `duplicate`: the receipt stored when the command was first applied. */
  original?: CommandReceipt
  /** For `queued`: the command waits in the client outbox for the workspace authority. */
  queuedAt?: string
}

export function rejectedReceipt(commandId: string, code: CommandErrorCode, message?: string, details?: Record<string, unknown>): CommandReceipt {
  const error: CommandReceiptError = { code, message: message ?? code }
  if (details) error.details = details
  return { commandId, status: 'rejected', error }
}

export function conflictReceipt(commandId: string, currentRevision: number, current?: unknown): CommandReceipt {
  return current === undefined
    ? { commandId, status: 'conflict', conflict: { currentRevision } }
    : { commandId, status: 'conflict', conflict: { currentRevision, current } }
}

/** A replay answer: carries the original effect fields so clients can treat it like `applied`. */
export function duplicateReceipt(original: CommandReceipt): CommandReceipt {
  const receipt: CommandReceipt = { commandId: original.commandId, status: 'duplicate', original }
  if (original.ref) receipt.ref = original.ref
  if (original.revision !== undefined) receipt.revision = original.revision
  if (original.eventIds) receipt.eventIds = original.eventIds
  if (original.result !== undefined) receipt.result = original.result
  return receipt
}

export function queuedReceipt(commandId: string, queuedAt: string): CommandReceipt {
  return { commandId, status: 'queued', queuedAt }
}

/** Terminal = the command will never change state again (no retry can apply it). */
export function isTerminalReceipt(receipt: CommandReceipt): boolean {
  return receipt.status !== 'queued'
}

/** Whether the receipt confirms the effect exists (first application or replay). */
export function isEffectiveReceipt(receipt: CommandReceipt): boolean {
  return receipt.status === 'applied' || receipt.status === 'duplicate'
}
