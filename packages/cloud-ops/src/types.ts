/**
 * Rox Cloud — operations safety primitives.
 *
 * Two independent guards stand in front of every staff action on Rox Cloud:
 * an append-only audit trail (`audit.ts`) and a two-person kill switch
 * (`kill-switch.ts`). This file holds the shapes they share and the single
 * rejection type both throw.
 */

/** Stable machine-readable reasons an operations call is rejected. */
export type OpsErrorCode =
  | 'invalid_input'
  | 'secret_in_audit'
  | 'second_person_required'
  | 'not_found'
  | 'invalid_state';

/** Rejection from the operations guards; `code` is what callers branch on. */
export class OpsError extends Error {
  readonly code: OpsErrorCode;

  constructor(code: OpsErrorCode, message: string) {
    super(message);
    this.name = 'OpsError';
    this.code = code;
  }
}

// ============================================================
// Audit trail
// ============================================================

/** Every staff action the audit trail records. */
export type AuditAction =
  | 'sandbox.create'
  | 'sandbox.delete'
  | 'sandbox.stop'
  | 'sandbox.extend'
  | 'credit.grant'
  | 'impersonate.start'
  | 'killswitch.set'
  | 'killswitch.approve';

/** What a staff member did, to what, and why. */
export interface AuditInput {
  /** Staff member who performed the action. */
  actorId: string;
  action: AuditAction;
  /** Kind of the touched object, e.g. `sandbox`, `credit`, `account`. */
  targetType: string;
  /** Id of the touched object. */
  targetId: string;
  /** Free-text justification; an empty one is rejected. */
  reason: string;
  /** Support ticket the action belongs to. */
  ticket?: string;
  /** Extra structured context; never secret material. */
  details?: Record<string, unknown>;
}

/** Stored entry: the input plus identity, time and chain links. */
export interface AuditEntry extends AuditInput {
  id: string;
  /** ISO-8601 instant the entry was appended. */
  at: string;
  /** Hash of the previous entry; `GENESIS_HASH` for the first one. */
  prevHash: string;
  /**
   * SHA-256 hex over the canonical JSON of every other field, `prevHash`
   * included — so an edit, removal or reorder breaks the chain.
   */
  hash: string;
}

// ============================================================
// Kill switch
// ============================================================

/** Providers whose work the kill switch can stop. */
export type KillProvider = 'daytona' | 'modal' | 'e2b';

/**
 * What a kill request covers. Every field left out is wildcard, so `{}`
 * blocks all new work and `{ provider: 'daytona' }` blocks Daytona in every
 * region and product.
 */
export interface KillScope {
  provider?: KillProvider;
  region?: string;
  product?: string;
}

/** Lifecycle of one kill request. */
export type KillState = 'pending' | 'active' | 'disabled';

/** One kill request as staff see it. */
export interface KillRequest {
  id: string;
  scope: KillScope;
  /** true asks to block matching work; false records that the switch stays open. */
  enabled: boolean;
  /** Why the switch was flipped. */
  reason: string;
  /** Staff member who requested it. */
  by: string;
  /** Staff member who approved it; must differ from `by`. */
  approvedBy?: string;
  /** ISO-8601 instant of the request. */
  at: string;
  state: KillState;
}
