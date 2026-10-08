import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, mkdirSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { DatabaseSync } from '@rox/shared/utils/sqlite-runtime'
import { WorkspaceWorkService, type WorkspaceWorkActor, type WorkspaceWorkCatalog } from './service.ts'
import { WorkspaceWorkStore } from './store.ts'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'workspace-work-')); dirs.push(root)
  const store = new WorkspaceWorkStore(root, 'workspace-a')
  const catalog: WorkspaceWorkCatalog = { members: () => ['author', 'assignee', 'other', 'manager'].map(id => ({ id, name: id })),
    hasMember: id => ['author', 'assignee', 'other', 'manager'].includes(id), hasProject: id => id === 'project-a',
    hasSource: id => id === 'source-a', hasSkill: id => id === 'skill-a', hasReference: link => link.id === 'session-a' }
  const service = new WorkspaceWorkService(store, catalog)
  const actor = (actorId: string, manage = false, write = true, remove = true): WorkspaceWorkActor => ({ actorId, canManage: manage,
    canWrite: write, canDelete: remove, assertCurrent(action) { if (action === 'write' && !write || action === 'delete' && !remove) throw Error('denied') } })
  return { root, store, service, catalog, author: actor('author'), assigned: actor('assignee'), other: actor('other'), manager: actor('manager', true), reader: actor('other', false, false, false) }
}
function createTask(f: ReturnType<typeof fixture>) {
  return f.service.write(f.author, { expectedRevision: f.store.read().revision, kind: 'createTask', input: { title: 'Task', assigneeId: 'assignee',
    project: { workspaceId: 'workspace-a', id: 'project-a' }, dueAt: 9000 } })
}

