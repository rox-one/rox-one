/**
 * Shared personal-task cache used by Tasks and Projects.
 * Workspace project ids are assigned on tasks; this store is calendar-independent.
 * Corrupt JSON is quarantined; persist never overwrites the original blob.
 */

import {
  loadPersonalTaskCache,
  persistPersonalTaskCache,
  PERSONAL_TASKS_STORAGE_KEY,
  PERSONAL_TASKS_QUARANTINE_KEY,
  type PersonalTaskCacheLoad,
  type PersonalTask,
  type PersonalTaskStore,
} from '@craft-agent/core/tasks/personal'

export {
  PERSONAL_TASKS_QUARANTINE_KEY,
  PERSONAL_TASKS_STORAGE_KEY,
} from '@craft-agent/core/tasks/personal'

export const PERSONAL_TASKS_CHANGED_EVENT = 'rox.personal-tasks.changed'

let loadStatus: PersonalTaskCacheLoad['status'] = 'empty'

function kv(): Storage {
  return localStorage
}

export function personalTasksLoadStatus(): PersonalTaskCacheLoad['status'] {
  return loadStatus
}

export function loadPersonalTaskStore(): PersonalTaskStore {
  const loaded = loadPersonalTaskCache(kv())
  loadStatus = loaded.status
  return loaded.store
}

export function persistPersonalTaskStore(store: PersonalTaskStore): void {
  persistPersonalTaskCache(kv(), store, loadStatus)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(PERSONAL_TASKS_CHANGED_EVENT))
  }
}

export function subscribePersonalTasks(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === PERSONAL_TASKS_STORAGE_KEY || event.key === PERSONAL_TASKS_QUARANTINE_KEY) onChange()
  }
  window.addEventListener(PERSONAL_TASKS_CHANGED_EVENT, onChange)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(PERSONAL_TASKS_CHANGED_EVENT, onChange)
    window.removeEventListener('storage', onStorage)
  }
}

export function tasksForWorkspaceProject(store: PersonalTaskStore, projectId: string): PersonalTask[] {
  return store.list().filter((task) => task.projectId === projectId)
}
