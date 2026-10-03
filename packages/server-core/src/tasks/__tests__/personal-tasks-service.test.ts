import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emptyBundle, type PersonalTask } from '@rox/core/tasks/personal'
import { PersonalTaskPersistStore } from '../personal-persist.ts'
import {
  deletePersonalTasks,
  migratePersonalTasks,
  putPersonalTasks,
  readPersonalTasks,
} from '../personal-tasks-service.ts'

function task(id: string, title = id, extra: Partial<PersonalTask> = {}): PersonalTask {
  return {
    id, title, notes: '', list: 'inbox', tags: [], priority: 'none', evening: false,
    links: [], order: 0, createdAt: 1, ...extra,
  }
}

function root(): string {
  return mkdtempSync(join(tmpdir(), 'rox-personal-tasks-'))
}

describe('personalTasks service (config-dir persist)', () => {
  it('migrates every localStorage task once and writes the marker last', () => {
    const store = new PersonalTaskPersistStore(root())
    const bundle = { ...emptyBundle(), tasks: [task('task-1'), task('task-2', 'b', { parentId: 'task-1' })], projects: [{ id: 'p', name: 'P', order: 0 }] }
    const first = migratePersonalTasks(store, { bundle }, 100)
    expect(first.status).toBe('migrated')
    expect(first.imported).toBe(2)
    expect(first.tasks.map((t) => t.id).sort()).toEqual(['task-1', 'task-2'])
    expect(first.meta?.projects).toEqual([{ id: 'p', name: 'P', order: 0 }])
    expect(first.migration).toMatchObject({ migratedAt: 100, imported: 2, skipped: 0, source: 'localStorage' })

    // Second run (another window / restart) is a no-op and never re-imports.
    const again = migratePersonalTasks(store, { bundle: { ...emptyBundle(), tasks: [task('task-3')] } }, 200)
    expect(again.status).toBe('already-migrated')
    expect(again.tasks.map((t) => t.id).sort()).toEqual(['task-1', 'task-2'])
  })

  it('keeps the server copy when an id already exists (no overwrite)', () => {
    const store = new PersonalTaskPersistStore(root())
    store.put(task('task-1', 'server title'))
    const result = migratePersonalTasks(store, { bundle: { ...emptyBundle(), tasks: [task('task-1', 'local title'), task('task-9')] } })
    expect(result.imported).toBe(1)
    expect(result.skipped).toBe(1)
    expect(store.get('task-1')?.task.title).toBe('server title')
  })

  it('records a quarantined cache without importing anything', () => {
    const store = new PersonalTaskPersistStore(root())
    const result = migratePersonalTasks(store, { bundle: null, quarantined: true })
    expect(result.tasks).toEqual([])
    expect(result.migration?.quarantined).toBe(true)
  })

  it('compares task writes and deletes to revisions while reporting accepted and current records', () => {
    const dir = root()
    const store = new PersonalTaskPersistStore(dir)
    const create = putPersonalTasks(store, [{ task: task('task-1'), expectedRevision: null }, { task: task('../evil'), expectedRevision: null }], { projects: [], areas: [], headings: [], audit: [{ at: 1, action: 'create' }] })
    expect(create.accepted.map((record) => record.task.id)).toEqual(['task-1'])
    expect(create.accepted[0]?.revision).toBe(1)
    expect(create.rejected).toEqual(['../evil'])
    expect(readPersonalTasks(store).revisions).toEqual({ 'task-1': 1 })
    expect(readPersonalTasks(store).meta?.audit).toHaveLength(1)

    const won = putPersonalTasks(store, [{ task: task('task-1', 'Editor A'), expectedRevision: 1 }])
    expect(won.accepted[0]?.revision).toBe(2)
    const stale = putPersonalTasks(store, [{ task: task('task-1', 'Editor B'), expectedRevision: 1 }])
    expect(stale.accepted).toEqual([])
    expect(stale.conflicts).toEqual([{ id: 'task-1', current: won.accepted[0] }])

    const deleted = deletePersonalTasks(store, [{ id: 'task-1', expectedRevision: 2 }, { id: '../x', expectedRevision: 1 }])
    expect(deleted.removed).toEqual(['task-1'])
    expect(deleted.rejected).toEqual(['../x'])
    expect(readPersonalTasks(store).tasks).toEqual([])
    expect(readdirSync(join(dir, 'personal-tasks')).filter((f) => f.endsWith('.json'))).toEqual([])
  })
})