test('canonical task IDs, workspace project ref and receipt survive store reload', () => {
  const f = fixture(), result = createTask(f)
  const observed = new WorkspaceWorkStore(f.root, 'workspace-a').read()
  expect(observed).toEqual(f.store.read())
  expect(observed.tasks[0]!.id).toMatch(/^task_[0-9a-f-]{36}$/)
  expect(observed.tasks[0]!.project).toEqual({ workspaceId: 'workspace-a', id: 'project-a' })
  expect(result.receipt.sha256).toBe(createHash('sha256').update(readFileSync(f.store.filePath)).digest('hex'))
  expect(result.receipt.revision).toBe(observed.revision)
})
test('meeting action origin deduplicates retries, cannot retarget, and survives deletion', () => {
  const f = fixture()
  f.catalog.hasReference = link => link.kind === 'meeting' && link.id === 'meeting-a' && link.anchor === 'action-a'
  const input = { title: 'From meeting', links: [{ kind: 'meeting' as const, workspaceId: 'workspace-a', id: 'meeting-a', anchor: 'action-a' }] }
  const first = f.service.write(f.author, { expectedRevision: 0, kind: 'createTask', input })
  const retry = f.service.write(f.author, { expectedRevision: 1, kind: 'createTask', input })
  expect(retry.receipt.entityId).toBe(first.receipt.entityId)
  expect(retry.snapshot.tasks).toHaveLength(1)
  expect(() => f.service.write(f.author, { expectedRevision: 2, kind: 'updateTask', id: first.receipt.entityId, patch: { links: [] } })).toThrow('cannot be retargeted')
  f.service.delete(f.author, { expectedRevision: 2, kind: 'task', id: first.receipt.entityId })
  const reopened = new WorkspaceWorkService(new WorkspaceWorkStore(f.root, 'workspace-a'), f.catalog)
  expect(() => reopened.write(f.author, { expectedRevision: 3, kind: 'createTask', input })).toThrow('unavailable')
  expect(f.store.read().tombstones[0]!.originLinks).toEqual(input.links)
  expect(f.store.read().tasks).toHaveLength(0)
})
test('retained unavailable links, project and assignee do not block task edits; new missing selections fail', () => {
  const f = fixture()
  f.catalog.hasReference = link => link.kind === 'meeting' && link.id === 'meeting-a' && link.anchor === 'action-a'
  const links = [{ kind: 'meeting' as const, workspaceId: 'workspace-a', id: 'meeting-a', anchor: 'action-a' }]
  const project = { workspaceId: 'workspace-a', id: 'project-a' }
  const task = f.service.write(f.author, { expectedRevision: 0, kind: 'createTask', input: { title: 'Source task', links, project, assigneeId: 'assignee' } }).snapshot.tasks[0]!
  f.catalog.hasReference = () => false; f.catalog.hasMember = () => false; f.catalog.hasProject = () => false
  const result = f.service.write(f.author, { expectedRevision: 1, kind: 'updateTask', id: task.id, patch: { title: 'Durable work', status: 'done', links, project, assigneeId: 'assignee' } })
  expect(result.snapshot.tasks[0]!.status).toBe('done')
  expect(result.snapshot.tasks[0]!.links).toEqual(links)
  expect(() => f.service.write(f.author, { expectedRevision: 2, kind: 'updateTask', id: task.id, patch: { links: [...links, { kind: 'session', workspaceId: 'workspace-a', id: 'missing-session' }] } })).toThrow('unavailable')
  expect(() => f.service.write(f.author, { expectedRevision: 2, kind: 'updateTask', id: task.id, patch: { assigneeId: 'missing-member' } })).toThrow('unavailable')
  expect(() => f.service.write(f.author, { expectedRevision: 2, kind: 'updateTask', id: task.id, patch: { project: { ...project, id: 'missing-project' } } })).toThrow('unavailable')
  expect(f.store.read().revision).toBe(2)
})
test('author or assignee edits, other member comments, manager can edit', () => {
  const f = fixture(), first = createTask(f), id = first.snapshot.tasks[0]!.id
  expect(() => f.service.write(f.other, { expectedRevision: 1, kind: 'updateTask', id, patch: { title: 'Spoof' } })).toThrow('Workspace work action denied')
  expect(f.store.read().revision).toBe(1)
  f.service.write(f.other, { expectedRevision: 1, kind: 'commentTask', taskId: id, text: 'Comment' })
  f.service.write(f.assigned, { expectedRevision: 2, kind: 'updateTask', id, patch: { status: 'in-progress' } })
  f.service.write(f.manager, { expectedRevision: 3, kind: 'updateTask', id, patch: { title: 'Managed' } })
  expect(f.store.read().comments[0]!.authorId).toBe('other')
  expect(f.store.read().tasks[0]!.title).toBe('Managed')
  expect(() => f.service.write(f.reader, { expectedRevision: 4, kind: 'commentTask', taskId: id, text: 'No write grant' })).toThrow()
  expect(() => f.service.delete(f.other, { expectedRevision: 4, kind: 'task', id })).toThrow()
})
test('profiles owner/manage edits, shared default manage-only, captured capabilities immutable', () => {
  const f = fixture()
  const p = f.service.write(f.author, { expectedRevision: 0, kind: 'createProfile', input: { name: 'Agent', role: 'Review', sourceSlugs: ['source-a'], skillSlugs: ['skill-a'] } }).snapshot.profiles[0]!
  expect(() => f.service.write(f.other, { expectedRevision: 1, kind: 'updateProfile', id: p.id, patch: { role: 'Override' } })).toThrow()
  expect(() => f.service.write(f.author, { expectedRevision: 1, kind: 'setDefaultProfile', profileId: p.id })).toThrow()
  f.service.write(f.manager, { expectedRevision: 1, kind: 'setDefaultProfile', profileId: p.id })
  const snapshot = f.service.snapshotProfile(f.other)!
  f.service.write(f.author, { expectedRevision: 2, kind: 'updateProfile', id: p.id, patch: { role: 'Changed', sourceSlugs: [] } })
  expect(snapshot.role).toBe('Review'); expect(snapshot.sourceSlugs).toEqual(['source-a'])
  expect(f.service.snapshotProfile(f.other)!.revision).toBe(2)
  expect(new WorkspaceWorkService(new WorkspaceWorkStore(f.root, 'workspace-a'), f.catalog).read(f.author).defaultProfileId).toBe(p.id)
})
test('multiple work blocks keep task deadline separate; half-open overlap reports owner', () => {
  const f = fixture(), id = createTask(f).snapshot.tasks[0]!.id
  for (const [i, startAt, endAt] of [[1,1000,2000],[2,2000,3000],[3,1500,2500]]) f.service.write(f.assigned, { expectedRevision: i, kind: 'createWorkBlock', input: { taskId: id, startAt, endAt } })
  const read = f.service.read(f.author)
  expect(read.workBlocks).toHaveLength(3); expect(read.tasks[0]!.dueAt).toBe(9000)
  expect(read.conflicts).toHaveLength(2); expect(read.conflicts.every(c => c.assigneeId === 'assignee')).toBe(true)
  expect(() => f.service.write(f.other, { expectedRevision: 4, kind: 'createWorkBlock', input: { taskId: id, startAt: 1, endAt: 2 } })).toThrow()
  expect(() => f.service.write(f.author, { expectedRevision: 4, kind: 'createWorkBlock', input: { taskId: id, startAt: 2, endAt: 1 } })).toThrow()
})
test('invalid, unknown, spoofed and foreign IDs never write', () => {
  const f = fixture()
  for (const input of [{ title: '' }, { title: 'x', assigneeId: 'unknown' }, { title: 'x', project: { workspaceId: 'workspace-b', id: 'project-a' } },
    { title: 'x', project: { workspaceId: 'workspace-a', id: 'unknown' } }, { title: 'x', authorId: 'other' },
    { title: 'x', links: [{ workspaceId: 'workspace-a', kind: 'session', id: 'unknown' }] }]) {
    expect(() => f.service.write(f.author, { expectedRevision: 0, kind: 'createTask', input })).toThrow()
  }
  expect(() => f.service.write(f.author, { expectedRevision: 0, kind: 'createProfile', input: { name: 'x', role: 'x', sourceSlugs: ['unknown'], skillSlugs: [] } })).toThrow()
  expect(() => f.service.write(f.author, { expectedRevision: 0, kind: 'updateTask', id: 'unknown', patch: { title: 'x' } })).toThrow()
  expect(() => f.service.write(f.author, { expectedRevision: 0, kind: 'createWorkBlock', input: { taskId: 'unknown', startAt: 1, endAt: 2 } })).toThrow()
  expect(f.store.read().revision).toBe(0)
})
test('stale second writer fails; busy lease and symlink are denied without resetting data', () => {
  const f = fixture(), otherService = new WorkspaceWorkService(new WorkspaceWorkStore(f.root, 'workspace-a'), f.catalog)
  createTask(f)
  expect(() => otherService.write(f.author, { expectedRevision: 0, kind: 'createTask', input: { title: 'stale' } })).toThrow('Workspace work revision changed')
  const lease = new DatabaseSync(f.store.leasePath)
  lease.exec('BEGIN IMMEDIATE')
  expect(() => otherService.write(f.author, { expectedRevision: 1, kind: 'createTask', input: { title: 'busy' } })).toThrow('Workspace work writer is busy')
  lease.exec('ROLLBACK'); lease.close()
  expect(f.store.read().tasks).toHaveLength(1)
  const foreign = mkdtempSync(join(tmpdir(), 'work-foreign-')); dirs.push(foreign)
  const scoped = mkdtempSync(join(tmpdir(), 'work-symlink-')); dirs.push(scoped)
  symlinkSync(foreign, join(scoped, 'workspace-work'))
  expect(() => new WorkspaceWorkStore(scoped, 'workspace-a').read()).toThrow('Workspace work path denied')
})
test('delete atomically removes dependent blocks/comments and preserves canonical tombstone', () => {
  const f = fixture(), id = createTask(f).snapshot.tasks[0]!.id
  f.service.write(f.author, { expectedRevision: 1, kind: 'createWorkBlock', input: { taskId: id, startAt: 1, endAt: 2 } })
  f.service.write(f.other, { expectedRevision: 2, kind: 'commentTask', taskId: id, text: 'History' })
  const result = f.service.delete(f.author, { expectedRevision: 3, kind: 'task', id })
  expect(result.snapshot.tasks).toHaveLength(0); expect(result.snapshot.workBlocks).toHaveLength(0); expect(result.snapshot.comments).toHaveLength(0)
  const reopened = new WorkspaceWorkStore(f.root, 'workspace-a')
  expect(reopened.resolveTask(id)).toEqual({ status: 'deleted' })
  expect(reopened.resolveTask('unknown')).toEqual({ status: 'unavailable' })
})
test('authorization is checked again before durable commit; denial leaves canonical bytes unchanged', () => {
  const f = fixture(); createTask(f); const before = readFileSync(f.store.filePath, 'utf8')
  let calls = 0
  const changing: WorkspaceWorkActor = { ...f.author, assertCurrent() { if (++calls === 3) throw Error('grant revoked') } }
  expect(() => f.service.write(changing, { expectedRevision: 1, kind: 'createTask', input: { title: 'No commit' } })).toThrow('grant revoked')
  expect(readFileSync(f.store.filePath, 'utf8')).toBe(before)
})

