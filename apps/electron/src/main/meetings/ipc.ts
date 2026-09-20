/**
 * Device-scoped meeting capture IPC (I004/I029).
 * Not an RPC channel: headless servers do not own a local microphone.
 */

import { ipcMain } from 'electron'
import type { MeetingGrant } from '@craft-agent/shared/meeting-agents'
import type { MeetingCaptureSession, MeetingCaptureStatus } from '@craft-agent/shared/voice'
import {
  startMeetingCapture,
  pauseMeetingCapture,
  stopMeetingCapture,
} from './capture.ts'
import type { CaptureHost } from './capture.ts'

const START = 'meeting-capture:start'
const PAUSE = 'meeting-capture:pause'
const STOP = 'meeting-capture:stop'
const STATUS = 'meeting-capture:status'

export const MEETING_CAPTURE_IPC = { START, PAUSE, STOP, STATUS } as const

export type MeetingCaptureIpcStatus = {
  meetingId: string | null
  status: MeetingCaptureStatus | 'idle'
  startedAt?: number
  paused?: boolean
}

export type MeetingCaptureStartInput = {
  meetingId: string
  grant: MeetingGrant | null
  actorId: string
  deviceId: string
  host?: CaptureHost
}

let session: MeetingCaptureSession | null = null

function snapshot(): MeetingCaptureIpcStatus {
  if (!session) return { meetingId: null, status: 'idle' }
  return {
    meetingId: session.meetingId,
    status: session.status,
    startedAt: session.startedAt,
    paused: session.paused,
  }
}

export function registerMeetingCaptureIpc(): void {
  ipcMain.removeHandler(START)
  ipcMain.removeHandler(PAUSE)
  ipcMain.removeHandler(STOP)
  ipcMain.removeHandler(STATUS)

  ipcMain.handle(START, (_event, input: MeetingCaptureStartInput): MeetingCaptureIpcStatus => {
    session = startMeetingCapture({
      meetingId: input.meetingId,
      grant: input.grant,
      actorId: input.actorId,
      deviceId: input.deviceId,
      host: input.host ?? { permissionGranted: true, plugged: true },
    })
    return snapshot()
  })

  ipcMain.handle(PAUSE, (): MeetingCaptureIpcStatus => {
    if (session) session = pauseMeetingCapture(session)
    return snapshot()
  })

  ipcMain.handle(STOP, () => {
    if (!session) return snapshot()
    const stopped = stopMeetingCapture(session)
    session = null
    return stopped
  })

  ipcMain.handle(STATUS, (): MeetingCaptureIpcStatus => snapshot())
}
