import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import type { MeetingGrant } from '@craft-agent/shared/meeting-agents'
import { startNativeMeeting } from '../catalog.ts'
import { applyNativeCaptureIntent } from '../capture.ts'
import { applyNativeImportIntent } from '../import.ts'
import { applyNativeFinalizeIntent } from '../finalize.ts'
import { MeetingJournal } from '../journal.ts'

const sendGrant: MeetingGrant = {
  id: 'g',
  actorId: 'user',
  workspaceId: 'ws',
  deviceId: 'desktop',
  capabilities: ['send'],
}

const archiveGrant: MeetingGrant = {
  ...sendGrant,
  capabilities: ['send', 'archive'],
}

const micGrant: MeetingGrant = {
  ...sendGrant,
  capabilities: ['send', 'mic'],
}

function hashOf(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
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

function imported(root: string) {
  started(root)
  const bytes = new Uint8Array([1, 2, 3, 4])
  const result = applyNativeImportIntent({
    persistRootDir: root,
    workspaceId: 'ws',
    actorId: 'user',
    grant: archiveGrant,
    meetingId: 'meeting-fixed',
    spec: { contentHash: hashOf(bytes), byteLength: bytes.byteLength, mimeType: 'audio/wav' },
  })
  if (!result.ok) throw new Error('expected import')
  return result.meeting
}

describe('native finalize intent', () => {
  test('fail-closes without archive grant and without persist root', () => {
    const root = mkdtempSync(join(tmpdir(), 'meeting-finalize-'))
    imported(root)
    expect(applyNativeFinalizeIntent({
      persistRootDir: root,
      workspaceId: 'ws',
      actorId: 'user',
      grant: sendGrant,
      meetingId: 'meeting-fixed',
    })).toEqual({ ok: false, code: 'archive-denied' })
    expect(applyNativeFinalizeIntent({
      persistRootDir: root,
      workspaceId: 'ws',
      actorId: 'user',
      grant: null,
      meetingId: 'meeting-fixed',
    })).toEqual({ ok: false, code: 'grant-required' })
    expect(applyNativeFinalizeIntent({
      persistRootDir: '',
      workspaceId: 'ws',
      actorId: 'user',
      grant: archiveGrant,
      meetingId: 'meeting-fixed',
    })).toEqual({ ok: false, code: 'config-dir-required' })
  })

  test('planned meeting is not ready; capturing stays in progress', () => {
    const root = mkdtempSync(join(tmpdir(), 'meeting-finalize-'))
    started(root)
    expect(applyNativeFinalizeIntent({
      persistRootDir: root,
      workspaceId: 'ws',
      actorId: 'user',
      grant: archiveGrant,
      meetingId: 'meeting-fixed',
    })).toEqual({ ok: false, code: 'finalize-not-ready' })

    const capturing = applyNativeCaptureIntent({
      persistRootDir: root,
      workspaceId: 'ws',
      actorId: 'user',
      grant: micGrant,
      meetingId: 'meeting-fixed',
      action: 'start',
    })
    expect(capturing.ok).toBe(true)
    expect(applyNativeFinalizeIntent({
      persistRootDir: root,
      workspaceId: 'ws',
      actorId: 'user',
      grant: archiveGrant,
      meetingId: 'meeting-fixed',
    })).toEqual({ ok: false, code: 'capture-in-progress' })
  })

  test('import then finalize completes without segment.upsert or ASR text', () => {
    const root = mkdtempSync(join(tmpdir(), 'meeting-finalize-'))
    imported(root)
    const finalized = applyNativeFinalizeIntent({
      persistRootDir: root,
      workspaceId: 'ws',
      actorId: 'user',
      grant: archiveGrant,
      meetingId: 'meeting-fixed',
    })
    expect(finalized.ok).toBe(true)
    if (!finalized.ok) throw new Error('expected finalize')
    expect(finalized.meeting.status).toBe('completed')
    expect(finalized.meeting.sourceBinding?.provider).toBe('native-journal')
    expect(finalized.meeting.sourceBinding?.remoteType).toBe('import-intent')
    expect(finalized.meeting.sourceBinding?.provider).not.toBe('sfu')
    expect(existsSync(join(root, 'meetings', 'meeting-fixed', 'snapshot.json'))).toBe(true)

    const snapshot = new MeetingJournal(root).read('meeting-fixed')
    expect(snapshot.events.some((event) => event.type === 'segment.upsert')).toBe(false)
    expect(snapshot.events.some((event) => event.type === 'meeting.status' && event.status === 'completed')).toBe(true)
    const raw = readFileSync(join(root, 'meetings', 'meeting-fixed', 'journal.jsonl'), 'utf8')
    expect(raw).not.toContain('"type":"segment.upsert"')
    expect(JSON.stringify(snapshot.meeting)).not.toContain('transcript')

    const again = applyNativeFinalizeIntent({
      persistRootDir: root,
      workspaceId: 'ws',
      actorId: 'user',
      grant: archiveGrant,
      meetingId: 'meeting-fixed',
    })
    expect(again.ok).toBe(true)
    if (!again.ok) throw new Error('expected idempotent finalize')
    expect(again.meeting.revision).toBe(finalized.meeting.revision)
  })

  test('paused capture can finalize without inventing ASR', () => {
    const root = mkdtempSync(join(tmpdir(), 'meeting-finalize-'))
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
    const paused = applyNativeCaptureIntent({
      persistRootDir: root,
      workspaceId: 'ws',
      actorId: 'user',
      grant: micGrant,
      meetingId: 'meeting-fixed',
      action: 'pause',
    })
    expect(paused.ok).toBe(true)
    const finalized = applyNativeFinalizeIntent({
      persistRootDir: root,
      workspaceId: 'ws',
      actorId: 'user',
      grant: archiveGrant,
      meetingId: 'meeting-fixed',
    })
    expect(finalized.ok).toBe(true)
    if (!finalized.ok) throw new Error('expected pause finalize')
    expect(finalized.meeting.status).toBe('completed')
    expect(finalized.meeting.sourceBinding?.remoteType).toBe('capture-intent')
    const snapshot = new MeetingJournal(root).read('meeting-fixed')
    expect(snapshot.events.some((event) => event.type === 'segment.upsert')).toBe(false)
  })
})
