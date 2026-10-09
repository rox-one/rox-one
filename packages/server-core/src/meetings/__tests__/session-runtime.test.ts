import { describe, expect, test } from 'bun:test'
import { MeetingSessionRuntime } from '../session-runtime.ts'
import { emptyMeetingSession } from '@rox/core/meetings'

describe('meeting session runtime (d2.2)', () => {
  test('keyed transport:url lock rejects a second observer', () => {
    const runtime = new MeetingSessionRuntime()
    const first = runtime.open({
      sessionId: 'a',
      workspaceId: 'ws',
      meetingId: 'm1',
      transport: 'mic',
      url: 'meet://room-1',
      now: 10,
    })
    expect(first.ok).toBe(true)
    expect(runtime.lockOwner('mic', 'meet://room-1')).toBe('a')

    const second = runtime.open({
      sessionId: 'b',
      workspaceId: 'ws',
      meetingId: 'm2',
      transport: 'mic',
      url: 'meet://room-1',
      now: 11,
    })
    expect(second).toEqual({ ok: false, code: 'session-locked' })

    // A different transport is a different lock.
    const other = runtime.open({
      sessionId: 'c',
      workspaceId: 'ws',
      meetingId: 'm3',
      transport: 'chrome',
      url: 'meet://room-1',
      now: 12,
    })
    expect(other.ok).toBe(true)
  })

  test('state machine rejects invalid transitions and stops at terminal states', () => {
    const runtime = new MeetingSessionRuntime()
    runtime.open({ sessionId: 'a', workspaceId: 'ws', meetingId: 'm1', transport: 'mic', url: 'u', now: 1 })
    expect(runtime.transition('a', 'in_call', 2).ok).toBe(true)
    expect(runtime.transition('a', 'joining', 3)).toEqual({ ok: false, code: 'invalid-transition' })
    expect(runtime.transition('a', 'paused', 4).ok).toBe(true)
    expect(runtime.transition('a', 'in_call', 5).ok).toBe(true)
    expect(runtime.transition('a', 'ended', 6).ok).toBe(true)
    expect(runtime.transition('a', 'in_call', 7)).toEqual({ ok: false, code: 'session-terminal' })
    expect(runtime.transition('missing', 'ended', 8)).toEqual({ ok: false, code: 'session-not-found' })
  })

  test('terminal transition releases the key for the next session', () => {
    const runtime = new MeetingSessionRuntime()
    runtime.open({ sessionId: 'a', workspaceId: 'ws', meetingId: 'm1', transport: 'mic', url: 'u', now: 1 })
    runtime.transition('a', 'in_call', 2)
    runtime.transition('a', 'ended', 3)
    expect(runtime.lockOwner('mic', 'u')).toBeNull()
    expect(runtime.open({ sessionId: 'b', workspaceId: 'ws', meetingId: 'm1', transport: 'mic', url: 'u', now: 4 }).ok).toBe(true)
  })

  test('restore rehydrates a journal record without inventing state', () => {
    const runtime = new MeetingSessionRuntime()
    const record = emptyMeetingSession({ sessionId: 'j1', workspaceId: 'ws', meetingId: 'm1', transport: 'mic', now: 5 })
    runtime.restore({ ...record, state: 'paused', joinedAt: 5 }, 'u')
    expect(runtime.lockOwner('mic', 'u')).toBe('j1')
    const patched = runtime.patch('j1', { lineCount: 12 })
    expect(patched?.lineCount).toBe(12)
    expect(patched?.state).toBe('paused')
  })
})