import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkspaceWorkStore } from '@rox/server-core/workspace-work/store'
import { WorkspaceWorkService, type WorkspaceWorkActor } from '@rox/server-core/workspace-work/service'
import { LocalMeetingStore } from '../../../../main/meetings/local-store'
import { createMeetingWorkspaceTask, linkMeetingTaskAfterCommit, MeetingTaskBacklinkError } from '../meeting-task-bridge'
import type { MeetingWorkspaceTaskSelection, MeetingWorkspaceTaskApi } from '../meeting-task-bridge'
import type { MeetingsLocalApi } from '../../../../shared/meetings-local'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'meeting-task-bridge-')); roots.push(root)
  const workStore = new WorkspaceWorkStore(root, 'ws-fixture')
  const meetings = new LocalMeetingStore({ root: join(root, 'meetings'), emit() {}, detectEngine: () => ({ ready: false, engine: null,
    binary: null, model: null, modelPath: null, ffmpeg: null, missing: [] }), validateTaskReference: (meeting, actionId, ref) =>
    ref.scope === 'workspace' && ref.workspaceId === meeting.workspaceId && workStore.read().tasks.some(task => task.id === ref.id &&
      task.links.some(link => link.kind === 'meeting' && link.id === meeting.id && link.anchor === actionId && link.workspaceId === ref.workspaceId)) })
  const meeting = meetings.create({ title: 'Meeting fixture', workspaceId: 'ws-fixture' })
  meetings.saveAction(meeting.id, { actionId: 'action-fixture', create: true, patch: { text: 'Review result' } })
  const actor: WorkspaceWorkActor = { actorId: 'author', canWrite: true, canDelete: true, canManage: true, assertCurrent() {} }
  const service = new WorkspaceWorkService(workStore, { members: () => [{ id: 'author', name: 'Author' }], hasMember: id => id === 'author',
    hasProject: id => id === 'project-fixture', hasSource: () => false, hasSkill: () => false,
    hasReference: link => link.kind === 'meeting' && meetings.read(link.id)?.actions.some(action => action.id === link.anchor) === true })
  const api: MeetingWorkspaceTaskApi = { workspaceWorkRead: async () => service.read(actor), workspaceWorkWrite: async (_, input) => service.write(actor, input) }
  const meetingApi: Pick<MeetingsLocalApi, 'saveAction'> = { saveAction: async (id, input) => meetings.saveAction(id, input) }
  const selection: MeetingWorkspaceTaskSelection = { workspaceId: 'ws-fixture', meetingId: meeting.id, actionId: 'action-fixture',
    title: 'Review result', description: 'Source meeting', assigneeId: 'author', projectId: 'project-fixture' }
  return { root, workStore, meetings, meeting, actor, service, api, meetingApi, selection }
}
test('qualified task, source anchor and meeting backlink survive real store reload', async () => {
  const f = fixture()
  const saved = await linkMeetingTaskAfterCommit(f.meetingApi, f.meeting.id, f.selection.actionId, async () => {
    expect(f.meetings.read(f.meeting.id)!.actions[0]!.taskRef).toBeUndefined()
    const task = await createMeetingWorkspaceTask(f.api, f.selection)
    return { scope: 'workspace', workspaceId: task.workspaceId, id: task.id }
  })
  const reopened = new WorkspaceWorkStore(f.root, 'ws-fixture').read()
  expect(reopened.tasks).toHaveLength(1)
  expect(reopened.tasks[0]!.assigneeId).toBe('author')
  expect(reopened.tasks[0]!.project).toEqual({ workspaceId: 'ws-fixture', id: 'project-fixture' })
  expect(saved.actions[0]!.taskRef).toEqual({ scope: 'workspace', workspaceId: 'ws-fixture', id: reopened.tasks[0]!.id })
  expect(f.meetings.read(f.meeting.id)!.actions[0]!.taskRef).toEqual(saved.actions[0]!.taskRef)
})
test('failed or unavailable task write creates no meeting backlink', async () => {
  const f = fixture()
  const unavailable: MeetingWorkspaceTaskApi = { ...f.api, workspaceWorkWrite: async () => { throw new Error('provider unavailable') } }
  await expect(linkMeetingTaskAfterCommit(f.meetingApi, f.meeting.id, f.selection.actionId, async () => {
    const task = await createMeetingWorkspaceTask(unavailable, f.selection)
    return { scope: 'workspace', workspaceId: task.workspaceId, id: task.id }
  })).rejects.toThrow('provider unavailable')
  expect(f.workStore.read().tasks).toHaveLength(0)
  expect(f.meetings.read(f.meeting.id)!.actions[0]!.taskRef).toBeUndefined()
})
test('lost create response resolves durable action origin and retries reuse one task', async () => {
  const f = fixture()
  const lost: MeetingWorkspaceTaskApi = { ...f.api, workspaceWorkWrite: async (_, input) => { f.service.write(f.actor, input); throw new Error('lost receipt') } }
  const first = await createMeetingWorkspaceTask(lost, f.selection)
  const second = await createMeetingWorkspaceTask(f.api, f.selection)
  expect(first.id).toBe(second.id)
  expect(f.workStore.read().tasks).toHaveLength(1)
  expect(f.workStore.read().revision).toBe(1)
})
test('backlink failure retains known task ID; retry links without duplicating', async () => {
  const f = fixture()
  let failure: MeetingTaskBacklinkError | undefined
  try {
    await linkMeetingTaskAfterCommit({ saveAction: async () => ({ ok: false, code: 'write-failed' }) }, f.meeting.id, f.selection.actionId, async () => {
      const task = await createMeetingWorkspaceTask(f.api, f.selection)
      return { scope: 'workspace', workspaceId: task.workspaceId, id: task.id }
    })
  } catch (error) { if (error instanceof MeetingTaskBacklinkError) failure = error; else throw error }
  expect(failure?.taskRef.scope).toBe('workspace')
  expect(f.meetings.read(f.meeting.id)!.actions[0]!.taskRef).toBeUndefined()
  await linkMeetingTaskAfterCommit(f.meetingApi, f.meeting.id, f.selection.actionId, async () => {
    const task = await createMeetingWorkspaceTask(f.api, f.selection, failure!.taskRef.id)
    return { scope: 'workspace', workspaceId: task.workspaceId, id: task.id }
  })
  expect(f.workStore.read().tasks).toHaveLength(1)
  expect(f.workStore.read().revision).toBe(1)
})
test('scope mismatch, invalid receipt, unknown action and deleted origin never fake success', async () => {
  const f = fixture()
  await expect(createMeetingWorkspaceTask(f.api, { ...f.selection, workspaceId: 'ws-other' })).rejects.toThrow('scope')
  await expect(createMeetingWorkspaceTask(f.api, { ...f.selection, actionId: 'unknown' })).rejects.toThrow('unavailable')
  const invalid: MeetingWorkspaceTaskApi = { ...f.api, workspaceWorkWrite: async (id, input) => {
    const result = await f.api.workspaceWorkWrite(id, input)
    return { ...result, receipt: { ...result.receipt, entityId: 'fake' } }
  } }
  await expect(createMeetingWorkspaceTask(invalid, f.selection)).rejects.toThrow('receipt')
  expect(f.meetings.read(f.meeting.id)!.actions[0]!.taskRef).toBeUndefined()
  const task = f.workStore.read().tasks[0]!
  f.service.delete(f.actor, { expectedRevision: f.workStore.read().revision, kind: 'task', id: task.id })
  await expect(createMeetingWorkspaceTask(f.api, f.selection)).rejects.toThrow('unavailable')
  expect(new WorkspaceWorkStore(f.root, 'ws-fixture').read().tasks).toHaveLength(0)
})
test('main store rejects invented shared backlinks through action and generic update paths', async () => {
  const f = fixture()
  const forged = { scope: 'workspace' as const, workspaceId: 'ws-fixture', id: 'unknown-task' }
  expect(f.meetings.saveAction(f.meeting.id, { actionId: f.selection.actionId, patch: { taskRef: forged } })).toEqual({ ok: false, code: 'task-link-unavailable' })
  expect(f.meetings.update(f.meeting.id, { actions: [{ ...f.meetings.read(f.meeting.id)!.actions[0]!, taskRef: forged }] })).toBeNull()
  expect(f.meetings.saveAction(f.meeting.id, { actionId: f.selection.actionId, patch: { taskRef: { ...forged, workspaceId: 'ws-other' } } })).toEqual({ ok: false, code: 'WORKSPACE_MISMATCH' })
  const task = await createMeetingWorkspaceTask(f.api, f.selection)
  const ref = { scope: 'workspace' as const, workspaceId: task.workspaceId, id: task.id }
  expect(f.meetings.saveAction(f.meeting.id, { actionId: f.selection.actionId, patch: { taskRef: ref } }).ok).toBe(true)
  expect(f.meetings.saveAction(f.meeting.id, { actionId: f.selection.actionId, patch: { taskRef: forged } })).toEqual({ ok: false, code: 'task-link-conflict' })
  f.service.delete(f.actor, { expectedRevision: f.workStore.read().revision, kind: 'task', id: task.id })
  // Retain a qualified link to deleted work while permitting unrelated meeting edits.
  expect(f.meetings.update(f.meeting.id, { notes: 'Later note' })?.actions[0]!.taskRef).toEqual(ref)
})
test('legacy personal task ID loads unchanged; a confirmed personal ref remains explicitly personal', () => {
  const f = fixture()
  const legacy = f.meetings.saveAction(f.meeting.id, { actionId: f.selection.actionId, patch: { taskId: 'personal-fixture' } })
  expect(legacy.ok).toBe(true)
  expect(f.meetings.read(f.meeting.id)!.actions[0]!.taskId).toBe('personal-fixture')
  const qualified = f.meetings.saveAction(f.meeting.id, { actionId: f.selection.actionId, patch: { taskRef: { scope: 'personal', id: 'personal-fixture' } } })
  expect(qualified.ok).toBe(true)
  expect(f.meetings.read(f.meeting.id)!.actions[0]!.taskRef).toEqual({ scope: 'personal', id: 'personal-fixture' })
})
