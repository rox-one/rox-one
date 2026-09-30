/**
 * Shared meeting-agent result types. Fail-closed: unknown/blocked never
 * masquerade as verified live provider effects.
 */

export type EvidenceLevel = 'U1' | 'C2' | 'E3' | 'L4' | 'N5'

export type GateStatus = 'passed' | 'failed' | 'blocked' | 'not_run'

export type MeetingOpStatus =
  | 'verified'
  | 'denied'
  | 'unknown'
  | 'duplicate'
  | 'conflict'
  | 'pending'
  | 'unsupported'
  | 'blocked'

export type MeetingOpResult<TReason extends string = string, TPayload = unknown> = {
  readonly status: MeetingOpStatus
  readonly reason: TReason
  readonly live: false | true
  readonly evidenceLevel: EvidenceLevel
  readonly payload?: TPayload
}

/** A rejected/unconfirmed operation cannot carry an invented success payload. */
export type MeetingOpFailure<TReason extends string, TStatus extends 'unsupported' | 'blocked' | 'denied' | 'unknown'> =
  MeetingOpResult<TReason, never> & { readonly status: TStatus; readonly live: false }

export function unsupported<T extends string>(
  reason: T,
  evidenceLevel: EvidenceLevel = 'U1',
): MeetingOpFailure<T, 'unsupported'> {
  return { status: 'unsupported', reason, live: false, evidenceLevel }
}

export function blocked<T extends string>(
  reason: T,
  evidenceLevel: EvidenceLevel = 'U1',
): MeetingOpFailure<T, 'blocked'> {
  return { status: 'blocked', reason, live: false, evidenceLevel }
}

export function denied<T extends string>(
  reason: T,
  evidenceLevel: EvidenceLevel = 'U1',
): MeetingOpFailure<T, 'denied'> {
  return { status: 'denied', reason, live: false, evidenceLevel }
}

export function unknownEffect<T extends string>(
  reason: T,
  evidenceLevel: EvidenceLevel = 'U1',
): MeetingOpFailure<T, 'unknown'> {
  return { status: 'unknown', reason, live: false, evidenceLevel }
}

/** Fixture adapters must set live:false. HTTP 202 / type defs are not default-ready. */
export function isLiveVerified(result: MeetingOpResult): boolean {
  return result.status === 'verified' && result.live === true && result.evidenceLevel === 'L4'
}
