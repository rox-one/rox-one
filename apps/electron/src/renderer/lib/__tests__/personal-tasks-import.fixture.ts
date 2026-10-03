import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PersonalTaskStore, type PersonalTask, type PersonalTaskPutResult } from '@rox/core/tasks/personal'
import { PersonalTaskPersistStore } from '../../../../../../packages/server-core/src/tasks/personal-persist'
import { capturePersonalTaskScope, hydratePersonalTasks, importPersonalTasksConfirmed, loadPersonalTaskStore, persistPersonalTaskStore, setPersonalTaskScope } from '../personal-tasks'
import type { PersonalTasksApi } from '../personal-tasks-sync'
const priorWindow = globalThis.window, priorStorage = globalThis.localStorage
let directory: string, native: PersonalTaskPersistStore
const events = new EventTarget(), cache = new Map<string, string>(), calls: string[] = []
let actor = 'alice', held: (() => void) | null = null, hold = false, denied = false, wrongReceipt = false, readbackDenied = false
let listCount = 0
let holdNextList = false, heldList: (() => void) | null = null
const watchers = new Set<() => void>()
const task = (id: string, title = id): PersonalTask => ({ id, title, notes: '', list: 'inbox', tags: [], priority: 'none', evening: false, links: [], order: 0, createdAt: 1 })
const api: PersonalTasksApi & { onPersonalTasksChanged(callback: () => void): () => void } = {
  async personalTasksList() {
    calls.push(`list:${actor}`)
    if (readbackDenied && ++listCount >= 3) throw new Error('Synthetic readback denied')
    if (!readbackDenied) listCount++
    const records = native.list()
    const snapshot = { tasks: records.map(row => row.task), revisions: Object.fromEntries(records.map(row => [row.task.id, row.revision])), meta: native.readMeta(), migration: null }
    if (holdNextList) { holdNextList = false; await new Promise<void>(resolve => { heldList = resolve }) }
    return snapshot
  },
  async personalTasksPut(writes, meta) {
    calls.push(`put:${actor}`)
    if (denied) throw new Error('Synthetic write denied')
    const result: PersonalTaskPutResult = { accepted: [], conflicts: [], rejected: [] }
    for (const write of writes) {
      const receipt = native.putIfRevision(write)
      if (receipt.status === 'accepted') result.accepted.push(receipt.record)
      else result.conflicts.push({ id: write.task.id, current: receipt.current })
    }
    if (meta) native.writeMeta(meta)
    for (const notify of watchers) notify()
    if (hold) await new Promise<void>(resolve => { held = resolve })
    if (wrongReceipt && result.accepted[0]) result.accepted[0].task.title = 'Forged receipt'
    return result
  },
  async personalTasksDelete(deletes) {
    calls.push(`delete:${actor}`)
    const removed: string[] = [], conflicts = []
    for (const remove of deletes) {
      const result = native.deleteIfRevision(remove.id, remove.expectedRevision)
      if (result.status === 'removed') removed.push(remove.id)
      else conflicts.push({ id: remove.id, current: result.current })
    }
    return { removed, conflicts, rejected: [] }
  },
  async personalTasksMigrate() { throw new Error('Native imports must not migrate a desktop cache') },
  onPersonalTasksChanged(callback) { watchers.add(callback); return () => watchers.delete(callback) },
}
Object.assign(events, { electronAPI: api, setTimeout: globalThis.setTimeout.bind(globalThis), clearTimeout: globalThis.clearTimeout.bind(globalThis) })
const bind = (name = 'alice') => { actor = name; setPersonalTaskScope({ authority: 'native', userId: name, issuer: 'test-authority', workspaceId: 'ws-a' }) }
const settle = async () => { for (let n = 0; n < 15; n++) await Promise.resolve() }
const incoming = (...tasks: PersonalTask[]) => new PersonalTaskStore({ version: 1, tasks, projects: [], areas: [], headings: [], audit: [] }).snapshot()
beforeEach(async () => {
  Object.defineProperty(globalThis, 'window', { value: events, configurable: true })
  Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (key: string) => cache.get(key) ?? null, setItem: (key: string, value: string) => cache.set(key, value) }, configurable: true })
  setPersonalTaskScope(null); cache.clear(); watchers.clear(); calls.length = 0
  directory = mkdtempSync(join(tmpdir(), 'rox-confirmed-task-import-')); native = new PersonalTaskPersistStore(directory)
  held = heldList = null; holdNextList = false; hold = denied = wrongReceipt = readbackDenied = false; listCount = 0
  native.put(task('original')); bind(); await hydratePersonalTasks()
})
afterEach(() => { setPersonalTaskScope(null); rmSync(directory, { recursive: true, force: true }) })
afterAll(() => { Object.defineProperty(globalThis, 'window', { value: priorWindow, configurable: true }); Object.defineProperty(globalThis, 'localStorage', { value: priorStorage, configurable: true }) })
test('confirmed import persists through the actual native store and restart without a cache migration', async () => {
  await importPersonalTasksConfirmed(incoming(task('imported')), capturePersonalTaskScope())
  expect(loadPersonalTaskStore().list().map(row => row.id).sort()).toEqual(['imported', 'original'])
  expect(new PersonalTaskPersistStore(directory).get('imported')?.task).toEqual(task('imported'))
  expect(calls.filter(call => call.startsWith('put'))).toEqual(['put:alice'])
})
test('mid-ACK local edits and a synchronous native push survive the committed import', async () => {
  hold = true
  const result = importPersonalTasksConfirmed(incoming(task('imported')), capturePersonalTaskScope())
  await settle(); expect(held).not.toBeNull()
  const edited = loadPersonalTaskStore(); edited.update('original', { title: 'Edited during ACK' }); edited.create({ title: 'Created during ACK' }); persistPersonalTaskStore(edited)
  expect(calls.filter(call => call.startsWith('put'))).toHaveLength(1)
  hold = false; held!(); await result; await settle()
  const rows = loadPersonalTaskStore().list()
  expect(rows.find(row => row.id === 'original')?.title).toBe('Edited during ACK')
  expect(rows.some(row => row.title === 'Created during ACK')).toBe(true)
  expect(rows.some(row => row.id === 'imported')).toBe(true)
  expect(new PersonalTaskPersistStore(directory).get('imported')).not.toBeNull()
})
test('denied native commit rejects import without publishing imported cache content', async () => {
  denied = true
  await expect(importPersonalTasksConfirmed(incoming(task('imported')), capturePersonalTaskScope())).rejects.toThrow()
  await settle()
  expect(loadPersonalTaskStore().get('imported')).toBeUndefined()
  expect(new PersonalTaskPersistStore(directory).get('imported')).toBeNull()
})
test('forged successful receipt is rejected even when the actual task was written', async () => {
  wrongReceipt = true
  await expect(importPersonalTasksConfirmed(incoming(task('imported')), capturePersonalTaskScope())).rejects.toThrow('not confirmed')
  expect(new PersonalTaskPersistStore(directory).get('imported')?.task.title).toBe('imported')
})
test('write ACK alone cannot report a verified import when readback is denied', async () => {
  readbackDenied = true
  await expect(importPersonalTasksConfirmed(incoming(task('imported')), capturePersonalTaskScope())).rejects.toThrow('readback denied')
  expect(new PersonalTaskPersistStore(directory).get('imported')).not.toBeNull()
  expect(loadPersonalTaskStore().get('imported')).toBeUndefined()
})
test('actor ABA discards the first import response and forbids further old-scope reads', async () => {
  hold = true
  const result = importPersonalTasksConfirmed(incoming(task('imported')), capturePersonalTaskScope()).then(() => 'accepted', () => 'rejected')
  await settle(); expect(held).not.toBeNull()
  bind('bob'); await hydratePersonalTasks(); bind(); await hydratePersonalTasks()
  const count = calls.length; held!()
  expect(await result).toBe('rejected'); expect(calls).toHaveLength(count)
})
test('lost panel ownership during an in-flight commit prevents a following readback', async () => {
  let owner = true; hold = true
  const result = importPersonalTasksConfirmed(incoming(task('imported')), () => owner).then(() => 'accepted', () => 'rejected')
  await settle(); owner = false; const count = calls.length; held!()
  expect(await result).toBe('rejected'); expect(calls).toHaveLength(count)
})
test('one active import refuses a second writer before it opens a transport', async () => {
  hold = true
  const first = importPersonalTasksConfirmed(incoming(task('first')), capturePersonalTaskScope())
  await settle(); const count = calls.length
  await expect(importPersonalTasksConfirmed(incoming(task('second')), capturePersonalTaskScope())).rejects.toThrow('unavailable')
  expect(calls).toHaveLength(count); hold = false; held!(); await first
  expect(new PersonalTaskPersistStore(directory).get('second')).toBeNull()
})

