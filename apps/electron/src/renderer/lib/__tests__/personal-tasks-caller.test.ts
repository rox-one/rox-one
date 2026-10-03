import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test'
import { PersonalTaskStore, PERSONAL_TASKS_STORAGE_KEY, type PersonalTask, type PersonalTasksSnapshot, type PersonalTaskPutResult } from '@rox/core/tasks/personal'
import { hydratePersonalTasks, loadPersonalTaskStore, persistPersonalTaskConfirmed, persistPersonalTaskStore, runPersonalTaskScopeTransition, setPersonalTaskScope } from '../personal-tasks'
import type { PersonalTasksApi } from '../personal-tasks-sync'

const originalWindow = globalThis.window, originalStorage = globalThis.localStorage
const target = new EventTarget()
const memory = new Map<string, string>()
const changed: Array<() => void> = []
let identityChanged: (() => void) | undefined
let key = 'alice:A'
const snapshots = new Map<string, PersonalTasksSnapshot>()
const calls: Array<{ method: string; scope: string }> = []
const pending: Array<{ scope: string; resolve: (snapshot: PersonalTasksSnapshot) => void }> = []
let deferList = false
let deferredPut: ((value: PersonalTaskPutResult) => void) | null = null
let holdPut = false
const task = (title: string, id = 'shared-id'): PersonalTask => ({ id, title, notes: '', list: 'inbox', tags: [], priority: 'none', evening: false, links: [], order: 0, createdAt: 1 })
const snapshot = (...tasks: PersonalTask[]): PersonalTasksSnapshot => ({ tasks, revisions: Object.fromEntries(tasks.map(task => [task.id, 1])), meta: null, migration: null })
const api: PersonalTasksApi & { onPersonalTasksChanged(callback: () => void): () => void; onIdentityChanged(callback: () => void): () => void; getOrgIdentity(): Promise<{ authority: 'native'; issuer: string; userId: string }>; getWindowWorkspace(): Promise<string> } = {
  personalTasksList: async () => {
    calls.push({ method: 'list', scope: key })
    if (deferList) return new Promise(resolve => pending.push({ scope: key, resolve }))
    return structuredClone(snapshots.get(key) ?? snapshot())
  },
  personalTasksPut: async writes => {
    calls.push({ method: 'put', scope: key })
    if (holdPut) return new Promise(resolve => { deferredPut = resolve })
    return { accepted: writes.map(write => ({ task: write.task, revision: (write.expectedRevision ?? 0) + 1 })), conflicts: [], rejected: [] }
  },
  personalTasksDelete: async deletes => { calls.push({ method: 'delete', scope: key }); return { removed: deletes.map(item => item.id), conflicts: [], rejected: [] } },
  personalTasksMigrate: async () => { calls.push({ method: 'migrate', scope: key }); return { ...snapshot(), status: 'migrated', imported: 0, skipped: 0 } },
  onPersonalTasksChanged: callback => { changed.push(callback); return () => {} },
  onIdentityChanged: callback => { identityChanged = callback; return () => {} },
  getOrgIdentity: async () => ({ authority: 'native', issuer: 'synthetic-authority', userId: key.split(':')[0]! }),
  getWindowWorkspace: async () => key.split(':')[1]!,
}
Object.assign(target, { electronAPI: api, setTimeout: globalThis.setTimeout.bind(globalThis), clearTimeout: globalThis.clearTimeout.bind(globalThis) })
const bind = (actor = 'alice', workspace = 'A') => {
  key = `${actor}:${workspace}`
  setPersonalTaskScope({ authority: 'native', issuer: 'synthetic-authority', userId: actor, workspaceId: workspace })
}
const tick = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }
beforeEach(() => {
  Object.defineProperty(globalThis, 'window', { value: target, configurable: true, writable: true })
  Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => memory.set(key, value) }, configurable: true, writable: true })
  setPersonalTaskScope(null)
  memory.clear(); snapshots.clear(); calls.length = pending.length = changed.length = 0
  deferList = holdPut = false; deferredPut = null
})
afterEach(() => setPersonalTaskScope(null))
afterAll(() => {
  Object.defineProperty(globalThis, 'window', { value: originalWindow, configurable: true, writable: true })
  Object.defineProperty(globalThis, 'localStorage', { value: originalStorage, configurable: true, writable: true })
})

