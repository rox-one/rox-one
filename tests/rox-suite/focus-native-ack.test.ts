import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  PersonalTaskStore,
  type PersonalTask,
  type PersonalTaskKv,
  type PersonalTaskMeta,
} from '@craft-agent/core/tasks/personal'
import { PersonalTaskPersistStore } from '../../packages/server-core/src/tasks/personal-persist'
import { deletePersonalTasks, migratePersonalTasks, putPersonalTasks, readPersonalTasks } from '../../packages/server-core/src/tasks/personal-tasks-service'
import { PersonalTaskCreationError, putPersonalTaskConfirmed, pushPersonalTaskDiff, type PersonalTasksApi } from '../../apps/electron/src/renderer/lib/personal-tasks-sync'
import { createPersonalTaskConfirmed } from '../../apps/electron/src/renderer/lib/extra-screens/personal-task-bridge'
import { hydratePersonalTasks, loadPersonalTaskStore, personalTasksSyncState } from '../../apps/electron/src/renderer/lib/personal-tasks'

const directories: string[] = []
afterAll(() => { for (const directory of directories) rmSync(directory, { recursive: true, force: true }) })

function transport() {
  const directory = mkdtempSync(join(tmpdir(), 'rox-focus-native-ack-'))
  directories.push(directory)
  const store = new PersonalTaskPersistStore(directory)
  const api: PersonalTasksApi = {
    personalTasksList: async () => readPersonalTasks(store),
    personalTasksPut: async (tasks, meta) => putPersonalTasks(store, tasks, meta),
    personalTasksDelete: async (ids) => ({ removed: deletePersonalTasks(store, ids) }),
    personalTasksMigrate: async (input) => migratePersonalTasks(store, input),
  }
  return { api, store, directory }
}

function cache(): PersonalTaskKv {
  const data = new Map<string, string>()
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value) } }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

async function creationFailure(promise: Promise<unknown>): Promise<PersonalTaskCreationError> {
  try { await promise } catch (error) {
    expect(error).toBeInstanceOf(PersonalTaskCreationError)
    if (error instanceof PersonalTaskCreationError) return error
    throw error
  }
  throw new Error('Expected creation to reject')
}

describe('RS-FOCUS-01 canonical native acknowledgement', () => {
  test('a resolved native rejection fails creation and background diff sync', async () => {
    const { api, store } = transport()
    // This is an actual server validation rejection, not a throwing transport.
    const invalid = { ...new PersonalTaskStore().create({ title: 'Запрещённый ID' }), id: '../unsafe' }
    const failure = await creationFailure(putPersonalTaskConfirmed(api, invalid))
    expect(failure.task.id).toBe('../unsafe')
    expect(store.list()).toEqual([])
    expect(await pushPersonalTaskDiff(api, { put: [invalid], remove: [], meta: null })).toBe(false)
  })

  test('a zero-write receipt cannot be treated as success', async () => {
    const { api } = transport()
    const task = new PersonalTaskStore().create({ title: 'Нет подтверждения' })
    api.personalTasksPut = async () => ({ written: 0, rejected: [] })
    expect((await creationFailure(putPersonalTaskConfirmed(api, task))).task).toEqual(task)
  })

  test('the shared bridge waits, preserves failure draft identity, retries unknown ACK without duplicates, and reloads native persistence', async () => {
    const { api, store, directory } = transport()
    const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
    const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    const events = new EventTarget()
    const surface: EventTarget & { electronAPI?: PersonalTasksApi } = Object.assign(events, { electronAPI: api })
    Object.defineProperty(globalThis, 'window', { configurable: true, value: surface })
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: cache() })
    try {
      await hydratePersonalTasks()
      expect(loadPersonalTaskStore().list()).toEqual([])
      surface.electronAPI = undefined
      const unavailable = await creationFailure(createPersonalTaskConfirmed({ title: 'Нет native API', list: 'inbox' }))
      expect(unavailable.task.title).toBe('Нет native API')
      expect(loadPersonalTaskStore().list()).toEqual([])
      expect(store.list()).toEqual([])
      surface.electronAPI = api
      const ack = deferred<{ written: number; rejected: string[] }>()
      const started = deferred<PersonalTask>()
      let calls = 0
      api.personalTasksPut = async tasks => {
        calls += 1
        started.resolve(tasks[0]!)
        return ack.promise
      }
      let resolved = false
      const first = createPersonalTaskConfirmed({ title: '  Дождаться записи  ', list: 'inbox' }).then(task => { resolved = true; return task })
      const attempted = await started.promise
      expect(attempted.title).toBe('Дождаться записи')
      expect(resolved).toBe(false)
      expect(calls).toBe(1)
      expect(loadPersonalTaskStore().list()).toEqual([])
      expect(personalTasksSyncState()).toBe('syncing')
      ack.reject(new Error('connection lost before write'))
      const failed = await creationFailure(first)
      expect(failed.task).toEqual(attempted)
      expect(loadPersonalTaskStore().list()).toEqual([])
      expect(personalTasksSyncState()).toBe('error')

      // Unknown result: native storage committed, but the ACK never arrived.
      api.personalTasksPut = async (tasks, meta) => {
        putPersonalTasks(store, tasks, meta)
        throw new Error('connection lost after native commit')
      }
      const unknown = await creationFailure(createPersonalTaskConfirmed({ title: failed.task.title, list: 'inbox' }, failed.task))
      expect(unknown.task.id).toBe(attempted.id)
      expect(store.list()).toHaveLength(1)
      expect(loadPersonalTaskStore().list()).toEqual([])
      const revision = store.get(attempted.id)?.revision

      api.personalTasksPut = async (tasks: PersonalTask[], meta?: PersonalTaskMeta | null) => putPersonalTasks(store, tasks, meta)
      const confirmed = await createPersonalTaskConfirmed({ title: unknown.task.title, list: 'inbox' }, unknown.task)
      expect(confirmed.id).toBe(attempted.id)
      expect(store.list()).toHaveLength(1)
      expect(store.get(attempted.id)?.revision).toBe(revision)
      expect(loadPersonalTaskStore().list()).toEqual([confirmed])
      expect(personalTasksSyncState()).toBe('synced')
      const restartedNativeStore = new PersonalTaskPersistStore(directory)
      expect(readPersonalTasks(restartedNativeStore).tasks).toEqual([confirmed])
      // A genuinely new submission still gets its own task identity.
      const next = await createPersonalTaskConfirmed({ title: 'Следующая задача', list: 'inbox' })
      expect(next.id).not.toBe(confirmed.id)
      expect(readPersonalTasks(restartedNativeStore).tasks).toHaveLength(2)
    } finally {
      if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow)
      else Reflect.deleteProperty(globalThis, 'window')
      if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage)
      else Reflect.deleteProperty(globalThis, 'localStorage')
    }
  })
})