test('an earlier native refresh cannot publish its captured snapshot across a confirmed import', async () => {
  holdNextList = true
  for (const notify of watchers) notify()
  await settle(); expect(heldList).not.toBeNull()
  const result = importPersonalTasksConfirmed(incoming(task('imported')), capturePersonalTaskScope())
  await settle()
  try { expect(calls.filter(call => call.startsWith('put'))).toHaveLength(0) }
  finally { heldList!(); await result }
  await settle()
  expect(loadPersonalTaskStore().get('imported')?.title).toBe('imported')
  expect(new PersonalTaskPersistStore(directory).get('imported')?.task.title).toBe('imported')
})
test('confirmed import drains a preceding native write ACK before its own snapshot and transport', async () => {
  hold = true
  const edited = loadPersonalTaskStore(); edited.update('original', { title: 'Earlier background edit' }); persistPersonalTaskStore(edited)
  await settle(); expect(held).not.toBeNull()
  hold = false
  const result = importPersonalTasksConfirmed(incoming(task('imported')), capturePersonalTaskScope())
  await settle()
  try { expect(calls.filter(call => call.startsWith('put'))).toHaveLength(1) }
  finally { held!(); await result }
  await settle()
  expect(loadPersonalTaskStore().get('original')?.title).toBe('Earlier background edit')
  expect(loadPersonalTaskStore().get('imported')?.title).toBe('imported')
  expect(new PersonalTaskPersistStore(directory).get('imported')?.task.title).toBe('imported')
})
