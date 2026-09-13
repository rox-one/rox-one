import {
  createNativeNotesEngine,
  isNativeNotesEngine,
  parseRox2EntityId,
  type NativeNotesEngine,
} from '@craft-agent/core/rox2'
import { PersonalTaskStore } from '@craft-agent/core/tasks/personal'
import type { MeetingProposal } from '@craft-agent/core/meetings'

export type NativeActionResult = {
  entityId: string
  revision: string
  kind: 'note' | 'task'
}

export { isNativeNotesEngine }

/** Personal tasks have no CAS token locally; do not invent `'1'`. #439 persist is off this branch. */
function missingTaskRevision(): string {
  return ''
}

const appliedBySeen = new WeakMap<Set<string>, Map<string, NativeActionResult>>()

function appliedResults(seen: Set<string>): Map<string, NativeActionResult> {
  let map = appliedBySeen.get(seen)
  if (!map) {
    map = new Map()
    appliedBySeen.set(seen, map)
  }
  return map
}

function remember(seen: Set<string>, proposalId: string, result: NativeActionResult): NativeActionResult {
  seen.add(proposalId)
  appliedResults(seen).set(proposalId, result)
  return result
}

function replayNote(proposal: MeetingProposal, notes: NativeNotesEngine): NativeActionResult | null {
  const note = notes.read(`meeting-${proposal.id}`)
  if (!note) return null
  return { entityId: note.entityId, revision: note.revision, kind: 'note' }
}

export function applyNativeMeetingAction(
  proposal: MeetingProposal,
  notes: NativeNotesEngine,
  tasks: PersonalTaskStore,
  seenOperations: Set<string>,
): NativeActionResult {
  const applied = appliedResults(seenOperations)
  const previous = applied.get(proposal.id)
  if (previous) return previous
  if (seenOperations.has(proposal.id)) {
    if (proposal.type === 'create_note') {
      const replayed = replayNote(proposal, notes)
      if (replayed) return remember(seenOperations, proposal.id, replayed)
    }
    return { entityId: '', revision: missingTaskRevision(), kind: proposal.type === 'create_note' ? 'note' : 'task' }
  }
  if (proposal.type === 'create_note') {
    const noteId = `meeting-${proposal.id}`
    const title = String(proposal.payload.title ?? 'Meeting note')
    const body = String(proposal.payload.body ?? '')
    const note = notes.create(noteId, `# ${title}\n\n${body}`)
    return remember(seenOperations, proposal.id, {
      entityId: note.entityId,
      revision: note.revision,
      kind: 'note',
    })
  }
  const task = tasks.create({
    title: String(proposal.payload.title ?? 'Meeting task'),
    dueAt: typeof proposal.payload.dueAt === 'number' ? proposal.payload.dueAt : undefined,
  })
  return remember(seenOperations, proposal.id, {
    entityId: `task:${task.id}`,
    revision: missingTaskRevision(),
    kind: 'task',
  })
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
