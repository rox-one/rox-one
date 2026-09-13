import { describe, expect, test } from 'bun:test'
import { cancelMeetingJobs, MEETING_CONCURRENT_JOBS, routeMeetingEvent, type MeetingRouterState } from '../router.ts'
import type { MeetingGrant } from '../policies.ts'

const grant: MeetingGrant = {
  id: 'g',
  actorId: 'u',
  workspaceId: 'ws',
  deviceId: 'd',
  capabilities: ['mic'],
  budgetRemaining: 10,
}

const base = {
  meetingId: 'm1',
  grant,
  capability: 'mic' as const,
  actorId: 'u',
  workspaceId: 'ws',
  deviceId: 'd',
  sourceRevision: '1',
}

describe('meeting router (RMA-I007)', () => {
  test('queues five jobs with interactive first and respects limits', () => {
    let state: MeetingRouterState = { jobs: [], cancelled: false }
    for (let i = 0; i < 5; i += 1) {
      state = routeMeetingEvent({
        ...base,
        state,
        roleId: 'rox.meeting.scribe',
        triggerWatermark: `w${i}`,
        interactive: i === 4,
      })
    }
    expect(state.jobs.length).toBeLessThanOrEqual(MEETING_CONCURRENT_JOBS)
    const interactive = routeMeetingEvent({
      ...base,
      state: { jobs: [], cancelled: false },
      roleId: 'rox.meeting.assist',
      triggerWatermark: 'ask',
      interactive: true,
    })
    const digest = routeMeetingEvent({
      ...base,
      state: interactive,
      roleId: 'rox.meeting.scribe',
      triggerWatermark: 'digest',
    })
    expect(digest.jobs[0]?.priority).toBe('interactive')
  })

  test('duplicate watermark does not create a second job', () => {
    const first = routeMeetingEvent({
      ...base,
      state: { jobs: [], cancelled: false },
      roleId: 'rox.meeting.scribe',
      triggerWatermark: 'same',
    })
    const second = routeMeetingEvent({
      ...base,
      state: first,
      roleId: 'rox.meeting.scribe',
      triggerWatermark: 'same',
    })
    expect(second.jobs).toHaveLength(1)
  })

  test('unknown tool throws; cancel stops remainder', () => {
    expect(() => routeMeetingEvent({
      ...base,
      state: { jobs: [], cancelled: false },
      roleId: 'rox.meeting.scribe',
      triggerWatermark: 't',
      tool: 'shell',
      knownTools: ['meeting.transcript'],
    })).toThrow(/unknown meeting tool/)
    const queued = routeMeetingEvent({
      ...base,
      state: { jobs: [], cancelled: false },
      roleId: 'rox.meeting.scribe',
      triggerWatermark: 'a',
    })
    const cancelled = cancelMeetingJobs(queued)
    expect(cancelled.jobs[0]?.status).toBe('cancelled')
    const after = routeMeetingEvent({ ...base, state: cancelled, roleId: 'rox.meeting.scribe', triggerWatermark: 'new' })
    expect(after.jobs).toHaveLength(1)
  })
})
