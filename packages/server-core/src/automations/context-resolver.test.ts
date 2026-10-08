import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { WorkspaceWorkStore } from '../workspace-work/store'
import { WorkspaceWorkService, type WorkspaceWorkActor } from '../workspace-work/service'
import { automationContextFailure } from '@rox/shared/automations/context'
import { resolveWorkspaceAutomationContext } from './context-resolver'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'automation-task-context-')); roots.push(root)
  for (const id of ['project-a', 'project-b']) {
    mkdirSync(join(root, 'projects', id), { recursive: true })
    writeFileSync(join(root, 'projects', id, 'config.json'), JSON.stringify({ id, slug: id, name: id }))
  }
  const store = new WorkspaceWorkStore(root, 'workspace-a')
  const service = new WorkspaceWorkService(store, { members: () => [{ id: 'author', name: 'Author' }], hasMember: id => id === 'author',
    hasProject: id => ['project-a', 'project-b'].includes(id), hasSource: () => false, hasSkill: () => false, hasReference: () => false })
  const actor: WorkspaceWorkActor = { actorId: 'author', canWrite: true, canDelete: true, canManage: true, assertCurrent() {} }
  const task = service.write(actor, { expectedRevision: 0, kind: 'createTask', input: { title: 'Review', project: { workspaceId: 'workspace-a', id: 'project-a' } } }).snapshot.tasks[0]!
  return { root, store, service, actor, task, reference: { workspaceId: 'workspace-a', projectId: 'project-a', object: { kind: 'task' as const, id: task.id } } }
}

test('resolves canonical task identity after rename, exposes project move, and uses deletion tombstones', () => {
  const f = fixture()
  expect(resolveWorkspaceAutomationContext(f.root, 'workspace-a', f.reference)).toMatchObject({ status: 'available', objectId: f.task.id, projectId: 'project-a' })
  f.service.write(f.actor, { expectedRevision: 1, kind: 'updateTask', id: f.task.id, patch: { title: 'Renamed' } })
  expect(automationContextFailure(f.reference, 'workspace-a', resolveWorkspaceAutomationContext(f.root, 'workspace-a', f.reference))).toBeNull()
  f.service.write(f.actor, { expectedRevision: 2, kind: 'updateTask', id: f.task.id, patch: { project: { workspaceId: 'workspace-a', id: 'project-b' } } })
  expect(automationContextFailure(f.reference, 'workspace-a', resolveWorkspaceAutomationContext(f.root, 'workspace-a', f.reference))).toBe('target-out-of-scope')
  f.service.delete(f.actor, { expectedRevision: 3, kind: 'task', id: f.task.id })
  expect(resolveWorkspaceAutomationContext(f.root, 'workspace-a', f.reference)).toEqual({ status: 'deleted' })
  expect(resolveWorkspaceAutomationContext(f.root, 'workspace-a', { ...f.reference, object: { kind: 'task', id: 'unknown' } })).toEqual({ status: 'unavailable' })
})

test('unreadable task storage never becomes a deletion and a missing project does not grant a dangling context', () => {
  const f = fixture()
  const before = readFileSync(f.store.filePath, 'utf8')
  writeFileSync(f.store.filePath, '{broken')
  expect(resolveWorkspaceAutomationContext(f.root, 'workspace-a', f.reference)).toEqual({ status: 'unavailable' })
  writeFileSync(f.store.filePath, before)
  rmSync(join(f.root, 'projects', 'project-a'), { recursive: true })
  expect(resolveWorkspaceAutomationContext(f.root, 'workspace-a', f.reference)).toEqual({ status: 'deleted' })
})
