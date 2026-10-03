/**
 * Thin bridge to personal tasks for the extra screens. Today personal tasks
 * live in the renderer store (`lib/personal-tasks`); when the `personalTasks:*`
 * IPC lands this is the single place to switch.
 */
import type { PersonalTask } from '@craft-agent/core/tasks/personal'
import { PersonalTaskStore } from '@craft-agent/core/tasks/personal'
import { loadPersonalTaskStore, persistPersonalTaskStore, persistPersonalTaskConfirmed } from '../personal-tasks'

export function listPersonalTasks(): PersonalTask[] {
  try {
    return loadPersonalTaskStore().list()
  } catch {
    return []
  }
}

export function createPersonalTask(input: { title: string; notes?: string; list?: 'inbox' | 'today' }): PersonalTask {
  const store = PersonalTaskStore.fromJson(loadPersonalTaskStore().exportJson())
  const task = store.create({ title: input.title, list: input.list ?? 'inbox' })
  const withNotes = input.notes ? store.update(task.id, { notes: input.notes }) : task
  persistPersonalTaskStore(store)
  return withNotes
}

/** Await the native receipt; reuse the attempted ID when its result was unknown. */
export async function createPersonalTaskConfirmed(
  input: { title: string; notes?: string; list?: 'inbox' | 'today' },
  previousAttempt?: PersonalTask,
): Promise<PersonalTask> {
  const title = input.title.trim()
  if (!title) throw new Error('Task title is required')
  const task = previousAttempt
    ? { ...previousAttempt, title, notes: input.notes ?? previousAttempt.notes, list: input.list ?? previousAttempt.list }
    : loadPersonalTaskStore().create({ title, notes: input.notes, list: input.list ?? 'inbox' })
  await persistPersonalTaskConfirmed(task)
  return task
}

export function isTaskOpen(task: PersonalTask): boolean {
  return !task.completedAt && !task.cancelledAt
}
