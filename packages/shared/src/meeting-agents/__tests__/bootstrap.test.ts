import { describe, expect, test } from 'bun:test'
import {
  disableMeetingAgent,
  ensureBuiltinMeetingAgents,
  installedCount,
  resetMeetingAgentOverrides,
} from '../bootstrap.ts'
import { BUILTIN_MEETING_AGENT_IDS } from '../catalog.ts'

const ALL_CAPS = [
  'meeting.route',
  'meeting.budget',
  'meeting.assist',
  'meeting.screen',
  'meeting.transcript',
  'meeting.knowledge',
  'meeting.execute',
  'meeting.artifact',
  'meeting.followup',
  'meeting.analyze',
]

describe('meeting agent bootstrap (RMA-I002)', () => {
  test('fresh profile installs exactly eight definitions and zero running sessions', () => {
    const store = ensureBuiltinMeetingAgents('ws-1', '1.0.0', { grantedCapabilities: ALL_CAPS, online: true })
    expect(installedCount(store)).toBe(8)
    expect(Object.keys(store.records)).toEqual([...BUILTIN_MEETING_AGENT_IDS])
    expect(Object.values(store.records).every((record) => record.running === false)).toBe(true)
    expect(Object.values(store.records).every((record) => record.healthy === 'healthy')).toBe(true)
  })

  test('bootstrap twice is idempotent', () => {
    const first = ensureBuiltinMeetingAgents('ws-1', '1.0.0', { grantedCapabilities: ALL_CAPS })
    const second = ensureBuiltinMeetingAgents('ws-1', '1.0.0', { previous: first, grantedCapabilities: ALL_CAPS })
    expect(installedCount(second)).toBe(8)
    expect(second.ledger).toHaveLength(8)
  })

  test('disable survives upgrade', () => {
    const first = ensureBuiltinMeetingAgents('ws-1', '1.0.0', { grantedCapabilities: ALL_CAPS })
    const disabled = disableMeetingAgent(first, 'rox.meeting.assist')
    const upgraded = ensureBuiltinMeetingAgents('ws-1', '1.1.0', { previous: disabled, grantedCapabilities: ALL_CAPS })
    expect(upgraded.records['rox.meeting.assist'].enabled).toBe(false)
    expect(upgraded.records['rox.meeting.assist'].healthy).toBe('disabled')
    expect(upgraded.records['rox.meeting.scribe'].enabled).toBe(true)
  })

  test('expanded permissions require a new grant', () => {
    const first = ensureBuiltinMeetingAgents('ws-1', '1.0.0', { grantedCapabilities: ALL_CAPS })
    const grown = {
      ...first,
      records: {
        ...first.records,
        'rox.meeting.assist': {
          ...first.records['rox.meeting.assist'],
          definition: {
            ...first.records['rox.meeting.assist'].definition,
            allowedCapabilityIds: ['meeting.assist', 'meeting.screen', 'meeting.send'],
          },
        },
      },
    }
    const next = ensureBuiltinMeetingAgents('ws-1', '1.0.1', { previous: grown, grantedCapabilities: ALL_CAPS })
    expect(next.records['rox.meeting.assist'].authorized).toBe(false)
    expect(next.records['rox.meeting.assist'].healthy).toBe('authorization_required')
  })

  test('reset clears overrides; offline is not healthy', () => {
    const first = disableMeetingAgent(ensureBuiltinMeetingAgents('ws-1'), 'rox.meeting.author')
    const reset = resetMeetingAgentOverrides(first)
    expect(reset.records['rox.meeting.author'].enabled).toBe(true)
    const offline = ensureBuiltinMeetingAgents('ws-1', '1.0.0', { online: false, grantedCapabilities: ALL_CAPS })
    expect(offline.records['rox.meeting.coordinator'].healthy).toBe('offline')
    const flag = ensureBuiltinMeetingAgents('ws-1', '1.0.0', { grantedCapabilities: ALL_CAPS, routeHealthy: false })
    expect(flag.records['rox.meeting.coordinator'].healthy).not.toBe('healthy')
  })
})
