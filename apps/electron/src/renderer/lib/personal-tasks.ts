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
  type PersonalTaskKv,
} from '@rox/core/tasks/personal'
import type { PersonalTaskConflict } from '@rox/core/tasks/personal'
import type { VersionedPersonalTask } from '@rox/core/tasks/personal'
import { samePersonalTask } from '../features/product-tour/adapters/work/tasks-projects'
import { commitPersonalTaskLink, PersonalTaskLinkError } from '../features/product-tour/adapters/work/tasks-projects/native-commit'
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
} from '@rox/core/tasks/personal'

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
const nativeCommitListeners = new Set<(record: VersionedPersonalTask) => void>()

/** Canonical receipts only. Cache mutations and optimistic rows never notify. */
export function subscribePersonalTaskCommits(listener: (record: VersionedPersonalTask) => void): () => void {
  nativeCommitListeners.add(listener)
  return () => { nativeCommitListeners.delete(listener) }
}

function notifyNativeCommit(record: VersionedPersonalTask): void {
  for (const listener of nativeCommitListeners) {
    try { listener(structuredClone(record)) } catch { /* Observers cannot turn a durable commit into a write failure. */ }
  }
}

export function personalTasksNativeAvailable(): boolean { return callerScope !== null && api() !== null }

/** Read-only lifetime fence; no identity or grant is exposed to consumers. */
export function capturePersonalTaskScope(): () => boolean {
  const generation = scopeGeneration
  return () => callerScope !== null && generation === scopeGeneration
}
export interface PersonalTaskCallerScope {
  authority: 'native' | 'local'
  userId: string
  issuer?: string
  workspaceId: string | null
}
let callerScope: PersonalTaskCallerScope | null = null
let scopeGeneration = 0
let offIdentity: (() => void) | null = null
let identityGeneration = 0
let snapshotGeneration = 0

/** Invalidate before any actor/workspace transition; late replies never publish into a successor scope. */
export function setPersonalTaskScope(scope: PersonalTaskCallerScope | null): void {
  const normalized = scope && scope.userId && (scope.authority === 'local' || scope.issuer && scope.workspaceId) ? { ...scope } : null
  if (normalized && JSON.stringify(callerScope) === JSON.stringify(normalized)) return
  callerScope = normalized
  ++scopeGeneration
  unsubscribeServer?.(); unsubscribeServer = null
  if (retryTimer !== null) clearTimeout(retryTimer)
  retryTimer = null
  currentBundle = synced = null
  revisions = {}
  loadStatus = 'empty'
  syncState = normalized ? 'local' : 'syncing'
  hydrating = null
  syncConflicts = []
  emit()
  if (normalized) void hydratePersonalTasks()
}

/** A rejected switch/logout must rebind from fresh authority, never from its former cached identity. */
export async function runPersonalTaskScopeTransition<T>(
  operation: () => Promise<T>,
  isCurrent: () => boolean,
  committedScope: { authority: 'native' | 'local' | null; workspaceId: string | null } | null = callerScope,
): Promise<T> {
  const expected = committedScope ? { authority: committedScope.authority, workspaceId: committedScope.workspaceId } : null
  setPersonalTaskScope(null)
  const generation = scopeGeneration
  const current = () => generation === scopeGeneration && isCurrent()
  try {
    const result = await operation()
    if (!current()) throw new Error('Personal task transition changed')
    return result
  }
  catch (error) {
    if (current()) {
      try {
        const candidate = window.electronAPI
        const identity = await candidate.getOrgIdentity()
        if (!current()) throw new Error('Personal task transition changed')
        const workspaceId = await candidate.getWindowWorkspace()
        if (!current()) throw new Error('Personal task transition changed')
        const confirmedIdentity = await candidate.getOrgIdentity()
        if (!current() || identity.authority !== confirmedIdentity.authority || identity.userId !== confirmedIdentity.userId
          || identity.issuer !== confirmedIdentity.issuer) throw new Error('Personal task identity changed')
        const confirmedWorkspace = await candidate.getWindowWorkspace()
        if (!current() || confirmedWorkspace !== workspaceId || !expected
          || confirmedIdentity.authority !== expected.authority || confirmedWorkspace !== expected.workspaceId) throw new Error('Personal task workspace changed')
        setPersonalTaskScope({ ...confirmedIdentity, workspaceId: confirmedWorkspace })
      } catch { /* Failed fresh authority stays unavailable; no stale profile is restored. */ }
    }
    throw error
  }
}

