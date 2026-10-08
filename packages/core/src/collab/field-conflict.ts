/**
 * W1-14 (#1511) — Field-level conflict contract (TECH-SPEC §11.6, DATA-MODEL §5.1).
 *
 * Offline edits to tasks, events, goals, projects and lists are **per-field
 * patches** carried by outbox commands with `expectedRevision`. The server
 * merges fields that did not move; a field that moved since the client's
 * revision is a conflict, and the client shows the ConflictChip (UI-SPEC §18.7).
 *
 * The revision of the whole row is not enough to decide that: two clients
 * editing different fields of the same task would collide on every write. So
 * the row stores `field_revisions` (jsonb `{field: revision}`) — the revision
 * at which **each field** last changed — and
 *
 * > A patch conflicts only if `field_revisions[f] > expectedRevision` for a
 * > field it touches.
 *
 * `CONFLICT {field, theirs, mine, revision}` is the receiving shape; a receipt
 * carries it as an error with `code: 'CONFLICT'`.
 */

import type { EntityRef } from '../entities/refs.ts'
import type { CommandReceiptError } from '../commands/receipt.ts'

/** `field_revisions` jsonb of one row. */
export type FieldRevisions = Readonly<Record<string, number>>

/** Fields of the row itself, never patchable by a client (DATA-MODEL §1). */
export const RESERVED_PATCH_FIELDS = [
  'id',
  'revision',
  'authority',
  'workspaceId',
  'createdAt',
  'updatedAt',
  'deletedAt',
  'createdBy',
  'lastCommandId',
] as const

/** The error code of a field conflict (`COMMAND_ERROR_CODES`). */
export const CONFLICT_CODE = 'CONFLICT'

export interface FieldConflict {
  field: string
  /** What the server has now. */
  theirs: unknown
  /** What the rejected patch wanted to write. */
  mine: unknown
  /** `field_revisions[field]` at rejection time. */
  revision: number
}

/** The `CONFLICT {field, theirs, mine, revision}` error of §11.6. */
export interface ConflictError {
  code: typeof CONFLICT_CODE
  message: string
  fields: FieldConflict[]
  /** The row's current revision; a re-dispatch must send it as `expectedRevision`. */
  currentRevision: number
  ref?: EntityRef
}

/** A payload that carries nothing but a partial row (a patch) or a scope marker. */
export function isFieldPatch(payload: Record<string, unknown>): boolean {
  const keys = Object.keys(payload).filter(key => key !== 'scope')
  return keys.length > 0 && keys.every(key => !(RESERVED_PATCH_FIELDS as readonly string[]).includes(key))
}

/**
 * The fields of `patch` that moved since `expectedRevision`. Empty means the
 * patch applies cleanly and every other field is merged in place.
 */
export function conflictingFields(
  patch: Record<string, unknown>,
  fieldRevisions: FieldRevisions,
  expectedRevision: number,
): string[] {
  return Object.keys(patch).filter(field => (fieldRevisions[field] ?? 0) > expectedRevision).sort()
}

/** The rejected fields, in the shape the ConflictChip renders. */
export function fieldConflicts(
  fields: readonly string[],
  patch: Record<string, unknown>,
  current: Record<string, unknown>,
  fieldRevisions: FieldRevisions,
): FieldConflict[] {
  return fields.map(field => ({
    field,
    theirs: current[field] ?? null,
    mine: patch[field] ?? null,
    revision: fieldRevisions[field] ?? 0,
  }))
}

/** Build the §11.6 error from a rejection. */
export function conflictError(fields: FieldConflict[], currentRevision: number, ref?: EntityRef): ConflictError {
  return {
    code: CONFLICT_CODE,
    message: fields.length === 1 ? `Field «${fields[0]!.field}» changed since revision ${currentRevision}` : `${fields.length} fields changed since revision ${currentRevision}`,
    fields,
    currentRevision,
    ...(ref ? { ref } : {}),
  }
}

/** The same error as a command receipt carries it. */
export function conflictReceiptError(conflict: ConflictError): CommandReceiptError {
  return {
    code: CONFLICT_CODE,
    message: conflict.message,
    details: {
      fields: conflict.fields,
      currentRevision: conflict.currentRevision,
      ...(conflict.ref ? { ref: conflict.ref } : {}),
    },
  }
}

/** Merge a patch into the current row (`undefined` leaves a field alone). */
export function applyFieldPatch(current: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const next = { ...current }
  for (const [field, value] of Object.entries(patch)) {
    if (value === undefined) continue
    if (value === null) delete next[field]
    else next[field] = value
  }
  return next
}

/** `field_revisions` after the patch landed at `revision`. */
export function nextFieldRevisions(fieldRevisions: FieldRevisions, patch: Record<string, unknown>, revision: number): Record<string, number> {
  return { ...fieldRevisions, ...Object.fromEntries(Object.keys(patch).map(field => [field, revision])) }
}

/**
 * The decision of the merge step: either the patch applies (with the fields
 * that moved on other clients untouched) or it is a `CONFLICT`.
 */
export type FieldPatchDecision =
  | { status: 'applied'; merged: Record<string, unknown> }
  | { status: 'conflict'; conflict: ConflictError }

/**
 * Apply a per-field patch under the §11.6 rule. `currentRevision` is the row
 * revision the server reads; `expectedRevision` is the one the client sent
 * (`undefined` = the client did not ask for a check, so the patch applies).
 */
export function decideFieldPatch(
  current: Record<string, unknown>,
  fieldRevisions: FieldRevisions,
  currentRevision: number,
  patch: Record<string, unknown>,
  expectedRevision: number | undefined,
  ref?: EntityRef,
): FieldPatchDecision {
  if (expectedRevision !== undefined) {
    const conflicting = conflictingFields(patch, fieldRevisions, expectedRevision)
    if (conflicting.length > 0) {
      return { status: 'conflict', conflict: conflictError(fieldConflicts(conflicting, patch, current, fieldRevisions), currentRevision, ref) }
    }
  }
  return { status: 'applied', merged: applyFieldPatch(current, patch) }
}