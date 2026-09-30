/**
 * Shared personal-task store used by Tasks, Projects and Notes.
 *
 * Canonical storage: server-core PersonalTaskPersistStore via personalTasks:*
 * RPC ({configDir}/personal-tasks/<id>.json). localStorage is a cache only:
 * it paints the first frame and is the one-time migration source
 * (hydratePersonalTasks → personalTasks:migrate). Corrupt JSON stays
 * quarantined; persist never overwrites the original blob.
 */

import {
  loadPersonalTaskCache,
  persistPersonalTaskCache,
  PersonalTaskStore,
  PERSONAL_TASKS_STORAGE_KEY,
  PERSONAL_TASKS_QUARANTINE_KEY,
  type PersonalTaskBundle,
  type PersonalTaskCacheLoad,
  type PersonalTask,
} from '@craft-agent/core/tasks/personal'
import type { PersonalTaskConflict } from '@craft-agent/core/tasks/personal'
import {
  bundleFromSnapshot,
  diffPersonalTaskBundles,
  hydratePersonalTasksFrom,
  isEmptyDiff,
  isPersonalTasksApi,
  pushPersonalTaskDiff,
  putPersonalTaskConfirmed,
  PersonalTaskCreationError,
  type PersonalTasksApi,
} from './personal-tasks-sync'

export {
  PERSONAL_TASKS_QUARANTINE_KEY,
  PERSONAL_TASKS_STORAGE_KEY,
} from '@craft-agent/core/tasks/personal'

export const PERSONAL_TASKS_CHANGED_EVENT = 'rox.personal-tasks.changed'

export type PersonalTasksSyncState = 'local' | 'syncing' | 'synced' | 'error'

let loadStatus: PersonalTaskCacheLoad['status'] = 'empty'
/** Last acknowledged server bundle and its per-task CAS revisions. */
let synced: PersonalTaskBundle | null = null
let currentBundle: PersonalTaskBundle | null = null
let revisions: Record<string, number> = {}
let syncState: PersonalTasksSyncState = 'local'
let hydrating: Promise<void> | null = null
let unsubscribeServer: (() => void) | null = null
let retryTimer: number | null = null
let syncConflicts: PersonalTaskConflict[] = []

function kv(): Storage {
  return localStorage
}

function api(): (PersonalTasksApi & { onPersonalTasksChanged?: (cb: () => void) => () => void }) | null {
  const candidate = typeof window !== 'undefined' ? (window as unknown as { electronAPI?: unknown }).electronAPI : undefined
  return isPersonalTasksApi(candidate) ? (candidate as PersonalTasksApi & { onPersonalTasksChanged?: (cb: () => void) => () => void }) : null
}

function emit(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(PERSONAL_TASKS_CHANGED_EVENT))
}

export function personalTasksLoadStatus(): PersonalTaskCacheLoad['status'] {
  return loadStatus
}

export function personalTasksSyncState(): PersonalTasksSyncState {
  return syncState
}
export function personalTasksSyncConflicts(): PersonalTaskConflict[] {
  return syncConflicts
}

export function resolvePersonalTaskConflict(id: string, choice: 'local' | 'server'): void {
  const conflict = syncConflicts.find((item) => item.id === id)
  if (!conflict) return
  syncConflicts = syncConflicts.filter((item) => item.id !== id)
  const current = conflict.current
  if (current) {
    revisions[id] = current.revision
    if (synced) synced = { ...synced, tasks: [...synced.tasks.filter((task) => task.id !== id), current.task] }
  } else {
    delete revisions[id]
    if (synced) synced = { ...synced, tasks: synced.tasks.filter((task) => task.id !== id) }
  }
  if (choice === 'server') {
    const snapshot = loadPersonalTaskStore().snapshot()
    const tasks = snapshot.tasks.filter((task) => task.id !== id)
    if (current) tasks.push(current.task)
    persistPersonalTaskStore(new PersonalTaskStore({ ...snapshot, tasks }))
  } else {
    syncState = 'syncing'
    const remote = api()
    if (remote && currentBundle) void syncBundle(remote, currentBundle)
  }
  emit()
}

export function loadPersonalTaskStore(): PersonalTaskStore {
  if (currentBundle) return new PersonalTaskStore(currentBundle)
  const loaded = loadPersonalTaskCache(kv())
  loadStatus = loaded.status
  currentBundle = loaded.store.snapshot()
  return loaded.store
}

export function persistPersonalTaskStore(store: PersonalTaskStore): void {
  currentBundle = store.snapshot()
  persistPersonalTaskCache(kv(), store, loadStatus)
  const remote = api()
  if (synced && remote) void syncBundle(remote, currentBundle)
  emit()
}

