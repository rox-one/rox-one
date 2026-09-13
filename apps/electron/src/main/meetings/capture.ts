import { authorizeMeetingAction, type MeetingGrant } from '@craft-agent/shared/meeting-agents'
import {
  appendMeetingAudio,
  pauseMeetingCaptureSession,
  startMeetingCaptureSession,
  stopMeetingCaptureSession,
  type MeetingCaptureSession,
} from '@craft-agent/shared/voice'

export type CaptureHost = {
  permissionGranted: boolean
  plugged: boolean
}

export function startMeetingCapture(input: {
  meetingId: string
  grant: MeetingGrant | null
  actorId: string
  deviceId: string
  host: CaptureHost
}): MeetingCaptureSession {
  const auth = authorizeMeetingAction(input.grant, {
    actorId: input.actorId,
    workspaceId: input.grant?.workspaceId ?? '',
    deviceId: input.deviceId,
    capability: 'mic',
    operation: 'start-capture',
  })
  if (!auth.ok || !input.host.permissionGranted) {
    return { ...startMeetingCaptureSession(input.meetingId), status: 'denied' }
  }
  if (!input.host.plugged) {
    return { ...startMeetingCaptureSession(input.meetingId), status: 'unplugged' }
  }
  return startMeetingCaptureSession(input.meetingId)
}

export function pauseMeetingCapture(session: MeetingCaptureSession): MeetingCaptureSession {
  return pauseMeetingCaptureSession(session)
}

export function stopMeetingCapture(session: MeetingCaptureSession) {
  return stopMeetingCaptureSession(session, session.status === 'unplugged' ? 'unplugged' : 'stopped')
}

export function ingestMeetingAudio(session: MeetingCaptureSession, source: 'mic' | 'system', bytes: Uint8Array) {
  if (!session || session.status !== 'recording') return session
  return appendMeetingAudio(session, source, bytes)
}
