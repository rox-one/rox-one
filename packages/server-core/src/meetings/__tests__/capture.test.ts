import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MeetingGrant } from '@craft-agent/shared/meeting-agents'
import { startNativeMeeting } from '../catalog.ts'
import { applyNativeCaptureIntent, NATIVE_CAPTURE_PROVIDER, NATIVE_CAPTURE_REMOTE_TYPE } from '../capture.ts'

const sendGrant: MeetingGrant = {
  id: 'g',
  actorId: 'user',
  workspaceId: 'ws',
  deviceId: 'desktop',
  capabilities: ['send'],
}

const micGrant: MeetingGrant = {
  ...sendGrant,
  capabilities: ['send', 'mic'],
}

function started(root: string) {
  const created = startNativeMeeting({
    persistRootDir: root,
    workspaceId: 'ws',
    actorId: 'user',
    grant: sendGrant,
    title: 'локальная',
    meetingId: 'meeting-fixed',
  })
  if (!created.ok) throw new Error('expected start')
  return created.meeting
}

describe('native capture intent', () => {
  test('fail-closes without mic grant and does not bind SFU', () => {
    const root = mkdtempSync(join(tmpdir(), 'meeting-capture-'))
    started(root)
    expect(applyNativeCaptureIntent({
      persistRootDir: root,
      workspaceId: 'ws',
      actorId: 'user',
      grant: sendGrant,
      meetingId: 'meeting-fixed',
      action: 'start',
    })).toEqual({ ok: false, code: 'capability-denied' })
    expect(applyNativeCaptureIntent({
      persistRootDir: root,
      workspaceId: 'ws',
      actorId: 'user',
      grant: null,
      meetingId: 'meeting-fixed',
      action: 'start',
    })).toEqual({ ok: false, code: 'grant-required' })
  })

  test('start persists journal binding; pause and stop stay native-journal', () => {
    const root = mkdtempSync(join(tmpdir(), 'meeting-capture-'))
    started(root)
    const capturing = applyNativeCaptureIntent({
      persistRootDir: root,
      workspaceId: 'ws',
      actorId: 'user',
      grant: micGrant,
      meetingId: 'meeting-fixed',
      action: 'start',
    })
    expect(capturing.ok).toBe(true)
    if (!capturing.ok) throw new Error('expected capture start')
    expect(capturing.meeting.status).toBe('capturing')
    expect(capturing.meeting.sourceBinding).toEqual({
      provider: NATIVE_CAPTURE_PROVIDER,
      accountId: 'user',
      remoteType: NATIVE_CAPTURE_REMOTE_TYPE,
      remoteId: 'meeting-fixed',
    })
    expect(capturing.meeting.sourceBinding?.provider).not.toBe('sfu')
    expect(existsSync(join(root, 'meetings', 'meeting-fixed', 'snapshot.json'))).toBe(true)

    const paused = applyNativeCaptureIntent({
      persistRootDir: root,
      workspaceId: 'ws',
      actorId: 'user',
      grant: micGrant,
      meetingId: 'meeting-fixed',
      action: 'pause',
    })
    expect(paused.ok).toBe(true)
    if (!paused.ok) throw new Error('expected pause')
    expect(paused.meeting.status).toBe('paused')
    expect(paused.meeting.sourceBinding?.remoteType).toBe(NATIVE_CAPTURE_REMOTE_TYPE)

    const stopped = applyNativeCaptureIntent({
      persistRootDir: root,
      workspaceId: 'ws',
      actorId: 'user',
      grant: micGrant,
      meetingId: 'meeting-fixed',
      action: 'stop',
    })
    expect(stopped.ok).toBe(true)
    if (!stopped.ok) throw new Error('expected stop')
    expect(stopped.meeting.status).toBe('completed')
    expect(stopped.meeting.sourceBinding?.provider).toBe(NATIVE_CAPTURE_PROVIDER)
  })

  test('pause without start is fail-closed', () => {
    const root = mkdtempSync(join(tmpdir(), 'meeting-capture-'))
    started(root)
    expect(applyNativeCaptureIntent({
      persistRootDir: root,
      workspaceId: 'ws',
      actorId: 'user',
      grant: micGrant,
      meetingId: 'meeting-fixed',
      action: 'pause',
    })).toEqual({ ok: false, code: 'capture-not-started' })
  })
})
