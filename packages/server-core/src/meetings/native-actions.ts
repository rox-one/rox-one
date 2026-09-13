import { createNotesRepository, nativeNoteRecord, type NotesRepository } from '@craft-agent/core/rox2'
import { PersonalTaskStore } from '@craft-agent/core/tasks/personal'
import type { MeetingProposal } from '@craft-agent/core/meetings'

export type NativeActionResult = {
  entityId: string
  revision: string
  kind: 'note' | 'task'
}

export function applyNativeMeetingAction(
  proposal: MeetingProposal,
  notes: NotesRepository,
  tasks: PersonalTaskStore,
  seenOperations: Set<string>,
): NativeActionResult {
  if (seenOperations.has(proposal.id)) {
    const existingId = String(proposal.payload.entityId ?? '')
    return { entityId: existingId, revision: String(proposal.payload.revision ?? '1'), kind: proposal.type === 'create_note' ? 'note' : 'task' }
  }
  if (proposal.type === 'create_note') {
    const id = `meeting-${proposal.id}`
    const record = nativeNoteRecord({
      id,
      title: String(proposal.payload.title ?? 'Meeting note'),
      body: String(proposal.payload.body ?? ''),
      revision: '1',
      updatedAt: 1,
    })
    notes.put(record)
    seenOperations.add(proposal.id)
    proposal.payload.entityId = record.entityId
    proposal.payload.revision = record.revision
    return { entityId: record.entityId, revision: record.revision, kind: 'note' }
  }
  const task = tasks.create({ title: String(proposal.payload.title ?? 'Meeting task'), dueAt: typeof proposal.payload.dueAt === 'number' ? proposal.payload.dueAt : undefined })
  seenOperations.add(proposal.id)
  proposal.payload.entityId = `task:${task.id}`
  proposal.payload.revision = '1'
  return { entityId: `task:${task.id}`, revision: '1', kind: 'task' }
}

export function readbackNative(entityId: string, notes: NotesRepository, tasks: PersonalTaskStore): { entityId: string; revision: string } | null {
  if (entityId.startsWith('note:')) {
    const read = notes.get(entityId)
    if (read.status !== 'ok') return null
    return { entityId: read.note.entityId, revision: read.note.revision }
  }
  const id = entityId.replace(/^task:/, '')
  const task = tasks.get(id)
  if (!task) return null
  return { entityId, revision: '1' }
}

export function createNativeActionHarness() {
  return {
    notes: createNotesRepository(),
    tasks: new PersonalTaskStore(),
    seen: new Set<string>(),
  }
}
