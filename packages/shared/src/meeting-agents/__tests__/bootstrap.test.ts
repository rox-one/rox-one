import { afterEach, describe, expect, test } from 'bun:test'
import { BUILTIN_MEETING_AGENTS, BUILTIN_MEETING_AGENT_IDS } from '../catalog.ts'
import {
  emptyMeetingAgentStore,
  ensureBuiltinMeetingAgents,
  meetingBootstrapModelCalls,
  resetMeetingAgentOverrides,
  resetMeetingBootstrapModelCalls,
  setMeetingAgentEnabled,
} from '../bootstrap.ts'

const originalHealthy = process.env.ROX_MEETING_HEALTHY

afterEach(() => {
  if (originalHealthy === undefined) delete process.env.ROX_MEETING_HEALTHY
  else process.env.ROX_MEETING_HEALTHY = originalHealthy
})

describe('meeting agent bootstrap (issue 358)', () => {
  test('fresh profile installs exactly eight definitions and starts none', () => {
    const { store, readiness } = ensureBuiltinMeetingAgents('ws-1', '1.0.0', emptyMeetingAgentStore())
    expect(BUILTIN_MEETING_AGENT_IDS).toHaveLength(8)
    expect(readiness).toHaveLength(8)
    expect(readiness.every((row) => row.installed)).toBe(true)
    expect(readiness.every((row) => row.running === false)).toBe(true)
    expect(store.ledger).toHaveLength(8)
  })

  test('bootstrap twice is idempotent', () => {
    const first = ensureBuiltinMeetingAgents('ws-1', '1.0.0', emptyMeetingAgentStore())
    const second = ensureBuiltinMeetingAgents('ws-1', '1.0.0', first.store)
    expect(second.store.ledger).toHaveLength(8)
  })

  test('disable survives upgrade', () => {
    const first = ensureBuiltinMeetingAgents('ws-1', '1.0.0', emptyMeetingAgentStore())
    const disabled = setMeetingAgentEnabled(first.store, 'rox.meeting.scribe', false)
    const upgraded = ensureBuiltinMeetingAgents('ws-1', '1.1.0', disabled)
    const scribe = upgraded.readiness.find((row) => row.id === 'rox.meeting.scribe')
    expect(scribe?.enabled).toBe(false)
    expect(upgraded.store.overrides['rox.meeting.scribe']?.enabled).toBe(false)
  })

  test('env flag does not mark an unavailable route healthy', () => {
    process.env.ROX_MEETING_HEALTHY = '1'
    const { readiness } = ensureBuiltinMeetingAgents(
      'ws-1',
      '1.0.0',
      emptyMeetingAgentStore(),
      { available: false, reason: 'no-route' },
    )
    expect(readiness.every((row) => row.healthy === false)).toBe(true)
  })

  test('reset restores enabled without dropping the ledger', () => {
    const first = ensureBuiltinMeetingAgents('ws-1', '1.0.0', emptyMeetingAgentStore())
    const disabled = setMeetingAgentEnabled(first.store, 'rox.meeting.assist', false)
    const reset = resetMeetingAgentOverrides(disabled, 'rox.meeting.assist')
    const { readiness } = ensureBuiltinMeetingAgents('ws-1', '1.0.0', reset)
    const assist = readiness.find((row) => row.id === 'rox.meeting.assist')
    expect(assist?.enabled).toBe(true)
    expect(reset.ledger).toHaveLength(8)
  })

  test('expanded required scopes require authorization and never auto-grant', () => {
    const first = ensureBuiltinMeetingAgents('ws-1', '1.0.0', emptyMeetingAgentStore())
    const granted = {
      ...first.store,
      grantedCapabilities: [...(BUILTIN_MEETING_AGENTS.find((role) => role.id === 'rox.meeting.coordinator')?.allowedCapabilityIds ?? [])],
    }
    const expanded = BUILTIN_MEETING_AGENTS.map((role) => (
      role.id === 'rox.meeting.coordinator'
        ? { ...role, allowedCapabilityIds: [...role.allowedCapabilityIds, 'processing.cloud'] as const }
        : role
    ))
    const upgraded = ensureBuiltinMeetingAgents('ws-1', '1.1.0', granted, { available: true }, expanded)
    const coordinator = upgraded.readiness.find((row) => row.id === 'rox.meeting.coordinator')
    expect(coordinator?.authorizationRequired).toBe(true)
    expect(upgraded.store.grantedCapabilities).not.toContain('processing.cloud')
  })

  test('bootstrap does not issue idle model calls', () => {
    resetMeetingBootstrapModelCalls()
    ensureBuiltinMeetingAgents('ws-1', '1.0.0', emptyMeetingAgentStore())
    expect(meetingBootstrapModelCalls).toBe(0)
  })
})
