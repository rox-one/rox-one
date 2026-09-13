import { createNativeNotesEngine, parseRox2EntityId, type NativeNotesEngine } from '@craft-agent/core/rox2'
import { PersonalTaskStore } from '@craft-agent/core/tasks/personal'
import type { MeetingProposal } from '@craft-agent/core/meetings'

export type NativeActionResult = {
  entityId: string
  revision: string
  kind: 'note' | 'task'
}

/** Personal tasks have no CAS token locally; do not invent `'1'`. #439 persist is off this branch. */
function missingTaskRevision(): string {
  return ''
}

function storedRevision(proposal: MeetingProposal): string {
  return typeof proposal.payload.revision === 'string' ? proposal.payload.revision : missingTaskRevision()
}

export function applyNativeMeetingAction(
  proposal: MeetingProposal,
  notes: NativeNotesEngine,
  tasks: PersonalTaskStore,
  seenOperations: Set<string>,
): NativeActionResult {
  if (seenOperations.has(proposal.id)) {
    const existingId = String(proposal.payload.entityId ?? '')
    return {
      entityId: existingId,
      revision: storedRevision(proposal),
      kind: proposal.type === 'create_note' ? 'note' : 'task',
    }
  }
  if (proposal.type === 'create_note') {
    const noteId = `meeting-${proposal.id}`
    const title = String(proposal.payload.title ?? 'Meeting note')
    const body = String(proposal.payload.body ?? '')
    const note = notes.create(noteId, `# ${title}\n\n${body}`)
    seenOperations.add(proposal.id)
    proposal.payload.entityId = note.entityId
    proposal.payload.revision = note.revision
    return { entityId: note.entityId, revision: note.revision, kind: 'note' }
  }
  const task = tasks.create({ title: String(proposal.payload.title ?? 'Meeting task'), dueAt: typeof proposal.payload.dueAt === 'number' ? proposal.payload.dueAt : undefined })
  seenOperations.add(proposal.id)
  const entityId = `task:${task.id}`
  const revision = missingTaskRevision()
  proposal.payload.entityId = entityId
  proposal.payload.revision = revision
  return { entityId, revision, kind: 'task' }
}

export function readbackNative(entityId: string, notes: NativeNotesEngine, tasks: PersonalTaskStore): { entityId: string; revision: string } | null {
  let parsed: ReturnType<typeof parseRox2EntityId>
  try {
    parsed = parseRox2EntityId(entityId)
  } catch {
    return null
  }
  if (parsed.kind === 'note') {
    const note = notes.read(parsed.id)
    if (!note) return null
    return { entityId: note.entityId, revision: note.revision }
  }
  if (parsed.kind !== 'task') return null
  const task = tasks.get(parsed.id)
  if (!task) return null
  return { entityId, revision: missingTaskRevision() }
}

export function createNativeActionHarness() {
  return {
    notes: createNativeNotesEngine(),
    tasks: new PersonalTaskStore(),
    seen: new Set<string>(),
  }
}
