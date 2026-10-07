import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { VersionedPersonalTask } from '@rox/core/tasks/personal'
import { NativePersonalTasksStore, type NativePersonalTaskScope } from '../../../../../../../../../../packages/server-core/src/handlers/rpc/native-personal-tasks'
import type { PersonalTasksApi } from '../../../../../../lib/personal-tasks-sync'
import { hydratePersonalTasks, loadPersonalTaskStore, persistPersonalTaskStore, subscribePersonalTaskCommits, setPersonalTaskScope } from '../../../../../../lib/personal-tasks'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'tour-task-creation-observer-'))
  const store = new NativePersonalTasksStore(root)
  const oldWindow = globalThis.window
  const oldStorage = globalThis.localStorage
  const cache = new Map<string, string>()
  const storage = { getItem: (key: string) => cache.get(key) ?? null, setItem: (key: string, value: string) => { cache.set(key, value) }, removeItem: (key: string) => { cache.delete(key) } }
  const write = deferred(), writeEntered = deferred(), readback = deferred(), readbackEntered = deferred(), writeSettled = deferred()
  let scope: NativePersonalTaskScope
  let written = false, capturedReadback = false, rejectedWrite = false
  const pending = new Set<Promise<unknown>>()
  function track<T>(operation: Promise<T>): Promise<T> {
    pending.add(operation)
    void operation.then(() => pending.delete(operation), () => pending.delete(operation))
    return operation
  }
  const assertScope = (captured: NativePersonalTaskScope) => () => {
    if (captured !== scope) throw new Error('Native caller authority changed')
  }
  const api: PersonalTasksApi = {
    personalTasksList: () => track((async () => {
      // The native read succeeds under its captured authority; only delivery is held.
      const snapshot = store.read(scope, assertScope(scope))
      if (written && !capturedReadback) {
        capturedReadback = true
        readbackEntered.resolve()
        await readback.promise
      }
      return snapshot
    })()),
    personalTasksMigrate: async input => store.migrate(scope, input, assertScope(scope)),
    personalTasksDelete: async deletes => store.delete(scope, deletes, assertScope(scope)),
    personalTasksPut: (writes, meta) => track((async () => {
      const captured = scope
      writeEntered.resolve()
      try {
        await write.promise
        const result = store.put(captured, writes, meta, assertScope(captured))
        written = true
        return result
      } catch (error) {
        rejectedWrite = true
        throw error
      } finally { writeSettled.resolve() }
    })()),
  }
  const nativeWindow = Object.assign(new EventTarget(), { electronAPI: api, setTimeout: globalThis.setTimeout })
  Object.assign(globalThis, { window: nativeWindow, localStorage: storage })
  let off: (() => void) | undefined
  try {
    setPersonalTaskScope({ authority: 'local', userId: 'isolated-local-test', workspaceId: 'fixture-workspace' })
    await hydratePersonalTasks()
    return scope
  }
  const records: VersionedPersonalTask[] = []
  let committed!: (record: VersionedPersonalTask) => void
  const completion = new Promise<VersionedPersonalTask>(resolve => { committed = resolve })
  const off = subscribePersonalTaskCommits(record => { records.push(record); committed(record) })
  return { root, store, cache, bind, records, completion, write, writeEntered, readback, readbackEntered, writeSettled,
    rejectedWrite: () => rejectedWrite,
    async drain() { await Promise.allSettled([...pending]) },
    async cleanup() {
      setPersonalTaskScope(null)
      write.resolve(); readback.resolve(); off()
      await Promise.allSettled([...pending])
      Object.assign(globalThis, { window: oldWindow, localStorage: oldStorage })
      rmSync(root, { recursive: true, force: true })
    },
  }
}

test('T-TASKS-CREATE: cache row emits only after real native write and canonical read-back', async () => {
  const f = fixture()
  try {
    const scope = await f.bind()
    const next = loadPersonalTaskStore()
    const created = next.create({ id: 'native-created-task', title: 'User-owned task', list: 'inbox' })
    persistPersonalTaskStore(next)
    expect(loadPersonalTaskStore().get(created.id)).toBeDefined()
    expect(f.store.read(scope, () => {}).tasks).toEqual([])
    expect(f.records).toEqual([])
    f.write.resolve()
    await f.readbackEntered.promise
    // A real durable PUT alone still cannot publish Learning evidence.
    expect(f.store.read(scope, () => {}).tasks[0]).toEqual(JSON.parse(JSON.stringify(created)))
    expect(f.records).toEqual([])
    f.readback.resolve()
    const record = await f.completion
    expect(record.task).toEqual(JSON.parse(JSON.stringify(created)))
    expect(new PersonalTaskPersistStore(root).get(created.id)).toEqual(record)
    expect(records).toHaveLength(1)
  } finally {
    release()
    off?.()
    setPersonalTaskScope(null)
    Object.assign(globalThis, { window: oldWindow, localStorage: oldStorage })
    rmSync(root, { recursive: true, force: true })
  }
}, 5000)
