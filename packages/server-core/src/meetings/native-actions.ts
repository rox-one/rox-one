import {
  createNativeNotesEngine,
  isNativeNotesEngine,
  parseRox2EntityId,
  type NativeNotesEngine,
} from '@craft-agent/core/rox2'
import { PersonalTaskStore, type PersonalTask } from '@craft-agent/core/tasks/personal'
import type { MeetingProposal } from '@craft-agent/core/meetings'
import { authorizeMeetingAction, type MeetingGrant } from '@craft-agent/shared/meeting-agents'
import { PersonalTaskPersistStore } from '../tasks/personal-persist.ts'
import { MeetingNotePersistStore } from './note-persist.ts'

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

function meetingNoteId(proposalId: string): string {
  return `meeting-${proposalId}`
}

function replayNote(
  proposal: MeetingProposal,
  notes: NativeNotesEngine,
  notesPersist: MeetingNotePersistStore,
): NativeActionResult | null {
  const noteId = meetingNoteId(proposal.id)
  const note = notes.read(noteId) ?? notesPersist.get(noteId)?.note
  if (!note) return null
  return { entityId: note.entityId, revision: note.revision, kind: 'note' }
}

function persistTaskRevision(persist: PersonalTaskPersistStore, task: PersonalTask): string {
  return String(persist.put(task).revision)
}

function persistNoteRevision(notesPersist: MeetingNotePersistStore, note: ReturnType<NativeNotesEngine['create']>): string {
  return notesPersist.put(note).revision
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

const EVIDENCE_TAG = 'rox:meeting-evidence'

export function encodeMeetingTaskNotes(input: {
  quote: string
  due?: string
  meetingId: string
  noteId: string
  operationId: string
  payloadHash: string
  segmentId: string
  segmentRevision: number
}): string {
  const lines = [input.quote.trim()]
  if (input.due) lines.push(`Due: ${input.due}`)
  lines.push(
    `<!-- ${EVIDENCE_TAG} meetingId="${input.meetingId}" noteId="${input.noteId}" operationId="${input.operationId}" payloadHash="${input.payloadHash}" segmentId="${input.segmentId}" segmentRevision="${input.segmentRevision}" -->`,
  )
  return lines.join('\n')
}

export function applyNativeMeetingAction(
  proposal: MeetingProposal,
  notes: NativeNotesEngine,
  tasks: PersonalTaskStore,
  seenOperations: Set<string>,
  persist: PersonalTaskPersistStore,
  notesPersist: MeetingNotePersistStore,
): NativeActionResult {
  const applied = appliedResults(seenOperations)
  const previous = applied.get(proposal.id)
  if (previous) return previous
  if (seenOperations.has(proposal.id)) {
    if (proposal.type === 'create_note') {
      const replayed = replayNote(proposal, notes, notesPersist)
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
    const noteId = meetingNoteId(proposal.id)
    const existing = notes.read(noteId) ?? notesPersist.get(noteId)?.note
    if (existing) {
      persistNoteRevision(notesPersist, existing)
      return remember(seenOperations, proposal.id, {
        entityId: existing.entityId,
        revision: existing.revision,
        kind: 'note',
      })
    }
    const title = String(proposal.payload.title ?? 'Meeting note')
    const body = String(proposal.payload.body ?? '')
    const note = notes.create(noteId, `# ${title}\n\n${body}`)
    const revision = persistNoteRevision(notesPersist, note)
    return remember(seenOperations, proposal.id, {
      entityId: note.entityId,
      revision,
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
    const revision = persistTaskRevision(persist, updated)
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
  const revision = persistTaskRevision(persist, task)
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
  notesPersist: MeetingNotePersistStore,
): { entityId: string; revision: string } | null {
  let parsed: ReturnType<typeof parseRox2EntityId>
  try {
    parsed = parseRox2EntityId(entityId)
  } catch {
    return null
  }
  if (parsed.kind === 'note') {
    const note = notes.read(parsed.id) ?? notesPersist.get(parsed.id)?.note
    if (!note) return null
    return { entityId: note.entityId, revision: note.revision }
  }
  if (parsed.kind !== 'task') return null
  const saved = persist.get(parsed.id)
  if (!saved) return null
  return { entityId: `task:${saved.task.id}`, revision: String(saved.revision) }
}

export function createNativeActionHarness(rootDir: string) {
  const persist = new PersonalTaskPersistStore(rootDir)
  const notesPersist = new MeetingNotePersistStore(rootDir)
  return {
    notes: createNativeNotesEngine(notesPersist.list()),
    tasks: new PersonalTaskStore(),
    persist,
    notesPersist,
    seen: new Set<string>(),
  }
}

export type OpenNativePersistTargetResult =
  | { ok: true; kind: 'note' | 'task'; id: string; revisionId: string; entityId: string }
  | { ok: false; code: string }

/** Fail-closed persist verify for native note/task. Not Mail/CRM/SFU. */
export function openNativePersistTarget(input: {
  persistRootDir: string | null
  workspaceId: string
  actorId: string
  grant: MeetingGrant | null
  entityId: string | null | undefined
  revisionId: string | null | undefined
  notes: NativeNotesEngine
  tasks: PersonalTaskStore
  persist: PersonalTaskPersistStore
  notesPersist: MeetingNotePersistStore
}): OpenNativePersistTargetResult {
  if (!input.grant) return { ok: false, code: 'grant-required' }
  if (!input.persistRootDir) return { ok: false, code: 'config-dir-required' }
  if (!input.workspaceId) return { ok: false, code: 'workspace-required' }
  if (!input.entityId || !input.revisionId) return { ok: false, code: 'revision-required' }
  const auth = authorizeMeetingAction(input.grant, {
    actorId: input.actorId,
    workspaceId: input.workspaceId,
    deviceId: input.grant.deviceId,
    capability: 'send',
    operation: 'open',
  })
  if (!auth.ok) return { ok: false, code: auth.code }
  let parsed: ReturnType<typeof parseRox2EntityId>
  try {
    parsed = parseRox2EntityId(input.entityId)
  } catch {
    return { ok: false, code: 'unsupported-native-kind' }
  }
  if (parsed.kind !== 'note' && parsed.kind !== 'task') {
    return { ok: false, code: 'unsupported-native-kind' }
  }
  const seen = readbackNative(input.entityId, input.notes, input.tasks, input.persist, input.notesPersist)
  if (!seen || seen.entityId !== input.entityId || seen.revision !== input.revisionId) {
    return { ok: false, code: 'persist-miss' }
  }
  return {
    ok: true,
    kind: parsed.kind,
    id: parsed.id,
    revisionId: seen.revision,
    entityId: seen.entityId,
  }
}
