import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MeetingGrant } from '@craft-agent/shared/meeting-agents'
import type { OperationResultV2 } from '@craft-agent/core/meetings'
import { startNativeMeeting } from '../catalog.ts'
import { MeetingJournal } from '../journal.ts'
import {
  appendOperationResultEvent,
  operationJournalCommandId,
} from '../operation-journal.ts'

const grant: MeetingGrant = {
  id: 'g',
  actorId: 'user',
  workspaceId: 'ws',
  deviceId: 'desktop',
  capabilities: ['send'],
}

function root(): string {
  return mkdtempSync(join(tmpdir(), 'operation-journal-'))
}

function started(persistRootDir: string, meetingId = 'm1') {
  const created = startNativeMeeting({
    persistRootDir,
    workspaceId: 'ws',
    actorId: 'user',
    grant,
    title: 'локальная',
    meetingId,
  })
  if (!created.ok) throw new Error('expected start')
  return created.meeting
}

function result(partial: Partial<OperationResultV2> = {}): OperationResultV2 {
  return {
    schemaVersion: 2,
    mode: 'production',
    lifecycle: 'succeeded',
    verification: 'verified',
    operationId: 'op-m1-abc',
    entityRef: { workspaceId: 'ws', entityId: 'task:1', revisionId: '3' },
    ...partial,
  }
}

function results(persistRootDir: string, meetingId: string) {
  return new MeetingJournal(persistRootDir).read(meetingId).events.filter((event) => event.type === 'operation.result')
}

describe('operation.result journal write', () => {
  test('writes operation.result after a started meeting', () => {
    const persistRootDir = root()
    started(persistRootDir)
    const row = result()
    const appended = appendOperationResultEvent({
      persistRootDir,
      workspaceId: 'ws',
      meetingId: 'm1',
      result: row,
    })
    expect(appended.ok).toBe(true)
    const events = results(persistRootDir, 'm1')
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({ type: 'operation.result', result: row })
  })

  test('fail-closes when the meeting snapshot does not exist', () => {
    const persistRootDir = root()
    expect(appendOperationResultEvent({
      persistRootDir,
      workspaceId: 'ws',
      meetingId: 'm1',
      result: result(),
    })).toEqual({ ok: false, code: 'meeting-not-found' })
    expect(() => new MeetingJournal(persistRootDir).read('m1')).toThrow(/not found/)
  })

  test('duplicate commandId does not append a second event', () => {
    const persistRootDir = root()
    started(persistRootDir)
    const row = result({ verification: 'not_requested', lifecycle: 'failed' })
    expect(operationJournalCommandId(row)).toBe('operation-op-m1-abc-not_requested')
    expect(appendOperationResultEvent({ persistRootDir, workspaceId: 'ws', meetingId: 'm1', result: row }).ok).toBe(true)
    expect(appendOperationResultEvent({ persistRootDir, workspaceId: 'ws', meetingId: 'm1', result: row }).ok).toBe(true)
    expect(results(persistRootDir, 'm1')).toHaveLength(1)
  })

  test('failed then verified apply is not swallowed as a duplicate', () => {
    const persistRootDir = root()
    started(persistRootDir)
    const failed = result({ verification: 'not_requested', lifecycle: 'failed' })
    const verified = result({ verification: 'verified', lifecycle: 'succeeded' })
    expect(operationJournalCommandId(failed)).not.toBe(operationJournalCommandId(verified))
    expect(appendOperationResultEvent({ persistRootDir, workspaceId: 'ws', meetingId: 'm1', result: failed }).ok).toBe(true)
    expect(appendOperationResultEvent({ persistRootDir, workspaceId: 'ws', meetingId: 'm1', result: verified }).ok).toBe(true)
    expect(results(persistRootDir, 'm1').map((event) => event.result.verification)).toEqual([
      'not_requested',
      'verified',
    ])
  })

  test('fail-closes without persist root, on workspace mismatch, and when the journal is locked', () => {
    const persistRootDir = root()
    started(persistRootDir)
    expect(appendOperationResultEvent({
      persistRootDir: null,
      workspaceId: 'ws',
      meetingId: 'm1',
      result: result(),
    })).toEqual({ ok: false, code: 'config-dir-required' })
    expect(appendOperationResultEvent({
      persistRootDir,
      workspaceId: 'other',
      meetingId: 'm1',
      result: result(),
    })).toEqual({ ok: false, code: 'workspace-mismatch' })
    const lock = new MeetingJournal(persistRootDir)
    lock.acquireWriter()
    expect(appendOperationResultEvent({
      persistRootDir,
      workspaceId: 'ws',
      meetingId: 'm1',
      result: result(),
    })).toEqual({ ok: false, code: 'journal-locked' })
    lock.releaseWriter()
    expect(results(persistRootDir, 'm1')).toHaveLength(0)
  })
})