test('real killed writer releases the OS lease; canonical bundle survives and accepts next revision', async () => {
  const f = fixture(); createTask(f)
  const child = Bun.spawn(['bun', '-e', `const {DatabaseSync}=await import('./packages/shared/src/utils/sqlite-runtime.ts');
    const db=new DatabaseSync(process.env.WORK_LEASE_PATH);db.exec('BEGIN IMMEDIATE');console.log('leased');await new Promise(()=>{});`],
    { cwd: join(import.meta.dir, '../../../..'), env: { ...process.env, WORK_LEASE_PATH: f.store.leasePath }, stdout: 'pipe', stderr: 'pipe' })
  const stream = child.stdout.getReader()
  try {
    const first = await stream.read()
    expect(new TextDecoder().decode(first.value)).toContain('leased')
    expect(() => f.service.write(f.author, { expectedRevision: 1, kind: 'createTask', input: { title: 'Busy' } })).toThrow('Workspace work writer is busy')
    child.kill('SIGKILL'); await child.exited
    const result = f.service.write(f.author, { expectedRevision: 1, kind: 'createTask', input: { title: 'Recovered' } })
    expect(result.snapshot.tasks.map(task => task.title)).toEqual(['Task', 'Recovered'])
    expect(result.snapshot.revision).toBe(2)
  } finally { child.kill(); stream.releaseLock() }
}, 10000)
