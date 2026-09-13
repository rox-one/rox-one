import { describe, expect, test } from 'bun:test'
import { PersonalTaskStore } from '@craft-agent/core/tasks/personal'
import { createNotesRepository } from '@craft-agent/core/rox2'
import { applyNativeMeetingAction, readbackNative } from '../native-actions.ts'
import { payloadHash } from '../proposals.ts'
import type { MeetingProposal } from '@craft-agent/core/meetings'

describe('native meeting actions (RMA-I011)', () => {
  test('writes a native task, readback, and double approval does not duplicate', () => {
    const notes = createNotesRepository()
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
  })

  test('note write/readback and restart from json', () => {
    const notes = createNotesRepository()
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
    expect(readbackNative(written.entityId, notes, tasks)?.revision).toBe('1')
    const json = tasks.exportJson()
    const restored = PersonalTaskStore.fromJson(json)
    expect(restored.list()).toHaveLength(0)
  })
})
