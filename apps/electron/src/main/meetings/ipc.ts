/**
 * Device-scoped meeting capture IPC (I004/I029).
 * Not an RPC channel: headless servers do not own a local microphone.
 */

import { ipcMain } from 'electron'
import type { MeetingGrant } from '@rox/shared/meeting-agents'
import type { MeetingCaptureSession, MeetingCaptureStatus } from '@rox/shared/voice'
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

export interface MeetingCaptureIpcDeps {
  getWorkspaceForWindow(id: number): string | null
  getWorkspaceGenerationForWindow(id: number): number | null
}

function snapshot(): MeetingCaptureIpcStatus {
  if (!session) return { meetingId: null, status: 'idle' }
  return {
    meetingId: session.meetingId,
    status: session.status,
    startedAt: session.startedAt,
    paused: session.paused,
  }
}

export function registerMeetingCaptureIpc(deps: MeetingCaptureIpcDeps): void {
  // Device-scoped capture: bind every call to the sender's own live window and
  // workspace generation, exactly as the neighbouring local-meetings bridge.
  const assertSender = (event: Electron.IpcMainInvokeEvent): void => {
    if (event.sender.isDestroyed()
      || event.senderFrame !== event.sender.mainFrame
      || deps.getWorkspaceForWindow(event.sender.id) == null
      || deps.getWorkspaceGenerationForWindow(event.sender.id) == null) {
      throw new Error('IPC_SENDER_DENIED')
    }
  }

  ipcMain.removeHandler(START)
  ipcMain.removeHandler(PAUSE)
  ipcMain.removeHandler(STOP)
  ipcMain.removeHandler(STATUS)

  ipcMain.handle(START, (event, input: MeetingCaptureStartInput): MeetingCaptureIpcStatus => {
    assertSender(event)
    session = startMeetingCapture({
      meetingId: input.meetingId,
      grant: input.grant,
      actorId: input.actorId,
      deviceId: input.deviceId,
      // No fabricated host: an absent capture host fails closed (never grants mic).
      host: input.host ?? { permissionGranted: false, plugged: false },
    })
    return snapshot()
  })

  ipcMain.handle(PAUSE, (event): MeetingCaptureIpcStatus => {
    assertSender(event)
    if (session) session = pauseMeetingCapture(session)
    return snapshot()
  })

  ipcMain.handle(STOP, (event) => {
    assertSender(event)
    if (!session) return snapshot()
    const stopped = stopMeetingCapture(session)
    session = null
    return stopped
  })

  ipcMain.handle(STATUS, (event): MeetingCaptureIpcStatus => {
    assertSender(event)
    return snapshot()
  })
}
