import { describe, expect, test } from 'bun:test'
import { ingestMeetingAudio, pauseMeetingCapture, startMeetingCapture, stopMeetingCapture } from '../capture.ts'
import type { MeetingGrant } from '@craft-agent/shared/meeting-agents'

const grant: MeetingGrant = {
  id: 'g',
  actorId: 'u',
  workspaceId: 'ws',
  deviceId: 'd',
  capabilities: ['mic', 'system'],
}

describe('meeting capture (RMA-I004)', () => {
  test('permission denied, unplug, pause, and replay hashes', () => {
    const denied = startMeetingCapture({
      meetingId: 'm1',
      grant,
      actorId: 'u',
      deviceId: 'd',
      host: { permissionGranted: false, plugged: true },
    })
    expect(denied.status).toBe('denied')
    const unplugged = startMeetingCapture({
      meetingId: 'm1',
      grant,
      actorId: 'u',
      deviceId: 'd',
      host: { permissionGranted: true, plugged: false },
    })
    expect(unplugged.status).toBe('unplugged')
    let session = startMeetingCapture({
      meetingId: 'm1',
      grant,
      actorId: 'u',
      deviceId: 'd',
      host: { permissionGranted: true, plugged: true },
    })
    session = ingestMeetingAudio(session, 'mic', new Uint8Array([1, 2, 3, 4]))
    session = ingestMeetingAudio(session, 'system', new Uint8Array([5, 6, 7, 8]))
    session = pauseMeetingCapture(session)
    expect(session.status).toBe('paused')
    const ignored = ingestMeetingAudio(session, 'mic', new Uint8Array([9]))
    expect(ignored.mic).toHaveLength(1)
    const stopped = stopMeetingCapture(session)
    expect(stopped.mic.sha256.length).toBe(64)
    expect(stopped.system.bytes).toBe(4)
  })
})
