import { describe, expect, it } from 'bun:test'
import {
  PERSONAL_TASKS_QUARANTINE_KEY,
  PERSONAL_TASKS_STAGING_KEY,
  PERSONAL_TASKS_STORAGE_KEY,
  PersonalTaskStore,
  emptyBundle,
  type PersonalTask,
  type PersonalTasksMigrateInput,
  type PersonalTasksSnapshot,
} from '@craft-agent/core/tasks/personal'
import {
  PERSONAL_TASKS_PRE_MIGRATION_KEY,
  diffPersonalTaskBundles,
  hydratePersonalTasksFrom,
  isEmptyDiff,
  type PersonalTasksApi,
} from '../personal-tasks-sync'

function kv(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) }
}

/** In-memory stand-in for the personalTasks:* RPC (same semantics as the server service). */
function fakeApi(initial: PersonalTasksSnapshot = { tasks: [], revisions: {}, meta: null, migration: null }) {
  const state = structuredClone(initial)
  const calls: string[] = []
  const api: PersonalTasksApi = {
    async personalTasksList() { calls.push('list'); return structuredClone(state) },
    async personalTasksPut(writes, meta) {
      calls.push('put')
      const accepted = []
      const conflicts = []
      const rejected: string[] = []
      for (const write of writes) {
        const i = state.tasks.findIndex((t) => t.id === write.task.id)
        const revision = state.revisions[write.task.id]
        if (write.expectedRevision !== (revision ?? null)) {
          conflicts.push({ id: write.task.id, current: i < 0 ? null : { task: state.tasks[i]!, revision: revision! } })
          continue
        }
        state.tasks[i < 0 ? state.tasks.length : i] = write.task
        const nextRevision = (revision ?? 0) + 1
        state.revisions[write.task.id] = nextRevision
        accepted.push({ task: write.task, revision: nextRevision })
      }
      if (meta) state.meta = meta
      return { accepted, conflicts, rejected }
    },
    async personalTasksDelete(deletes) {
      calls.push('delete')
      const removed: string[] = []
      const conflicts = []
      const rejected: string[] = []
      for (const deletion of deletes) {
        const i = state.tasks.findIndex((t) => t.id === deletion.id)
        const revision = state.revisions[deletion.id]
        if (i < 0 || revision !== deletion.expectedRevision) {
          conflicts.push({ id: deletion.id, current: i < 0 ? null : { task: state.tasks[i]!, revision: revision! } })
          continue
        }
        state.tasks.splice(i, 1)
        delete state.revisions[deletion.id]
        removed.push(deletion.id)
      }
      return { removed, conflicts, rejected }
    },
    async personalTasksMigrate(input: PersonalTasksMigrateInput) {
      calls.push('migrate')
      if (state.migration) return { ...structuredClone(state), status: 'already-migrated', imported: 0, skipped: 0 }
      let imported = 0
      for (const task of input.bundle?.tasks ?? []) {
        if (state.tasks.some((t) => t.id === task.id)) continue
        state.tasks.push(task)
        state.revisions[task.id] = 1
        imported += 1
      }
      state.migration = { migratedAt: 1, imported, skipped: 0, source: 'localStorage', ...(input.quarantined ? { quarantined: true } : {}) }
      return { ...structuredClone(state), status: 'migrated', imported, skipped: 0 }
    },
  }
  return { api, state, calls }
}

function localBundle(titles: string[]): string {
  const store = new PersonalTaskStore()
  for (const title of titles) store.create({ title })
  return store.exportJson()
}

describe('personal tasks localStorage → server migration', () => {
  it('moves Mark\'s existing tasks to the server once and backs up the raw blob', async () => {
    const raw = localBundle(['Позвонить в банк', 'Обновить README'])
    const storage = kv({ [PERSONAL_TASKS_STORAGE_KEY]: raw })
    const { api, state } = fakeApi()
    const result = await hydratePersonalTasksFrom(api, storage)
    expect(result.migrated?.status).toBe('migrated')
    expect(result.bundle.tasks.map((t) => t.title).sort()).toEqual(['Обновить README', 'Позвонить в банк'])
    expect(state.tasks).toHaveLength(2)
    expect(storage.getItem(PERSONAL_TASKS_PRE_MIGRATION_KEY)).toBe(raw)
    expect(storage.getItem(PERSONAL_TASKS_STORAGE_KEY)).toBe(raw)

    // Next launch: marker present → list only, no second migration.
    const second = await hydratePersonalTasksFrom(api, storage)
    expect(second.migrated).toBeNull()
    expect(second.bundle.tasks).toHaveLength(2)
  })

  it('never migrates a corrupt blob; it stays quarantined and staging tasks survive', async () => {
    const staging = localBundle(['Создана после сбоя'])
    const storage = kv({ [PERSONAL_TASKS_STORAGE_KEY]: '{not json', [PERSONAL_TASKS_STAGING_KEY]: staging })
    const { api, state } = fakeApi()
    const result = await hydratePersonalTasksFrom(api, storage)
    expect(result.cacheStatus).toBe('quarantine')
    expect(storage.getItem(PERSONAL_TASKS_QUARANTINE_KEY)).toBe('{not json')
    expect(storage.getItem(PERSONAL_TASKS_STORAGE_KEY)).toBe('{not json')
    expect(state.tasks.map((t) => t.title)).toEqual(['Создана после сбоя'])
    expect(state.migration?.quarantined).toBe(true)
  })

  it('an empty cache still writes the marker (fresh install)', async () => {
    const { api, state } = fakeApi()
    const result = await hydratePersonalTasksFrom(api, kv())
    expect(result.bundle.tasks).toEqual([])
    expect(state.migration).not.toBeNull()
  })
})

describe('diffPersonalTaskBundles', () => {
  const base = (tasks: PersonalTask[]) => ({ ...emptyBundle(), tasks })
  const t = (id: string, title: string): PersonalTask => ({
    id, title, notes: '', list: 'inbox', tags: [], priority: 'none', evening: false, links: [], order: 0, createdAt: 1,
  })

  it('reports changed, added and removed tasks and meta changes', () => {
    const prev = base([t('a', 'A'), t('b', 'B')])
    const next = { ...base([t('a', 'A2'), t('c', 'C')]), projects: [{ id: 'p', name: 'P', order: 0 }] }
    const diff = diffPersonalTaskBundles(prev, next)
    expect(diff.put.map((x) => x.id)).toEqual(['a', 'c'])
    expect(diff.remove).toEqual(['b'])
    expect(diff.meta?.projects).toHaveLength(1)
    expect(isEmptyDiff(diffPersonalTaskBundles(prev, prev))).toBe(true)
  })
})