function cacheKey(key: string): string {
  if (!callerScope) throw new Error('Personal task caller unavailable')
  return callerScope.authority === 'local' ? key : `${key}.native.${encodeURIComponent(JSON.stringify([callerScope.issuer, callerScope.userId, callerScope.workspaceId]))}`
}

function watchIdentity(): void {
  if (offIdentity || typeof window === 'undefined') return
  const candidate = window.electronAPI
  if (typeof candidate?.onIdentityChanged !== 'function' || typeof candidate.getOrgIdentity !== 'function') return
  offIdentity = candidate.onIdentityChanged(() => {
    const request = ++identityGeneration
    setPersonalTaskScope(null)
    const generation = scopeGeneration
    void (async () => {
      const identity = await candidate.getOrgIdentity()
      const workspaceId = await candidate.getWindowWorkspace()
      if (request !== identityGeneration || generation !== scopeGeneration) return
      setPersonalTaskScope({ ...identity, workspaceId })
    })().catch(() => {})
  })
}

function kv(): PersonalTaskKv {
  const generation = scopeGeneration
  return {
    getItem: key => generation === scopeGeneration && callerScope ? localStorage.getItem(cacheKey(key)) : null,
    setItem: (key, value) => { if (generation === scopeGeneration && callerScope) localStorage.setItem(cacheKey(key), value) },
  }
}

function api(): (PersonalTasksApi & { onPersonalTasksChanged?: (cb: () => void) => () => void }) | null {
  const candidate = typeof window !== 'undefined' ? (window as unknown as { electronAPI?: unknown }).electronAPI : undefined
  return isPersonalTasksApi(candidate) ? (candidate as PersonalTasksApi & { onPersonalTasksChanged?: (cb: () => void) => () => void }) : null
}

/** Fence before each transport call, including PUT→DELETE sequences, so a successor workspace is never mutated. */
function scopedApi(remote: PersonalTasksApi, generation: number): PersonalTasksApi {
  const invoke = <T>(operation: () => Promise<T>): Promise<T> => {
    if (!callerScope || generation !== scopeGeneration) return Promise.reject(new Error('Personal task caller changed'))
    return operation()
  }
  return {
    personalTasksList: () => invoke(() => remote.personalTasksList()),
    personalTasksPut: (writes, meta) => invoke(() => remote.personalTasksPut(writes, meta)),
    personalTasksDelete: deletes => invoke(() => remote.personalTasksDelete(deletes)),
    personalTasksMigrate: input => invoke(() => remote.personalTasksMigrate(input)),
  }
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
  watchIdentity()
  if (!callerScope) return new PersonalTaskStore()
  if (currentBundle) return new PersonalTaskStore(currentBundle)
  const loaded = loadPersonalTaskCache(kv())
  loadStatus = loaded.status
  currentBundle = loaded.store.snapshot()
  return loaded.store
}

export function persistPersonalTaskStore(store: PersonalTaskStore): void {
  if (!callerScope) return
  currentBundle = store.snapshot()
  persistPersonalTaskCache(kv(), store, loadStatus)
  const remote = api()
  if (synced && remote) void syncBundle(remote, currentBundle)
  emit()
}

