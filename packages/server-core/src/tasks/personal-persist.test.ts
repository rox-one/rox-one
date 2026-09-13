/**
 * PersonalTaskPersistStore — durable canonical personal-task KV (ROX-AUD-101 / #332).
 *
 * Renderer localStorage remains until a later unify PR. This module is the
 * server-side persist seam only: put/get/list with a real revision, idempotent
 * put by id, and restart-in-process (re-open from the same dir).
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { PersonalTask } from '@craft-agent/core/tasks/personal'
import { PersonalTaskPersistStore } from './personal-persist.ts'

let root: string
const tmpDirs: string[] = []

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'personal-persist-'))
  tmpDirs.push(root)
})

afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true })
})

function makeTask(over: Partial<PersonalTask> = {}): PersonalTask {
  return {
    id: 'task-buy-milk',
    title: 'Buy milk',
    notes: '',
    list: 'inbox',
    tags: [],
    priority: 'none',
    evening: false,
    links: [],
    order: 0,
    createdAt: 1_700_000_000_000,
    ...over,
  }
}

describe('PersonalTaskPersistStore', () => {
  it('put then get returns the same PersonalTask with a revision', () => {
    const store = new PersonalTaskPersistStore(root)
    const task = makeTask()
    const saved = store.put(task)
    expect(saved.task).toEqual(task)
    expect(typeof saved.revision).toBe('number')
    expect(saved.revision).toBeGreaterThan(0)
    expect(store.get(task.id)?.task).toEqual(task)
    expect(store.get(task.id)?.revision).toBe(saved.revision)
  })

  it('put is idempotent by id: same payload does not duplicate or bump revision', () => {
    const store = new PersonalTaskPersistStore(root)
    const first = store.put(makeTask())
    const second = store.put(makeTask())
    expect(second.revision).toBe(first.revision)
    expect(store.list()).toHaveLength(1)
    expect(store.list()[0]?.task.id).toBe('task-buy-milk')
  })

  it('put of a changed payload keeps one record and advances revision (not stuck at 1)', () => {
    const store = new PersonalTaskPersistStore(root)
    const first = store.put(makeTask({ title: 'Buy milk' }))
    const updated = store.put(makeTask({ title: 'Buy oat milk' }))
    expect(store.list()).toHaveLength(1)
    expect(updated.task.title).toBe('Buy oat milk')
    expect(updated.revision).toBeGreaterThan(first.revision)
    expect(updated.revision).not.toBe(1)
    expect(store.get('task-buy-milk')?.revision).toBe(updated.revision)
  })

  it('list returns every put record with its current revision', () => {
    const store = new PersonalTaskPersistStore(root)
    store.put(makeTask({ id: 'a', title: 'A', order: 1 }))
    store.put(makeTask({ id: 'b', title: 'B', order: 2 }))
    const listed = store.list()
    expect(listed.map((r) => r.task.id).sort()).toEqual(['a', 'b'])
    for (const record of listed) {
      expect(typeof record.revision).toBe('number')
      expect(record.revision).toBeGreaterThan(0)
    }
  })

  it('restart-in-process: re-open from the same dir yields the same records', () => {
    const store = new PersonalTaskPersistStore(root)
    const milk = store.put(makeTask({ id: 'milk', title: 'Buy milk' }))
    const eggs = store.put(makeTask({ id: 'eggs', title: 'Buy eggs' }))
    store.put(makeTask({ id: 'milk', title: 'Buy milk and bread' }))

    const reopened = new PersonalTaskPersistStore(root)
    const listed = reopened.list()
    expect(listed).toHaveLength(2)
    expect(reopened.get('eggs')?.task).toEqual(eggs.task)
    expect(reopened.get('eggs')?.revision).toBe(eggs.revision)
    const milkAgain = reopened.get('milk')
    expect(milkAgain?.task.title).toBe('Buy milk and bread')
    expect(milkAgain?.revision).toBeGreaterThan(milk.revision)
  })

  it('refuses path-unsafe ids and does not write outside the store dir', () => {
    const store = new PersonalTaskPersistStore(root)
    expect(() => store.put(makeTask({ id: '../escape' }))).toThrow(TypeError)
    expect(() => store.put(makeTask({ id: 'a/b' }))).toThrow(TypeError)
    expect(store.get('../escape')).toBeNull()
    expect(store.list()).toEqual([])
    expect(readdirSync(root).every((name) => name === 'personal-tasks' || !existsSync(join(root, name, 'escape.json')))).toBe(true)
  })

  it('skips a corrupt record file without wiping siblings', () => {
    const store = new PersonalTaskPersistStore(root)
    const good = store.put(makeTask({ id: 'good', title: 'Keep me' }))
    writeFileSync(join(store.dir, 'bad.json'), 'not json {{{', 'utf8')
    expect(store.get('good')?.task).toEqual(good.task)
    expect(store.get('bad')).toBeNull()
    expect(store.list().map((r) => r.task.id)).toEqual(['good'])
    expect(readFileSync(join(store.dir, 'bad.json'), 'utf8')).toBe('not json {{{')
  })
})
