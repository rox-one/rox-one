import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import type { MeetingGrant } from '@craft-agent/shared/meeting-agents'
import { startNativeMeeting } from '../catalog.ts'
import { applyNativeImportIntent } from '../import.ts'
import { applyNativeManualNote, applyNativeSegmentCorrection } from '../manual.ts'
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

describe('native manual note and correction intents', () => {
  test('fail-closes without archive grant, persist root, or native binding', () => {
    const root = mkdtempSync(join(tmpdir(), 'meeting-manual-'))
    imported(root)
    expect(applyNativeManualNote({
      persistRootDir: root,
      workspaceId: 'ws',
      actorId: 'user',
      grant: sendGrant,
      meetingId: 'meeting-fixed',
      spec: { noteId: 'n1', text: 'правка' },
    })).toEqual({ ok: false, code: 'archive-denied' })
    expect(applyNativeManualNote({
      persistRootDir: root,
      workspaceId: 'ws',
      actorId: 'user',
      grant: null,
      meetingId: 'meeting-fixed',
      spec: { noteId: 'n1', text: 'правка' },
    })).toEqual({ ok: false, code: 'grant-required' })
    expect(applyNativeManualNote({
      persistRootDir: '',
      workspaceId: 'ws',
      actorId: 'user',
      grant: archiveGrant,
      meetingId: 'meeting-fixed',
      spec: { noteId: 'n1', text: 'правка' },
    })).toEqual({ ok: false, code: 'config-dir-required' })
    expect(applyNativeManualNote({
      persistRootDir: root,
      workspaceId: 'ws',
      actorId: 'user',
      grant: archiveGrant,
      meetingId: 'meeting-fixed',
      spec: { noteId: 'n1', text: '   ' },
    })).toEqual({ ok: false, code: 'note-empty' })
    expect(applyNativeSegmentCorrection({
      persistRootDir: root,
      workspaceId: 'ws',
      actorId: 'user',
      grant: archiveGrant,
      meetingId: 'meeting-fixed',
      spec: { segmentId: 's1', replacement: '' },
    })).toEqual({ ok: false, code: 'correction-empty' })
  })

  test('planned meeting is not ready', () => {
    const root = mkdtempSync(join(tmpdir(), 'meeting-manual-'))
    started(root)
    expect(applyNativeManualNote({
      persistRootDir: root,
      workspaceId: 'ws',
      actorId: 'user',
      grant: archiveGrant,
      meetingId: 'meeting-fixed',
      spec: { noteId: 'n1', text: 'правка' },
    })).toEqual({ ok: false, code: 'note-not-ready' })
    expect(applyNativeSegmentCorrection({
      persistRootDir: root,
      workspaceId: 'ws',
      actorId: 'user',
      grant: archiveGrant,
      meetingId: 'meeting-fixed',
      spec: { segmentId: 's1', replacement: 'правка' },
    })).toEqual({ ok: false, code: 'correct-not-ready' })
  })

  test('records manual.note without segment.upsert or ASR source', () => {
    const root = mkdtempSync(join(tmpdir(), 'meeting-manual-'))
    imported(root)
    const noted = applyNativeManualNote({
      persistRootDir: root,
      workspaceId: 'ws',
      actorId: 'user',
      grant: archiveGrant,
      meetingId: 'meeting-fixed',
      spec: { noteId: 'n1', text: 'правка' },
    })
    expect(noted.ok).toBe(true)
    if (!noted.ok) throw new Error('expected note')
    expect(noted.meeting.sourceBinding?.provider).toBe('native-journal')
    expect(noted.meeting.sourceBinding?.provider).not.toBe('sfu')
    const snapshot = new MeetingJournal(root).read('meeting-fixed')
    expect(snapshot.events.some((event) => event.type === 'manual.note' && event.noteId === 'n1' && event.text === 'правка')).toBe(true)
    expect(snapshot.events.some((event) => event.type === 'segment.upsert')).toBe(false)
    const raw = readFileSync(join(root, 'meetings', 'meeting-fixed', 'journal.jsonl'), 'utf8')
    expect(raw).not.toContain('"type":"segment.upsert"')
    expect(raw).not.toContain('"source":"microphone"')

    const again = applyNativeManualNote({
      persistRootDir: root,
      workspaceId: 'ws',
      actorId: 'user',
      grant: archiveGrant,
      meetingId: 'meeting-fixed',
      spec: { noteId: 'n1', text: 'правка' },
    })
    expect(again.ok).toBe(true)
    if (!again.ok) throw new Error('expected replay')
    expect(again.meeting.revision).toBe(noted.meeting.revision)
  })

  test('records segment.correct without inventing ASR text', () => {
    const root = mkdtempSync(join(tmpdir(), 'meeting-manual-'))
    imported(root)
    const corrected = applyNativeSegmentCorrection({
      persistRootDir: root,
      workspaceId: 'ws',
      actorId: 'user',
      grant: archiveGrant,
      meetingId: 'meeting-fixed',
      spec: { segmentId: 's1', replacement: 'исправление' },
    })
    expect(corrected.ok).toBe(true)
    if (!corrected.ok) throw new Error('expected correction')
    const snapshot = new MeetingJournal(root).read('meeting-fixed')
    expect(snapshot.events.some((event) => (
      event.type === 'segment.correct'
      && event.segmentId === 's1'
      && event.replacement === 'исправление'
    ))).toBe(true)
    expect(snapshot.events.some((event) => event.type === 'segment.upsert')).toBe(false)
    expect(JSON.stringify(corrected.meeting)).not.toContain('"source":"microphone"')
  })
})