async function syncBundle(remote: PersonalTasksApi, next: PersonalTaskBundle): Promise<void> {
  const generation = scopeGeneration
  const base = synced
  if (!base) return
  const diff = diffPersonalTaskBundles(base, next)
  if (isEmptyDiff(diff)) return
  syncState = 'syncing'
  const result = await pushPersonalTaskDiff(scopedApi(remote, generation), diff, { ...revisions })
  if (generation !== scopeGeneration) return
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
      if (generation !== scopeGeneration) return
      synced = bundleFromSnapshot(snapshot)
      revisions = snapshot.revisions
      syncState = 'synced'
      for (const accepted of result.accepted) {
        const saved = snapshot.tasks.find(task => task.id === accepted.task.id)
        if (saved && snapshot.revisions[saved.id] === accepted.revision && samePersonalTask(saved, accepted.task)) {
          notifyNativeCommit({ task: saved, revision: accepted.revision })
        }
      }
    } catch {
      if (generation !== scopeGeneration) return
      syncState = 'error'
    }
  } else {
    syncState = 'error'
    if (result.conflicts.length === 0 && result.rejected.length === 0) {
      if (retryTimer !== null) clearTimeout(retryTimer)
      retryTimer = window.setTimeout(() => {
        if (generation !== scopeGeneration) return
        retryTimer = null
        void syncBundle(remote, loadPersonalTaskStore().snapshot())
      }, 5000)
    }
  }
  emit()
}

/** Home quick-add commits to the existing cache only after native ACK. */
export async function persistPersonalTaskConfirmed(task: PersonalTask): Promise<void> {
  const generation = scopeGeneration
  const remote = api()
  if (!remote || !callerScope) throw new PersonalTaskCreationError(task, new Error('Native personal task storage unavailable'))
  syncState = 'syncing'
  try {
    const accepted = await putPersonalTaskConfirmed(scopedApi(remote, generation), task)
    if (generation !== scopeGeneration) throw new PersonalTaskCreationError(task, new Error('Personal task caller changed'))
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
    // A native ACK owns the cache update; only exact canonical read-back owns
    // learning evidence. Denied/stale reads do not turn a committed create into
    // a retryable write failure or publish into a successor actor/workspace.
    try {
      const snapshot = await scopedApi(remote, generation).personalTasksList()
      if (generation !== scopeGeneration) return
      const saved = snapshot.tasks.find(entry => entry.id === accepted.task.id)
      if (saved && snapshot.revisions[saved.id] === accepted.revision && samePersonalTask(saved, accepted.task)) {
        notifyNativeCommit({ task: saved, revision: accepted.revision })
      }
    } catch { /* The create is committed, but teaching evidence remains absent. */ }
  } catch (cause) {
    if (generation !== scopeGeneration) throw cause instanceof PersonalTaskCreationError ? cause : new PersonalTaskCreationError(task, cause)
    syncState = 'error'
    emit()
    throw cause instanceof PersonalTaskCreationError ? cause : new PersonalTaskCreationError(task, cause)
  }
}

/** Delegation waits for durable task→session linkage before submitting work. */
export async function persistPersonalTaskSessionLink(taskId: string, sessionId: string): Promise<VersionedPersonalTask> {
  const generation = scopeGeneration
  const remote = api()
  if (!remote || !callerScope) throw new PersonalTaskLinkError('write-unconfirmed')
  await hydratePersonalTasks()
  if (generation !== scopeGeneration || !callerScope) throw new PersonalTaskLinkError('write-unconfirmed')
  const latest = loadPersonalTaskStore().snapshot()
  const task = latest.tasks.find(entry => entry.id === taskId)
  if (!task) throw new PersonalTaskLinkError('write-unconfirmed')
  try {
    const accepted = await commitPersonalTaskLink(scopedApi(remote, generation), task, sessionId, revisions[taskId] ?? null)
    if (generation !== scopeGeneration || !callerScope) throw new PersonalTaskLinkError('write-unconfirmed')
    // Merge only the confirmed link if another edit arrived during the write.
    const current = loadPersonalTaskStore().snapshot()
    const local = current.tasks.find(entry => entry.id === taskId)
    if (local && samePersonalTask(local, task)) {
      currentBundle = { ...current, tasks: current.tasks.map(entry => entry.id === taskId ? accepted.task : entry) }
    } else if (local) {
      const linked = structuredClone(local)
      if (!linked.links.some(link => link.kind === 'session' && link.id === sessionId)) linked.links.push({ kind: 'session', id: sessionId })
      currentBundle = { ...current, tasks: current.tasks.map(entry => entry.id === taskId ? linked : entry) }
    }
    revisions[taskId] = accepted.revision
    if (synced) synced = { ...synced, tasks: [...synced.tasks.filter(entry => entry.id !== taskId), accepted.task] }
    if (currentBundle) persistPersonalTaskCache(kv(), new PersonalTaskStore(currentBundle), loadStatus)
    syncState = synced && currentBundle && isEmptyDiff(diffPersonalTaskBundles(synced, currentBundle)) ? 'synced' : 'syncing'
    notifyNativeCommit(accepted)
    emit()
    if (synced && currentBundle && syncState === 'syncing') void syncBundle(remote, currentBundle)
    return accepted
  } catch (error) {
    if (generation !== scopeGeneration) throw new PersonalTaskLinkError('write-unconfirmed')
    syncState = 'error'
    emit()
    throw error
  }
}