async function syncBundle(remote: PersonalTasksApi, next: PersonalTaskBundle): Promise<void> {
  const base = synced
  if (!base) return
  const diff = diffPersonalTaskBundles(base, next)
  if (isEmptyDiff(diff)) return
  syncState = 'syncing'
  const result = await pushPersonalTaskDiff(remote, diff, revisions)
  syncConflicts = result.conflicts
  const acceptedIds = new Set(result.accepted.map(({ task }) => task.id))
  for (const accepted of result.accepted) revisions[accepted.task.id] = accepted.revision
  for (const id of result.removed) delete revisions[id]
  if (synced) {
    const tasks = synced.tasks.filter((task) => !acceptedIds.has(task.id) && !result.removed.includes(task.id))
    synced = { ...synced, tasks: [...tasks, ...result.accepted.map(({ task }) => task)] }
  }
  for (const conflict of result.conflicts) {
    if (conflict.current) {
      revisions[conflict.id] = conflict.current.revision
      if (synced) synced = { ...synced, tasks: [...synced.tasks.filter((task) => task.id !== conflict.id), conflict.current.task] }
    } else {
      delete revisions[conflict.id]
      if (synced) synced = { ...synced, tasks: synced.tasks.filter((task) => task.id !== conflict.id) }
    }
  }
  if (syncConflicts.length > 0) syncState = 'error'
  if (result.ok) {
    try {
      const snapshot = await remote.personalTasksList()
      synced = bundleFromSnapshot(snapshot)
      revisions = snapshot.revisions
      syncState = 'synced'
    } catch {
      syncState = 'error'
    }
  } else {
    syncState = 'error'
    if (result.conflicts.length === 0 && result.rejected.length === 0) {
      if (retryTimer !== null) clearTimeout(retryTimer)
      retryTimer = window.setTimeout(() => {
        retryTimer = null
        void syncBundle(remote, loadPersonalTaskStore().snapshot())
      }, 5000)
    }
  }
  emit()
}

/** Home quick-add commits to the existing cache only after native ACK. */
export async function persistPersonalTaskConfirmed(task: PersonalTask): Promise<void> {
  const remote = api()
  if (!remote) throw new PersonalTaskCreationError(task, new Error('Native personal task storage unavailable'))
  syncState = 'syncing'
  try {
    const accepted = await putPersonalTaskConfirmed(remote, task)
    // A server push or another screen may have updated the shared store while
    // this write was in flight. Acknowledge only this ID and preserve other edits.
    const latest = loadPersonalTaskStore().snapshot()
    const next = { ...latest, tasks: [...latest.tasks.filter((entry) => entry.id !== accepted.task.id), accepted.task] }
    revisions[accepted.task.id] = accepted.revision
    if (synced) {
      synced = { ...synced, tasks: [...synced.tasks.filter((entry) => entry.id !== accepted.task.id), accepted.task] }
    }
    currentBundle = next
    persistPersonalTaskCache(kv(), new PersonalTaskStore(next), loadStatus)
    syncState = syncConflicts.length > 0 ? 'error'
      : synced && isEmptyDiff(diffPersonalTaskBundles(synced, next)) ? 'synced' : 'syncing'
    emit()
  } catch (cause) {
    syncState = 'error'
    emit()
    throw cause instanceof PersonalTaskCreationError ? cause : new PersonalTaskCreationError(task, cause)
  }
}

async function refreshFromServer(remote: PersonalTasksApi): Promise<void> {
  const snapshot = await remote.personalTasksList()
  const remoteBundle = bundleFromSnapshot(snapshot)
  const local = currentBundle ?? loadPersonalTaskStore().snapshot()
  const pending = synced ? diffPersonalTaskBundles(synced, local) : null
  synced = remoteBundle
  revisions = snapshot.revisions
  if (pending && !isEmptyDiff(pending)) {
    currentBundle = local
    persistPersonalTaskCache(kv(), new PersonalTaskStore(local), loadStatus)
    syncState = 'error'
    void syncBundle(remote, local)
  } else {
    currentBundle = remoteBundle
    persistPersonalTaskCache(kv(), new PersonalTaskStore(remoteBundle), loadStatus)
    syncState = 'synced'
  }
  emit()
}

/**
 * Idempotent: first call migrates localStorage → server once (server marker),
 * then keeps the in-memory store in sync with personalTasks:changed pushes.
 */
export function hydratePersonalTasks(): Promise<void> {
  if (hydrating) return hydrating
  const remote = api()
  if (!remote) return Promise.resolve()
  syncState = 'syncing'
  hydrating = (async () => {
    try {
      const cached = loadPersonalTaskStore().snapshot()
      const result = await hydratePersonalTasksFrom(remote, kv())
      if (result.cacheStatus === 'quarantine') loadStatus = 'quarantine'
      synced = result.bundle
      const pending = diffPersonalTaskBundles(synced, cached)
      revisions = result.revisions
      if (!isEmptyDiff(pending)) {
        currentBundle = cached
        persistPersonalTaskCache(kv(), new PersonalTaskStore(cached), loadStatus)
        syncState = 'error'
        void syncBundle(remote, cached)
      } else {
        currentBundle = synced
        persistPersonalTaskCache(kv(), new PersonalTaskStore(synced), loadStatus)
        syncState = 'synced'
      }
      if (!unsubscribeServer && typeof remote.onPersonalTasksChanged === 'function') {
        unsubscribeServer = remote.onPersonalTasksChanged(() => { void refreshFromServer(remote).catch(() => {}) })
      }
    } catch {
      // Server unavailable: keep working from the localStorage cache; retry on next mount.
      syncState = 'error'
      hydrating = null
    }
    emit()
  })()
  return hydrating
}

export function subscribePersonalTasks(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === PERSONAL_TASKS_STORAGE_KEY || event.key === PERSONAL_TASKS_QUARANTINE_KEY) onChange()
  }
  window.addEventListener(PERSONAL_TASKS_CHANGED_EVENT, onChange)
  window.addEventListener('storage', onStorage)
  void hydratePersonalTasks()
  return () => {
    window.removeEventListener(PERSONAL_TASKS_CHANGED_EVENT, onChange)
    window.removeEventListener('storage', onStorage)
  }
}

export function tasksForWorkspaceProject(store: PersonalTaskStore, projectId: string): PersonalTask[] {
  return store.list().filter((task) => task.projectId === projectId)
}
