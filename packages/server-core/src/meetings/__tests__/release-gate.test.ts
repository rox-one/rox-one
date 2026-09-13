import { describe, expect, it } from 'bun:test'
import {
  evaluateReleaseGate,
  fixtureIsNotLive,
  MEETING_AGENTS_GATE_CASES,
  type ReleaseCase,
} from '../release-gate.ts'

describe('meeting-agents release gate (#390)', () => {
  it('blocks rollout when any required case is blocked/failed/not_run', () => {
    const report = evaluateReleaseGate({
      sha: 'deadbeef',
      cases: MEETING_AGENTS_GATE_CASES,
      killSwitch: false,
    })
    expect(report.ready).toBe(false)
    expect(report.blockers).toContain('i024-mail-live')
    expect(report.blockers).toContain('i025-crm-live')
    expect(report.blockers).toContain('i026-calendar-live')
    expect(report.blockers).toContain('i033-rooms')
    expect(report.blockers).toContain('m0-native-task-note')
  })

  it('canonical Mail/CRM/Calendar/rooms rows are blocked or not_run and not live', () => {
    const honest = MEETING_AGENTS_GATE_CASES.filter((row) =>
      row.issue === 380 || row.issue === 381 || row.issue === 382 || row.issue === 389,
    )
    expect(honest).toHaveLength(4)
    for (const row of honest) {
      expect(row.live).toBe(false)
      expect(['blocked', 'not_run']).toContain(row.status)
    }
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

  it('fails the gate when #380/#381/#382/#389 claim live:true even at L4', () => {
    const claims: ReleaseCase[] = [
      {
        id: 'i024-mail-live',
        issue: 380,
        milestone: 'M2',
        evidenceLevel: 'L4',
        status: 'passed',
        live: true,
        notes: 'claimed live Mail Conation',
      },
      {
        id: 'i025-crm-live',
        issue: 381,
        milestone: 'M2',
        evidenceLevel: 'L4',
        status: 'passed',
        live: true,
        notes: 'claimed live CRM Conation',
      },
      {
        id: 'i026-calendar-live',
        issue: 382,
        milestone: 'M2',
        evidenceLevel: 'L4',
        status: 'passed',
        live: true,
        notes: 'claimed live Calendar Conation',
      },
      {
        id: 'i033-rooms',
        issue: 389,
        milestone: 'M3',
        evidenceLevel: 'L4',
        status: 'passed',
        live: true,
        notes: 'claimed live rooms / SFU',
      },
    ]
    const report = evaluateReleaseGate({ sha: 'deadbeef', cases: claims, killSwitch: false })
    expect(report.ready).toBe(false)
    expect(report.blockers).toEqual([
      'i024-mail-live',
      'i025-crm-live',
      'i026-calendar-live',
      'i033-rooms',
    ])
  })
})
