import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MeetingGrant } from '@craft-agent/shared/meeting-agents'
import { listNativeMeetings, startNativeMeeting } from '../catalog.ts'

const grant: MeetingGrant = {
  id: 'g',
  actorId: 'user',
  workspaceId: 'ws',
  deviceId: 'desktop',
  capabilities: ['send'],
}

describe('native meeting catalog', () => {
  test('start is fail-closed without grant and does not write a snapshot', () => {
    const root = mkdtempSync(join(tmpdir(), 'meeting-catalog-'))
    expect(startNativeMeeting({
      persistRootDir: root,
      workspaceId: 'ws',
      actorId: 'user',
      grant: null,
      title: 'локальная',
    })).toEqual({ ok: false, code: 'grant-required' })
    expect(listNativeMeetings(root)).toEqual([])
    expect(existsSync(join(root, 'meetings'))).toBe(false)
  })

  test('start persists planned meeting; list survives a new journal', () => {
    const root = mkdtempSync(join(tmpdir(), 'meeting-catalog-'))
    const created = startNativeMeeting({
      persistRootDir: root,
      workspaceId: 'ws',
      actorId: 'user',
      grant,
      title: 'локальная',
      now: 10,
      meetingId: 'meeting-fixed',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) throw new Error('expected start')
    expect(created.meeting.status).toBe('planned')
    expect(created.meeting.sourceBinding).toBeUndefined()
    expect(existsSync(join(root, 'meetings', 'meeting-fixed', 'snapshot.json'))).toBe(true)
    const listed = listNativeMeetings(root)
    expect(listed).toHaveLength(1)
    expect(listed[0]?.meetingId).toBe('meeting-fixed')
    expect(listed[0]?.status).toBe('planned')
  })
})