test('native hydration never imports the desktop-global cache or requires migration writes', async () => {
  const desktop = new PersonalTaskStore(); desktop.create({ title: 'Private desktop cache' })
  memory.set(PERSONAL_TASKS_STORAGE_KEY, desktop.exportJson())
  snapshots.set('alice:A', snapshot(task('Canonical native task')))
  bind(); await hydratePersonalTasks()
  expect(loadPersonalTaskStore().list().map(task => task.title)).toEqual(['Canonical native task'])
  expect(calls.map(call => call.method)).toEqual(['list'])
  expect(memory.get(PERSONAL_TASKS_STORAGE_KEY)).toBe(desktop.exportJson())
})

test('A→B→A rejects previous hydration responses even when actor and workspace match again', async () => {
  deferList = true
  bind(); await tick(); bind('alice', 'B'); await tick(); bind(); await tick()
  expect(pending.map(item => item.scope)).toEqual(['alice:A', 'alice:B', 'alice:A'])
  pending[2]!.resolve(snapshot(task('Latest A'))); await hydratePersonalTasks()
  pending[0]!.resolve(snapshot(task('Old A'))); pending[1]!.resolve(snapshot(task('Foreign B'))); await tick()
  expect(loadPersonalTaskStore().list().map(task => task.title)).toEqual(['Latest A'])
  expect([...memory.values()].join(' ')).not.toContain('Old A')
  expect([...memory.values()].join(' ')).not.toContain('Foreign B')
})

test('native caches and revisions are distinct between actors sharing a workspace and task ID', async () => {
  snapshots.set('alice:A', snapshot(task('Alice private task'))); snapshots.set('bob:A', snapshot(task('Bob private task')))
  bind(); await hydratePersonalTasks(); bind('bob'); await hydratePersonalTasks()
  expect(loadPersonalTaskStore().list()[0]?.title).toBe('Bob private task')
  const cacheKeys = [...memory.keys()]
  expect(cacheKeys).toHaveLength(2)
  expect(cacheKeys[0]).not.toBe(cacheKeys[1])
  expect(calls.some(call => call.method !== 'list')).toBe(false)
})

test('a stale scoped cache cannot delete newer server tasks or resurrect previously deleted tasks', async () => {
  snapshots.set('alice:A', snapshot(task('Old cache task', 'deleted-id')))
  bind(); await hydratePersonalTasks(); setPersonalTaskScope(null)
  snapshots.set('alice:A', snapshot(task('Fresh server task', 'new-id')))
  bind(); await hydratePersonalTasks()
  expect(loadPersonalTaskStore().list().map(task => task.id)).toEqual(['new-id'])
  expect(calls.map(call => call.method)).toEqual(['list', 'list'])
})

test('late confirmed creation cannot publish an old actor ACK into a successor A visit', async () => {
  bind(); await hydratePersonalTasks(); holdPut = true
  const old = task('Late Alice create')
  const outcome = persistPersonalTaskConfirmed(old).then(() => 'accepted', () => 'rejected')
  await tick(); bind('bob'); await hydratePersonalTasks(); bind(); await hydratePersonalTasks()
  deferredPut!({ accepted: [{ task: old, revision: 1 }], conflicts: [], rejected: [] })
  expect(await outcome).toBe('rejected')
  expect(loadPersonalTaskStore().list()).toEqual([])
  expect([...memory.values()].join(' ')).not.toContain('Late Alice create')
})

test('a delayed PUT never dispatches a following DELETE into another workspace', async () => {
  snapshots.set('alice:A', snapshot(task('Remove A task')))
  bind(); await hydratePersonalTasks(); holdPut = true
  const replacement = task('New A task', 'new-A')
  const store = new PersonalTaskStore({ version: 1, tasks: [replacement], projects: [], areas: [], headings: [], audit: [] })
  persistPersonalTaskStore(store); await tick(); bind('alice', 'B'); await hydratePersonalTasks()
  deferredPut!({ accepted: [{ task: replacement, revision: 1 }], conflicts: [], rejected: [] }); await tick()
  expect(calls.filter(call => call.method === 'delete')).toEqual([])
  expect(loadPersonalTaskStore().list()).toEqual([])
})

test('stale server events and logout clear exposed state without fetching an old actor', async () => {
  snapshots.set('alice:A', snapshot(task('Alice private task')))
  bind(); await hydratePersonalTasks(); const oldEvent = changed[0]!
  bind('bob'); await hydratePersonalTasks(); const count = calls.length
  oldEvent(); await tick(); expect(calls.length).toBe(count)
  setPersonalTaskScope(null); expect(loadPersonalTaskStore().list()).toEqual([])
})

