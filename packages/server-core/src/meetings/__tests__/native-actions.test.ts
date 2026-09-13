import { describe, expect, test } from 'bun:test'
import { PersonalTaskStore } from '@craft-agent/core/tasks/personal'
import { createNativeNotesEngine } from '@craft-agent/core/rox2'
import { applyNativeMeetingAction, createNativeActionHarness, readbackNative } from '../native-actions.ts'
import { payloadHash } from '../proposals.ts'
import type { MeetingProposal } from '@craft-agent/core/meetings'

describe('native meeting actions (RMA-I011)', () => {
  test('writes a native task, readback, and double approval does not duplicate', () => {
    const notes = createNativeNotesEngine()
    const tasks = new PersonalTaskStore()
    const seen = new Set<string>()
    const payload = { title: 'прототип', dueAt: Date.parse('2026-09-18T00:00:00Z') }
    const proposal: MeetingProposal = {
      id: 'p1',
      workspaceId: 'ws',
      meetingId: 'm1',
      type: 'create_task',
      payload,
      payloadHash: payloadHash(payload),
      status: 'approved',
      sourceSpans: [],
      baseRevisions: {},
    }
    const first = applyNativeMeetingAction(proposal, notes, tasks, seen)
    const second = applyNativeMeetingAction(proposal, notes, tasks, seen)
    expect(first.entityId).toBe(second.entityId)
    expect(tasks.list()).toHaveLength(1)
    expect(readbackNative(first.entityId, notes, tasks)?.entityId).toBe(first.entityId)
    expect(first.entityId.startsWith('task:')).toBe(true)
    expect(first.revision).toBe('')
    expect(readbackNative(first.entityId, notes, tasks)?.revision).toBe('')
  })

  test('note write/readback uses NativeNotesEngine revision and survives vault restart', () => {
    const notes = createNativeNotesEngine()
    const tasks = new PersonalTaskStore()
    const seen = new Set<string>()
    const proposal: MeetingProposal = {
      id: 'n1',
      workspaceId: 'ws',
      meetingId: 'm1',
      type: 'create_note',
      payload: { title: 'Minutes', body: 'ok' },
      payloadHash: 'x',
      status: 'approved',
      sourceSpans: [],
      baseRevisions: {},
    }
    const written = applyNativeMeetingAction(proposal, notes, tasks, seen)
    const duplicate = applyNativeMeetingAction(proposal, notes, tasks, seen)
    expect(duplicate.entityId).toBe(written.entityId)
    expect(duplicate.revision).toBe(written.revision)
    expect(notes.list()).toHaveLength(1)
    const stored = notes.read('meeting-n1')
    expect(stored).not.toBeNull()
    expect(stored?.title).toBe('Minutes')
    expect(stored?.markdown).toContain('ok')
    expect(written.entityId).toBe('note:meeting-n1')
    expect(written.revision).toBe(stored!.revision)
    expect(written.revision).not.toBe('1')
    expect(written.revision.length).toBeGreaterThan(0)
    const read = readbackNative(written.entityId, notes, tasks)
    expect(read?.entityId).toBe(written.entityId)
    expect(read?.revision).toBe(written.revision)

    const restarted = createNativeNotesEngine(notes.list())
    const again = readbackNative(written.entityId, restarted, tasks)
    expect(again?.revision).toBe(written.revision)
    expect(restarted.read('meeting-n1')?.markdown).toContain('ok')
    expect(tasks.exportJson()).toContain('"tasks": []')
  })

  test('harness is a NativeNotesEngine, not a NotesRepository Map', () => {
    const harness = createNativeActionHarness()
    expect(typeof harness.notes.create).toBe('function')
    expect(typeof harness.notes.read).toBe('function')
    expect('put' in harness.notes).toBe(false)
  })
})
