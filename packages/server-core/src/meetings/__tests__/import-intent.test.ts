import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import type { MeetingGrant } from '@craft-agent/shared/meeting-agents'
import { startNativeMeeting } from '../catalog.ts'
import { applyNativeImportIntent, NATIVE_IMPORT_PROVIDER, NATIVE_IMPORT_REMOTE_TYPE } from '../import.ts'

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

describe('native import intent', () => {
  test('fail-closes without archive grant, empty hash, or video mime', () => {
    const root = mkdtempSync(join(tmpdir(), 'meeting-import-'))
    started(root)
    const bytes = new Uint8Array([1, 2, 3, 4])
    const spec = { contentHash: hashOf(bytes), byteLength: bytes.byteLength, mimeType: 'audio/wav' }
    expect(applyNativeImportIntent({
      persistRootDir: root,
      workspaceId: 'ws',
      actorId: 'user',
      grant: sendGrant,
      meetingId: 'meeting-fixed',
      spec,
    })).toEqual({ ok: false, code: 'archive-denied' })
    expect(applyNativeImportIntent({
      persistRootDir: root,
      workspaceId: 'ws',
      actorId: 'user',
      grant: null,
      meetingId: 'meeting-fixed',
      spec,
    })).toEqual({ ok: false, code: 'grant-required' })
    expect(applyNativeImportIntent({
      persistRootDir: root,
      workspaceId: 'ws',
      actorId: 'user',
      grant: archiveGrant,
      meetingId: 'meeting-fixed',
      spec: { contentHash: spec.contentHash, byteLength: 0, mimeType: 'audio/wav' },
    })).toEqual({ ok: false, code: 'import-empty' })
    expect(applyNativeImportIntent({
      persistRootDir: root,
      workspaceId: 'ws',
      actorId: 'user',
      grant: archiveGrant,
      meetingId: 'meeting-fixed',
      spec: { ...spec, mimeType: 'video/mp4' },
    })).toEqual({ ok: false, code: 'import-bad-format' })
  })

  test('persists import-intent binding; not SFU and not a decoded recording', () => {
    const root = mkdtempSync(join(tmpdir(), 'meeting-import-'))
    started(root)
    const bytes = new Uint8Array([1, 2, 3, 4])
    const contentHash = hashOf(bytes)
    const imported = applyNativeImportIntent({
      persistRootDir: root,
      workspaceId: 'ws',
      actorId: 'user',
      grant: archiveGrant,
      meetingId: 'meeting-fixed',
      spec: { contentHash, byteLength: bytes.byteLength, mimeType: 'audio/wav' },
    })
    expect(imported.ok).toBe(true)
    if (!imported.ok) throw new Error('expected import')
    expect(imported.meeting.status).toBe('finalizing')
    expect(imported.meeting.sourceBinding).toEqual({
      provider: NATIVE_IMPORT_PROVIDER,
      accountId: 'user',
      remoteType: NATIVE_IMPORT_REMOTE_TYPE,
      remoteId: contentHash,
    })
    expect(imported.meeting.sourceBinding?.provider).not.toBe('sfu')
    expect(existsSync(join(root, 'meetings', 'meeting-fixed', 'snapshot.json'))).toBe(true)
    const again = applyNativeImportIntent({
      persistRootDir: root,
      workspaceId: 'ws',
      actorId: 'user',
      grant: archiveGrant,
      meetingId: 'meeting-fixed',
      spec: { contentHash, byteLength: bytes.byteLength, mimeType: 'audio/wav' },
    })
    expect(again.ok).toBe(true)
    if (!again.ok) throw new Error('expected replay')
    expect(again.meeting.revision).toBe(imported.meeting.revision)
  })
})