for (const operation of ['workspace switch', 'logout']) {
  test(`a rejected ${operation} restores Tasks only after fresh identity and workspace readback`, async () => {
    snapshots.set('alice:A', snapshot(task('Persisted Alice task')))
    bind(); await hydratePersonalTasks()
    const identity = api.getOrgIdentity, workspace = api.getWindowWorkspace
    let identityReads = 0, workspaceReads = 0
    api.getOrgIdentity = async () => { identityReads++; return identity() }
    api.getWindowWorkspace = async () => { workspaceReads++; return workspace() }
    const failure = new Error(`Rejected ${operation}`)
    try {
      const outcome = runPersonalTaskScopeTransition(async () => {
        expect(loadPersonalTaskStore().list()).toEqual([])
        throw failure
      }, () => true)
      await expect(outcome).rejects.toBe(failure)
      await hydratePersonalTasks()
      expect(identityReads).toBe(2); expect(workspaceReads).toBe(2)
      expect(loadPersonalTaskStore().list()[0]?.title).toBe('Persisted Alice task')
    } finally { api.getOrgIdentity = identity; api.getWindowWorkspace = workspace }
  })
}

test('a rejected transition never restores a captured profile when fresh authority fails', async () => {
  snapshots.set('alice:A', snapshot(task('Alice private task')))
  bind(); await hydratePersonalTasks()
  const identity = api.getOrgIdentity
  api.getOrgIdentity = async () => { throw new Error('Fresh authority denied') }
  const failure = new Error('Switch rejected')
  try {
    await expect(runPersonalTaskScopeTransition(async () => { throw failure }, () => true)).rejects.toBe(failure)
    expect(loadPersonalTaskStore().list()).toEqual([])
  } finally { api.getOrgIdentity = identity }
})

test('a lost switch ACK after main binding changes to B cannot publish B Tasks into committed renderer A', async () => {
  snapshots.set('alice:A', snapshot(task('Private A task')))
  snapshots.set('alice:B', snapshot(task('Private B task')))
  bind(); await hydratePersonalTasks()
  const failure = new Error('Switch ACK lost after main commit')
  await expect(runPersonalTaskScopeTransition(async () => {
    // Main committed the new binding, but App never received the successful ACK and still renders A.
    key = 'alice:B'
    throw failure
  }, () => true, { authority: 'native', workspaceId: 'A' })).rejects.toBe(failure)
  await hydratePersonalTasks()
  expect(loadPersonalTaskStore().list()).toEqual([])
  expect(calls.filter(call => call.scope === 'alice:B')).toEqual([])
  expect([...memory.values()].join(' ')).not.toContain('Private B task')
})

test('A→B→A during failed transition recovery discards the old verified identity response', async () => {
  snapshots.set('alice:A', snapshot(task('Current Alice task')))
  bind(); await hydratePersonalTasks()
  const identity = api.getOrgIdentity
  let release!: (value: Awaited<ReturnType<typeof identity>>) => void
  api.getOrgIdentity = () => new Promise(resolve => { release = resolve })
  const failure = new Error('Switch rejected')
  const outcome = runPersonalTaskScopeTransition(async () => { throw failure }, () => true).then(() => 'accepted', () => 'rejected')
  await tick(); bind('bob'); await hydratePersonalTasks(); bind(); await hydratePersonalTasks()
  const callsBefore = calls.length
  release({ authority: 'native', issuer: 'synthetic-authority', userId: 'alice' })
  expect(await outcome).toBe('rejected')
  expect(calls.length).toBe(callsBefore)
  expect(loadPersonalTaskStore().list()[0]?.title).toBe('Current Alice task')
  api.getOrgIdentity = identity
})

test('unmount invalidation suppresses recovery and a late successful transition result', async () => {
  bind(); await hydratePersonalTasks()
  let reject!: (error: Error) => void
  const failure = new Error('Logout rejected')
  const outcome = runPersonalTaskScopeTransition(() => new Promise<void>((_resolve, rejected) => { reject = rejected }), () => true).then(() => 'accepted', () => 'rejected')
  setPersonalTaskScope(null); reject(failure)
  expect(await outcome).toBe('rejected')
  expect(loadPersonalTaskStore().list()).toEqual([])
  let resolve!: () => void
  const late = runPersonalTaskScopeTransition(() => new Promise<void>(accepted => { resolve = accepted }), () => true).then(() => 'accepted', () => 'rejected')
  setPersonalTaskScope(null); resolve()
  expect(await late).toBe('rejected')
})
