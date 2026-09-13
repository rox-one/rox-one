import { describe, expect, it } from 'bun:test'
import {
  evaluateReleaseGate,
  fixtureIsNotLive,
  MEETING_AGENTS_GATE_CASES,
  type ReleaseCase,
} from '../release-gate.ts'

describe('meeting-agents release gate (#390)', () => {
  it('blocks rollout when any required case is blocked/failed/not_run', () => {
    const cases: ReleaseCase[] = MEETING_AGENTS_GATE_CASES.map((row) => ({
      ...row,
      status: row.id.includes('live') || row.id === 'i033-rooms' || row.id === 'm0-native-task-note'
        ? 'blocked'
        : 'passed',
      live: false,
    }))
    const report = evaluateReleaseGate({ sha: 'deadbeef', cases, killSwitch: false })
    expect(report.ready).toBe(false)
    expect(report.blockers).toContain('i024-mail-live')
    expect(report.blockers).toContain('i025-crm-live')
    expect(report.blockers).toContain('i026-calendar-live')
  })

  it('kill switch stops new effects', () => {
    const report = evaluateReleaseGate({ sha: 'deadbeef', cases: [], killSwitch: true })
    expect(report.ready).toBe(false)
    expect(report.blockers).toEqual(['kill-switch'])
  })

  it('does not treat fixtures as live', () => {
    expect(
      fixtureIsNotLive({
        id: 'fx',
        issue: 373,
        milestone: 'M1',
        evidenceLevel: 'U1',
        status: 'passed',
        live: false,
        notes: 'fixture adapter',
      }),
    ).toBe(true)
  })
})
