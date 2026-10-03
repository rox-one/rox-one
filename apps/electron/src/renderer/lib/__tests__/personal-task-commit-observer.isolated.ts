import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { VersionedPersonalTask } from '@rox/core/tasks/personal'
import { PersonalTaskPersistStore } from '../../../../../../packages/server-core/src/tasks/personal-persist'
import { deletePersonalTasks, migratePersonalTasks, putPersonalTasks, readPersonalTasks } from '../../../../../../packages/server-core/src/tasks/personal-tasks-service'
import type { PersonalTasksApi } from '../personal-tasks-sync'
import { hydratePersonalTasks, loadPersonalTaskStore, persistPersonalTaskStore, persistPersonalTaskConfirmed, subscribePersonalTaskCommits, setPersonalTaskScope } from '../personal-tasks'

test('T-TASKS-CREATE: cache row emits only after real native write and canonical read-back', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tour-task-creation-observer-'))
  const store = new PersonalTaskPersistStore(root)
  const oldWindow = globalThis.window
  const oldStorage = globalThis.localStorage
  const cache = new Map<string, string>()
  const storage = { getItem: (key: string) => cache.get(key) ?? null, setItem: (key: string, value: string) => { cache.set(key, value) }, removeItem: (key: string) => { cache.delete(key) } }
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const api: PersonalTasksApi = {
    personalTasksList: async () => readPersonalTasks(store),
    personalTasksMigrate: async input => migratePersonalTasks(store, input),
    personalTasksDelete: async deletes => deletePersonalTasks(store, deletes),
    personalTasksPut: async (writes, meta) => { await gate; return putPersonalTasks(store, writes, meta) },
  }
  const nativeWindow = Object.assign(new EventTarget(), { electronAPI: api, setTimeout: globalThis.setTimeout })
  Object.assign(globalThis, { window: nativeWindow, localStorage: storage })
  let off: (() => void) | undefined
  try {
    setPersonalTaskScope({ authority: 'local', userId: 'isolated-local-test', workspaceId: 'fixture-workspace' })
    await hydratePersonalTasks()
    const records: VersionedPersonalTask[] = []
    let committed!: (record: VersionedPersonalTask) => void
    const completion = new Promise<VersionedPersonalTask>(resolve => { committed = resolve })
    off = subscribePersonalTaskCommits(record => { records.push(record); committed(record) })
    const next = loadPersonalTaskStore()
    const created = next.create({ id: 'native-created-task', title: 'User-owned task', list: 'inbox' })
    persistPersonalTaskStore(next)
    expect(loadPersonalTaskStore().get(created.id)).toBeDefined()
    expect(store.get(created.id)).toBeNull()
    expect(records).toEqual([])
    release()
    const record = await completion
    expect(record.task).toEqual(JSON.parse(JSON.stringify(created)))
    expect(new PersonalTaskPersistStore(root).get(created.id)).toEqual(record)
    expect(records).toHaveLength(1)
    const quickAdd = next.create({ id: 'native-confirmed-quick-add', title: 'Confirmed direct quick-add', list: 'inbox' })
    const throwingObserver = subscribePersonalTaskCommits(() => { throw new Error('Observer-only failure') })
    try { await persistPersonalTaskConfirmed(quickAdd) } finally { throwingObserver() }
    expect(records).toHaveLength(2)
    const confirmedReadback = new PersonalTaskPersistStore(root).get(quickAdd.id)
    if (!confirmedReadback) throw new Error('Confirmed quick-add must survive native restart')
    expect(records[1]).toEqual(confirmedReadback)
    // A rejected native write never becomes teaching evidence.
    const originalPut = api.personalTasksPut
    api.personalTasksPut = async () => { throw new Error('Synthetic native write denied') }
    const rejected = next.create({ id: 'native-rejected-quick-add', title: 'Never committed', list: 'inbox' })
    try { await expect(persistPersonalTaskConfirmed(rejected)).rejects.toThrow() } finally { api.personalTasksPut = originalPut }
    expect(records).toHaveLength(2)
    expect(store.get(rejected.id)).toBeNull()
  } finally {
    release()
    off?.()
    setPersonalTaskScope(null)
    Object.assign(globalThis, { window: oldWindow, localStorage: oldStorage })
    rmSync(root, { recursive: true, force: true })
  }
}, 5000)

