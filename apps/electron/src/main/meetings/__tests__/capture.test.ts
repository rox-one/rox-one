import { describe, expect, test } from 'bun:test'
import { MeetingCaptureSession } from '../capture.ts'
import type { MeetingGrant } from '@craft-agent/shared/meeting-agents'

const actor = {
  accountId: 'acct-1',
  workspaceId: 'ws-1',
  deviceId: 'dev-1',
  authenticated: true,
}

const micGrant: MeetingGrant = {
  id: 'g-mic',
  actorId: 'acct-1',
  workspaceId: 'ws-1',
  deviceId: 'dev-1',
  capabilities: ['capture.microphone'],
  expiresAt: 9_000,
}

describe('meeting capture (issue 360)', () => {
  test('denied without a mic grant', () => {
    const session = new MeetingCaptureSession()
    const status = session.start({
      actor,
      grants: [],
      mic: true,
      system: false,
      now: 1,
    })
    expect(status.state).toBe('denied')
  })

  test('dead mic stream fails closed', () => {
    const session = new MeetingCaptureSession()
    const status = session.start({
      actor,
      grants: [micGrant],
      mic: true,
      system: false,
      now: 1,
      streamAlive: { microphone: false },
    })
    expect(status.state).toBe('dead')
  })

  test('device unplug marks the session dead', () => {
    const session = new MeetingCaptureSession()
    session.start({ actor, grants: [micGrant], mic: true, system: false, now: 1, streamAlive: { microphone: true } })
    expect(session.unplug('microphone').state).toBe('dead')
  })

  test('pause then stop', () => {
    const session = new MeetingCaptureSession()
    session.start({ actor, grants: [micGrant], mic: true, system: false, now: 1, streamAlive: { microphone: true } })
    expect(session.pause(2).state).toBe('paused')
    expect(session.stop().state).toBe('stopped')
  })
})
