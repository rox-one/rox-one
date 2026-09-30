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
/** Last bundle known to match the server (null until hydrated). */
let synced: PersonalTaskBundle | null = null
let syncState: PersonalTasksSyncState = 'local'
let hydrating: Promise<void> | null = null
let unsubscribeServer: (() => void) | null = null

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

export function loadPersonalTaskStore(): PersonalTaskStore {
  if (synced) return new PersonalTaskStore(synced)
  const loaded = loadPersonalTaskCache(kv())
  loadStatus = loaded.status
  return loaded.store
}

export function persistPersonalTaskStore(store: PersonalTaskStore): void {
  persistPersonalTaskCache(kv(), store, loadStatus)
  const next = store.snapshot()
  const remote = api()
  if (synced && remote) {
    const diff = diffPersonalTaskBundles(synced, next)
    synced = next
    if (!isEmptyDiff(diff)) {
      void pushPersonalTaskDiff(remote, diff).then((ok) => {
        syncState = ok ? 'synced' : 'error'
        if (!ok) emit()
      })
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
    await putPersonalTaskConfirmed(remote, task)
    // A server push or another screen may have updated the shared store while
    // this write was in flight. Merge the acknowledged ID into the latest view.
    const latest = loadPersonalTaskStore().snapshot()
    const next = { ...latest, tasks: [...latest.tasks.filter((entry) => entry.id !== task.id), task] }
    synced = next
    persistPersonalTaskCache(kv(), new PersonalTaskStore(next), loadStatus)
    syncState = 'synced'
    emit()
  } catch (cause) {
    syncState = 'error'
    emit()
    throw cause instanceof PersonalTaskCreationError ? cause : new PersonalTaskCreationError(task, cause)
  }
}

async function refreshFromServer(remote: PersonalTasksApi): Promise<void> {
  const snapshot = await remote.personalTasksList()
  synced = bundleFromSnapshot(snapshot)
  persistPersonalTaskCache(kv(), new PersonalTaskStore(synced), loadStatus)
  syncState = 'synced'
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
      const result = await hydratePersonalTasksFrom(remote, kv())
      if (result.cacheStatus === 'quarantine') loadStatus = 'quarantine'
      synced = result.bundle
      persistPersonalTaskCache(kv(), new PersonalTaskStore(synced), loadStatus)
      syncState = 'synced'
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
