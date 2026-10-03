import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { VersionedPersonalTask } from '@rox/core/tasks/personal'
import { PersonalTaskPersistStore } from '../../../../../../../../../../packages/server-core/src/tasks/personal-persist'
import { deletePersonalTasks, migratePersonalTasks, putPersonalTasks, readPersonalTasks } from '../../../../../../../../../../packages/server-core/src/tasks/personal-tasks-service'
import type { PersonalTasksApi } from '../../../../../../lib/personal-tasks-sync'
import { hydratePersonalTasks, loadPersonalTaskStore, persistPersonalTaskStore, subscribePersonalTaskCommits } from '../../../../../../lib/personal-tasks'

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
  } finally {
    release()
    off?.()
    Object.assign(globalThis, { window: oldWindow, localStorage: oldStorage })
    rmSync(root, { recursive: true, force: true })
  }
}, 5000)
