import type { WorkspaceTask, WorkspaceWorkSnapshot, WorkspaceWorkResult, WorkspaceWorkWrite } from '@rox/shared/workspace-work'
import type { LocalMeeting, LocalMeetingTaskRef, MeetingsLocalApi } from '../../../shared/meetings-local'

export interface MeetingWorkspaceTaskSelection {
  workspaceId: string
  meetingId: string
  actionId: string
  title: string
  description: string
  assigneeId: string | null
  projectId: string | null
}
export interface MeetingWorkspaceTaskApi {
  workspaceWorkRead(workspaceId: string): Promise<WorkspaceWorkSnapshot>
  workspaceWorkWrite(workspaceId: string, input: WorkspaceWorkWrite): Promise<WorkspaceWorkResult>
}
function scoped(snapshot: WorkspaceWorkSnapshot, workspaceId: string): WorkspaceWorkSnapshot {
  if (snapshot.workspaceId !== workspaceId) throw new Error('Workspace response did not match meeting scope')
  return snapshot
}
function fromMeetingAction(task: WorkspaceTask, selection: MeetingWorkspaceTaskSelection): boolean {
  return task.workspaceId === selection.workspaceId && task.links.some(link => link.kind === 'meeting' &&
    link.workspaceId === selection.workspaceId && link.id === selection.meetingId && link.anchor === selection.actionId)
}

/** Resolves the durable meeting origin before every attempt, including after a lost create receipt. */
export async function createMeetingWorkspaceTask(
  api: MeetingWorkspaceTaskApi, selection: MeetingWorkspaceTaskSelection, knownTaskId?: string,
): Promise<WorkspaceTask> {
  const before = scoped(await api.workspaceWorkRead(selection.workspaceId), selection.workspaceId)
  const existing = knownTaskId ? before.tasks.find(task => task.id === knownTaskId) : before.tasks.find(task => fromMeetingAction(task, selection))
  if (existing) {
    if (!fromMeetingAction(existing, selection)) throw new Error('Task source did not match the meeting action')
    return existing
  }
  if (knownTaskId) throw new Error('Previously saved task is unavailable')
  if (!before.access.canWrite) throw new Error('Workspace task permission denied')
  if (selection.assigneeId && !before.members.some(member => member.id === selection.assigneeId)) throw new Error('Selected assignee is unavailable')
  let result: WorkspaceWorkResult
  try {
    result = await api.workspaceWorkWrite(selection.workspaceId, { expectedRevision: before.revision, kind: 'createTask', input: {
      title: selection.title, description: selection.description, assigneeId: selection.assigneeId,
      project: selection.projectId ? { workspaceId: selection.workspaceId, id: selection.projectId } : null,
      links: [{ kind: 'meeting', workspaceId: selection.workspaceId, id: selection.meetingId, anchor: selection.actionId }],
    } })
  } catch (cause) {
    // Transport failure can follow a durable commit. Canonical host readback,
    // never a renderer cache, identifies the same origin without a second task.
    const recovered = scoped(await api.workspaceWorkRead(selection.workspaceId), selection.workspaceId).tasks.find(task => fromMeetingAction(task, selection))
    if (recovered) return recovered
    throw cause
  }
  scoped(result.snapshot, selection.workspaceId)
  const receipt = result.receipt
  if (receipt.workspaceId !== selection.workspaceId || receipt.revision !== result.snapshot.revision ||
    !/^[a-f0-9]{64}$/.test(receipt.sha256) || !result.snapshot.tasks.some(task => task.id === receipt.entityId && fromMeetingAction(task, selection))) {
    throw new Error('Task write receipt is invalid')
  }
  const after = scoped(await api.workspaceWorkRead(selection.workspaceId), selection.workspaceId)
  const task = after.tasks.find(task => task.id === receipt.entityId && fromMeetingAction(task, selection))
  if (after.revision < receipt.revision || !task) throw new Error('Saved task readback is unavailable')
  return task
}

export class MeetingTaskBacklinkError extends Error {
  constructor(readonly taskRef: LocalMeetingTaskRef, readonly code: string) {
    super('Task saved; meeting backlink did not complete')
    this.name = 'MeetingTaskBacklinkError'
  }
}

/** A failed backlink retains the qualified task ID for a safe retry. */
export async function linkMeetingTaskAfterCommit(
  api: Pick<MeetingsLocalApi, 'saveAction'>, meetingId: string, actionId: string,
  commit: () => Promise<LocalMeetingTaskRef>,
): Promise<LocalMeeting> {
  const taskRef = await commit()
  let result
  try { result = await api.saveAction(meetingId, { actionId, patch: { taskRef } }) }
  catch { throw new MeetingTaskBacklinkError(taskRef, 'unavailable') }
  if (!result.ok) throw new MeetingTaskBacklinkError(taskRef, result.code)
  const linked = result.value.actions.find(action => action.id === actionId)?.taskRef
  if (!linked || linked.id !== taskRef.id || linked.scope !== taskRef.scope ||
    linked.scope === 'workspace' && (taskRef.scope !== 'workspace' || linked.workspaceId !== taskRef.workspaceId)) {
    throw new MeetingTaskBacklinkError(taskRef, 'task-link-readback-failed')
  }
  return result.value
}
