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

export function unsupported<T extends string>(
  reason: T,
  evidenceLevel: EvidenceLevel = 'U1',
): MeetingOpResult<T, never> {
  return { status: 'unsupported', reason, live: false, evidenceLevel }
}

export function blocked<T extends string>(
  reason: T,
  evidenceLevel: EvidenceLevel = 'U1',
): MeetingOpResult<T, never> {
  return { status: 'blocked', reason, live: false, evidenceLevel }
}

export function denied<T extends string>(
  reason: T,
  evidenceLevel: EvidenceLevel = 'U1',
): MeetingOpResult<T, never> {
  return { status: 'denied', reason, live: false, evidenceLevel }
}

export function unknownEffect<T extends string>(
  reason: T,
  evidenceLevel: EvidenceLevel = 'U1',
): MeetingOpResult<T, never> {
  return { status: 'unknown', reason, live: false, evidenceLevel }
}

/** Fixture adapters must set live:false. HTTP 202 / type defs are not default-ready. */
export function isLiveVerified(result: MeetingOpResult): boolean {
  return result.status === 'verified' && result.live === true && result.evidenceLevel === 'L4'
}