test('canonical task linkage and learning evidence stay with their captured actor across delayed native replies', async () => {
  const rootA = mkdtempSync(join(tmpdir(), 'tour-task-scope-a-'))
  const rootB = mkdtempSync(join(tmpdir(), 'tour-task-scope-b-'))
  const storeA = new PersonalTaskPersistStore(rootA), storeB = new PersonalTaskPersistStore(rootB)
  const oldWindow = globalThis.window, oldStorage = globalThis.localStorage
  const cache = new Map<string, string>()
  const storage = { getItem: (key: string) => cache.get(key) ?? null, setItem: (key: string, value: string) => { cache.set(key, value) } }
  let currentStore = storeA
  let holdPut = false, putStarted!: () => void, releasePut!: () => void
  let deferredRead: { started: () => void; gate: Promise<void> } | null = null
  let puts = 0, lists = 0
  const gate = new Promise<void>(resolve => { releasePut = resolve })
  const started = new Promise<void>(resolve => { putStarted = resolve })
  const records: VersionedPersonalTask[] = []
  const api: PersonalTasksApi = {
    personalTasksList: async () => {
      lists++
      const store = currentStore, hold = deferredRead
      if (hold) { deferredRead = null; hold.started(); await hold.gate }
      return readPersonalTasks(store)
    },
    personalTasksPut: async (writes, meta) => {
      puts++
      const store = currentStore
      if (holdPut) { putStarted(); await gate }
      return putPersonalTasks(store, writes, meta)
    },
    personalTasksDelete: async deletes => deletePersonalTasks(currentStore, deletes),
    personalTasksMigrate: async input => migratePersonalTasks(currentStore, input),
  }
  Object.assign(globalThis, { window: Object.assign(new EventTarget(), { electronAPI: api, setTimeout: globalThis.setTimeout }), localStorage: storage })
  const off = subscribePersonalTaskCommits(record => records.push(record))
  const bind = (actor: string, store: PersonalTaskPersistStore) => {
    currentStore = store
    // Controlled renderer authority seam, not a native authorization claim.
    setPersonalTaskScope({ authority: 'native', issuer: 'isolated-test-issuer', userId: actor, workspaceId: 'same-workspace' })
  }
  try {
    bind('actor-a', storeA); await hydratePersonalTasks()
    const task = loadPersonalTaskStore().create({ id: 'scope-link', title: 'Owned A task', list: 'inbox' })
    await persistPersonalTaskConfirmed(task)
    expect(records).toHaveLength(1)
    holdPut = true
    const { persistPersonalTaskSessionLink } = await import('../personal-tasks')
    const linking = persistPersonalTaskSessionLink(task.id, 'owned-a-session').then(() => 'accepted', () => 'rejected')
    await started
    bind('actor-b', storeB); await hydratePersonalTasks()
    const listsBefore = lists
    releasePut()
    expect(await linking).toBe('rejected')
    expect(lists).toBe(listsBefore) // No final canonical read is sent to B.
    expect(storeA.get(task.id)?.task.links).toContainEqual({ kind: 'session', id: 'owned-a-session' })
    expect(storeB.get(task.id)).toBeNull()
    expect(loadPersonalTaskStore().list()).toEqual([])
    expect(records).toHaveLength(1)
    expect(puts).toBe(2)

    holdPut = false
    bind('actor-a', storeA); await hydratePersonalTasks()
    let releaseRead!: () => void, readStarted!: () => void
    const readGate = new Promise<void>(resolve => { releaseRead = resolve })
    const readBeginning = new Promise<void>(resolve => { readStarted = resolve })
    deferredRead = { started: readStarted, gate: readGate }
    const quickAdd = loadPersonalTaskStore().create({ id: 'ack-before-actor-change', title: 'Private A create', list: 'inbox' })
    const creating = persistPersonalTaskConfirmed(quickAdd)
    await readBeginning
    bind('actor-b', storeB); await hydratePersonalTasks(); releaseRead(); await creating
    expect(new PersonalTaskPersistStore(rootA).get(quickAdd.id)).not.toBeNull()
    expect(loadPersonalTaskStore().list()).toEqual([])
    expect(records).toHaveLength(1) // Old ACK plus stale read cannot teach B.
    expect([...cache.values()].filter(value => value.includes('Private A create'))).toHaveLength(1)

    const originalList = api.personalTasksList
    api.personalTasksList = async () => { throw new Error('Readback denied after durable ACK') }
    const committed = loadPersonalTaskStore().create({ id: 'ack-with-denied-readback', title: 'Committed B create', list: 'inbox' })
    try { await persistPersonalTaskConfirmed(committed) } finally { api.personalTasksList = originalList }
    expect(storeB.get(committed.id)).not.toBeNull()
    expect(loadPersonalTaskStore().get(committed.id)).toBeDefined()
    expect(records).toHaveLength(1) // Committed write succeeds without false teaching evidence.
  } finally {
    releasePut(); off(); setPersonalTaskScope(null)
    Object.assign(globalThis, { window: oldWindow, localStorage: oldStorage })
    rmSync(rootA, { recursive: true, force: true }); rmSync(rootB, { recursive: true, force: true })
  }
}, 5000)
