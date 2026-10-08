/**
 * W1-03 (#1500) — Command bus error vocabulary.
 *
 * TECH-SPEC §3.4 lists the receipt error codes FORBIDDEN, NOT_FOUND,
 * VALIDATION, AUTHORITY_MOVED, FENCE_MISMATCH and SERVER_REQUIRED. The bus
 * adds the codes it needs to report its own negative paths (unknown command,
 * unbound handler, oversized payload, idempotency-key reuse, …). The list is
 * additive only after `contracts-v1` (PLAN §1.2).
 */

export const COMMAND_ERROR_CODES = [
  // TECH-SPEC §3.4
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION',
  'AUTHORITY_MOVED',
  'FENCE_MISMATCH',
  'SERVER_REQUIRED',
  // W1-03 bus codes
  /** The command type is not defined in the registry. */
  'UNKNOWN_COMMAND',
  /** Defined, but no handler is bound yet (capability `not_bound`). */
  'NOT_BOUND',
  /** Defined and bound, but its owner module flag (or the bus) is off. */
  'UNAVAILABLE',
  /** The serialised payload exceeds the definition's byte budget. */
  'PAYLOAD_TOO_LARGE',
  /** The same idempotency key / command id was reused for a different request. */
  'IDEMPOTENCY_KEY_REUSED',
  /** A `local`-authority command was sent to the workspace authority. */
  'LOCAL_ONLY',
  /** The handler failed unexpectedly; no effect was committed. */
  'INTERNAL',
] as const

export type CommandErrorCode = (typeof COMMAND_ERROR_CODES)[number]

export function isCommandErrorCode(value: unknown): value is CommandErrorCode {
  return typeof value === 'string' && (COMMAND_ERROR_CODES as readonly string[]).includes(value)
}

/** A rejection raised inside the pipeline or a handler; becomes a `rejected` receipt. */
export class CommandRejection extends Error {
  readonly code: CommandErrorCode
  readonly details?: Record<string, unknown>

  constructor(code: CommandErrorCode, message?: string, details?: Record<string, unknown>) {
    super(message ?? code)
    this.name = 'CommandRejection'
    this.code = code
    if (details) this.details = details
  }
}

/**
 * An `expectedRevision` precondition failed. Handlers throw it (or call
 * `ctx.conflict()`); the executor turns it into a `conflict` receipt and
 * commits nothing.
 */
export class CommandConflict extends Error {
  readonly currentRevision: number
  readonly current?: unknown

  constructor(currentRevision: number, current?: unknown, message = 'Revision conflict') {
    super(message)
    this.name = 'CommandConflict'
    this.currentRevision = currentRevision
    if (current !== undefined) this.current = current
  }
}