async function refreshFromServer(remote: PersonalTasksApi): Promise<void> {
  const generation = scopeGeneration
  const request = ++snapshotGeneration
  const snapshot = await remote.personalTasksList()
  if (generation !== scopeGeneration || request !== snapshotGeneration) return
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
  watchIdentity()
  if (hydrating) return hydrating
  const remote = api()
  if (!remote || !callerScope) return Promise.resolve()
  const generation = scopeGeneration
  const authority = callerScope.authority
  syncState = 'syncing'
  hydrating = (async () => {
    try {
      const cached = loadPersonalTaskStore().snapshot()
      // Native scopes never migrate a desktop-global blob, and read-only native callers can hydrate without a write grant.
      const result = authority === 'native'
        ? await remote.personalTasksList().then(snapshot => ({ bundle: bundleFromSnapshot(snapshot), revisions: snapshot.revisions, cacheStatus: 'ok' as const }))
        : await hydratePersonalTasksFrom(scopedApi(remote, generation), kv())
      if (generation !== scopeGeneration) return
      if (result.cacheStatus === 'quarantine') loadStatus = 'quarantine'
      synced = result.bundle
      let next = cached
      if (authority === 'native') {
        // A saved cache is a display hint, not authority to delete server tasks or resurrect old ones.
        // Preserve only edits made explicitly during this hydration, rebased on the fresh canonical snapshot.
        const edited = diffPersonalTaskBundles(cached, currentBundle ?? cached)
        const changedIds = new Set(edited.put.map(task => task.id))
        next = { ...synced, tasks: [...synced.tasks.filter(task => !changedIds.has(task.id) && !edited.remove.includes(task.id)), ...edited.put], ...(edited.meta ?? {}) }
      }
      const pending = diffPersonalTaskBundles(synced, next)
      revisions = result.revisions
      if (!isEmptyDiff(pending)) {
        currentBundle = next
        persistPersonalTaskCache(kv(), new PersonalTaskStore(next), loadStatus)
        syncState = 'error'
        void syncBundle(remote, next)
      } else {
        currentBundle = synced
        persistPersonalTaskCache(kv(), new PersonalTaskStore(synced), loadStatus)
        syncState = 'synced'
      }
      if (!unsubscribeServer && typeof remote.onPersonalTasksChanged === 'function') {
        unsubscribeServer = remote.onPersonalTasksChanged(() => {
          if (generation === scopeGeneration) void refreshFromServer(remote).catch(() => {})
        })
      }
    } catch {
      if (generation !== scopeGeneration) return
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
    if (callerScope && (event.key === cacheKey(PERSONAL_TASKS_STORAGE_KEY) || event.key === cacheKey(PERSONAL_TASKS_QUARANTINE_KEY))) {
      currentBundle = null
      onChange()
    }
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
