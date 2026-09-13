import {
  createNativeNotesEngine,
  isNativeNotesEngine,
  parseRox2EntityId,
  type NativeNotesEngine,
} from '@craft-agent/core/rox2'
import { PersonalTaskStore, type PersonalTask } from '@craft-agent/core/tasks/personal'
import type { MeetingProposal } from '@craft-agent/core/meetings'
import { PersonalTaskPersistStore } from '../tasks/personal-persist.ts'

export type NativeActionResult = {
  entityId: string
  revision: string
  kind: 'note' | 'task'
}

export { isNativeNotesEngine }

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

function persistRevision(persist: PersonalTaskPersistStore, task: PersonalTask): string {
  return String(persist.put(task).revision)
}

function taskIdFromPayload(payload: Record<string, unknown>): string | null {
  const raw = payload.entityId
  if (typeof raw !== 'string') return null
  try {
    const parsed = parseRox2EntityId(raw)
    return parsed.kind === 'task' ? parsed.id : null
  } catch {
    return null
  }
}

function readPersistedTask(
  persist: PersonalTaskPersistStore,
  tasks: PersonalTaskStore,
  taskId: string,
): PersonalTask | null {
  return persist.get(taskId)?.task ?? tasks.get(taskId) ?? null
}

export function applyNativeMeetingAction(
  proposal: MeetingProposal,
  notes: NativeNotesEngine,
  tasks: PersonalTaskStore,
  seenOperations: Set<string>,
  persist: PersonalTaskPersistStore,
): NativeActionResult {
  const applied = appliedResults(seenOperations)
  const previous = applied.get(proposal.id)
  if (previous) return previous
  if (seenOperations.has(proposal.id)) {
    if (proposal.type === 'create_note') {
      const replayed = replayNote(proposal, notes)
      if (replayed) return remember(seenOperations, proposal.id, replayed)
    }
    const existingId = taskIdFromPayload(proposal.payload)
    if (existingId) {
      const saved = persist.get(existingId)
      if (saved) {
        return remember(seenOperations, proposal.id, {
          entityId: `task:${saved.task.id}`,
          revision: String(saved.revision),
          kind: 'task',
        })
      }
    }
    return { entityId: '', revision: '', kind: proposal.type === 'create_note' ? 'note' : 'task' }
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
  const existingTaskId = taskIdFromPayload(proposal.payload)
  if (existingTaskId) {
    const current = readPersistedTask(persist, tasks, existingTaskId)
    if (!current) {
      return { entityId: '', revision: '', kind: 'task' }
    }
    const nextTitle = typeof proposal.payload.title === 'string' ? proposal.payload.title : current.title
    const nextDue = typeof proposal.payload.dueAt === 'number' ? proposal.payload.dueAt : current.dueAt
    const updated = tasks.get(existingTaskId)
      ? tasks.update(existingTaskId, { title: nextTitle, dueAt: nextDue })
      : { ...current, title: nextTitle, dueAt: nextDue }
    const revision = persistRevision(persist, updated)
    return remember(seenOperations, proposal.id, {
      entityId: `task:${updated.id}`,
      revision,
      kind: 'task',
    })
  }
  const task = tasks.create({
    title: String(proposal.payload.title ?? 'Meeting task'),
    dueAt: typeof proposal.payload.dueAt === 'number' ? proposal.payload.dueAt : undefined,
  })
  const revision = persistRevision(persist, task)
  return remember(seenOperations, proposal.id, {
    entityId: `task:${task.id}`,
    revision,
    kind: 'task',
  })
}

export function readbackNative(
  entityId: string,
  notes: NativeNotesEngine,
  _tasks: PersonalTaskStore,
  persist: PersonalTaskPersistStore,
): { entityId: string; revision: string } | null {
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
  const saved = persist.get(parsed.id)
  if (!saved) return null
  return { entityId: `task:${saved.task.id}`, revision: String(saved.revision) }
}

export function createNativeActionHarness(rootDir: string) {
  return {
    notes: createNativeNotesEngine(),
    tasks: new PersonalTaskStore(),
    persist: new PersonalTaskPersistStore(rootDir),
    seen: new Set<string>(),
  }
}
