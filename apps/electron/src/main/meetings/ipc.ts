/**
 * Device-scoped meeting capture IPC (I004/I029).
 * Not an RPC channel: headless servers do not own a local microphone.
 */

import { ipcMain } from 'electron'
import { MeetingCaptureSession, type MeetingCaptureStatus } from './capture'

const START = 'meeting-capture:start'
const PAUSE = 'meeting-capture:pause'
const STOP = 'meeting-capture:stop'
const STATUS = 'meeting-capture:status'

const session = new MeetingCaptureSession()

export function registerMeetingCaptureIpc(): void {
  ipcMain.removeHandler(START)
  ipcMain.removeHandler(PAUSE)
  ipcMain.removeHandler(STOP)
  ipcMain.removeHandler(STATUS)

  ipcMain.handle(START, (_event, input?: { mic?: boolean; system?: boolean }): MeetingCaptureStatus => {
    return session.start({
      actor: {
        accountId: 'local-user',
        workspaceId: 'local',
        deviceId: 'local-device',
        authenticated: true,
      },
      grants: [],
      mic: input?.mic !== false,
      system: input?.system === true,
      now: Date.now(),
    })
  })

  ipcMain.handle(PAUSE, (): MeetingCaptureStatus => session.pause(Date.now()))
  ipcMain.handle(STOP, (): MeetingCaptureStatus => session.stop())
  ipcMain.handle(STATUS, (): MeetingCaptureStatus => session.snapshot())
}

export const MEETING_CAPTURE_IPC = { START, PAUSE, STOP, STATUS } as const
