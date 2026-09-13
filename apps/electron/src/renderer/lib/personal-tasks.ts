/**
 * Shared personal-task cache used by Tasks and Projects.
 * Workspace project ids are assigned on tasks; this store is calendar-independent.
 */

import { PersonalTaskStore, type PersonalTask } from '@craft-agent/core/tasks/personal'

export const PERSONAL_TASKS_STORAGE_KEY = 'rox.personal-tasks.v1'
export const PERSONAL_TASKS_CHANGED_EVENT = 'rox.personal-tasks.changed'

export function loadPersonalTaskStore(): PersonalTaskStore {
  try {
    const raw = localStorage.getItem(PERSONAL_TASKS_STORAGE_KEY)
    if (raw) return PersonalTaskStore.fromJson(raw)
  } catch {
    // Corrupt local cache — start empty; import remains available.
  }
  return new PersonalTaskStore()
}

export function persistPersonalTaskStore(store: PersonalTaskStore): void {
  localStorage.setItem(PERSONAL_TASKS_STORAGE_KEY, store.exportJson())
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(PERSONAL_TASKS_CHANGED_EVENT))
  }
}

export function subscribePersonalTasks(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === PERSONAL_TASKS_STORAGE_KEY) onChange()
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
