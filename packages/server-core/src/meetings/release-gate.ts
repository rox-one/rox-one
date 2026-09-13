/**
 * RMA-I034 / #390 — release gates. Fixture/type/HTTP202 are not default-ready.
 * blocked/failed/not_run forbid rollout of the corresponding capability.
 * #380/#381/#382/#389 are not live (parent #356 open; SFU undecided).
 */

import type { EvidenceLevel, GateStatus } from './types.ts'

export type ReleaseCase = {
  readonly id: string
  readonly issue: number
  readonly milestone: 'M0' | 'M1' | 'M2' | 'M3'
  readonly evidenceLevel: EvidenceLevel
  readonly status: GateStatus
  readonly live: boolean
  readonly notes: string
}

export type ReleaseGateReport = {
  readonly sha: string
  readonly cases: readonly ReleaseCase[]
  readonly killSwitch: boolean
}

/** Open issues that must not be claimed live, including L4 evidence. */
const NOT_LIVE_ISSUES = new Set([380, 381, 382, 389])

export function caseBlocksRollout(row: ReleaseCase): boolean {
  if (row.status === 'failed' || row.status === 'blocked' || row.status === 'not_run') return true
  if (row.live && NOT_LIVE_ISSUES.has(row.issue)) return true
  if (row.live && row.evidenceLevel !== 'L4') return true
  return false
}

export function evaluateReleaseGate(report: ReleaseGateReport): {
  readonly ready: boolean
  readonly blockers: readonly string[]
} {
  if (report.killSwitch) {
    return { ready: false, blockers: ['kill-switch'] }
  }
  const blockers = report.cases.filter(caseBlocksRollout).map((row) => row.id)
  return { ready: blockers.length === 0, blockers }
}

export function fixtureIsNotLive(row: ReleaseCase): boolean {
  return !(row.notes.includes('fixture') && row.live)
}

export const MEETING_AGENTS_GATE_CASES: readonly ReleaseCase[] = [
  { id: 'm0-native-task-note', issue: 357, milestone: 'M0', evidenceLevel: 'N5', status: 'blocked', live: false, notes: 'parent #356 not closed by this gate' },
  { id: 'i017-tracker-stubs', issue: 373, milestone: 'M1', evidenceLevel: 'U1', status: 'passed', live: false, notes: 'fail-closed GitHub/Linear stubs' },
  { id: 'i020-conation-capabilities', issue: 376, milestone: 'M2', evidenceLevel: 'U1', status: 'passed', live: false, notes: 'AUD #333 still blocked' },
  { id: 'i024-mail-live', issue: 380, milestone: 'M2', evidenceLevel: 'L4', status: 'blocked', live: false, notes: 'live Mail Conation not claimed' },
  { id: 'i025-crm-live', issue: 381, milestone: 'M2', evidenceLevel: 'L4', status: 'blocked', live: false, notes: 'live CRM Conation not claimed' },
  { id: 'i026-calendar-live', issue: 382, milestone: 'M2', evidenceLevel: 'L4', status: 'blocked', live: false, notes: 'live Calendar Conation not claimed' },
  { id: 'i033-rooms', issue: 389, milestone: 'M3', evidenceLevel: 'N5', status: 'blocked', live: false, notes: 'SFU undecided' },
]
