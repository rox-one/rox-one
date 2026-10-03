import { useEffect } from 'react'
/** Durable local OS presentation for the canonical personal-task reminder. */
import { isOpenTask, PersonalTaskStore, PERSONAL_TASKS_STORAGE_KEY, type PersonalTask } from '@craft-agent/core/tasks/personal'
import { loadPersonalTaskStore, persistPersonalTaskStore, subscribePersonalTasks } from './personal-tasks'


function currentTaskStore(): PersonalTaskStore {
  try {
    const raw = localStorage.getItem(PERSONAL_TASKS_STORAGE_KEY)
    if (raw) {
      const parsed = PersonalTaskStore.tryFromJson(raw)
      if (parsed.status === 'ok') return parsed.store
    }
  } catch { /* use the last hydrated store when local cache is unavailable */ }
  return loadPersonalTaskStore()
}
const RETRY_DELAY_MS = 5 * 60 * 1000
const PRESENTATION_TIMEOUT_MS = 30_000
type Failure = NonNullable<PersonalTask['reminderError']>
type DeferUntil = (task: PersonalTask, now: number) => number | null

export function dueReminders(tasks: readonly PersonalTask[], now: number): PersonalTask[] {
  return tasks.filter((task) =>
    task.reminderAt != null
    && task.reminderAt <= now
    && isOpenTask(task)
    && task.reminderDeliveredFor !== task.reminderAt
    && (task.reminderRetryAt == null || task.reminderRetryAt <= now),
  )
}

function updateReminder(taskId: string, reminderAt: number, patch: Partial<PersonalTask>): void {
  const store = currentTaskStore()
  const latest = store.get(taskId)
  if (!latest || latest.reminderAt !== reminderAt || !isOpenTask(latest)) return
  store.update(taskId, patch)
  persistPersonalTaskStore(store)
}

export function snoozeTaskReminder(taskId: string, now = Date.now(), durationMs = 10 * 60 * 1000): boolean {
  if (!Number.isFinite(now) || !Number.isFinite(durationMs) || durationMs <= 0) return false
  const store = currentTaskStore()
  const task = store.get(taskId)
  if (!task || task.reminderAt == null || !isOpenTask(task)) return false
  store.update(taskId, {
    reminderAt: now + durationMs,
    reminderDeliveredFor: undefined,
    reminderRetryAt: undefined,
    reminderError: undefined,
  })
  persistPersonalTaskStore(store)
  return true
}

type ReminderLockManager = {
  request<T>(name: string, options: { ifAvailable: boolean }, callback: (lock: unknown | null) => Promise<T>): Promise<T>
}

function lockManager(): ReminderLockManager | undefined {
  return (navigator as Navigator & { locks?: ReminderLockManager }).locks
}

function recordFailure(task: PersonalTask, failure: Failure, now: number, onFailure?: (task: PersonalTask, failure: Failure) => void): void {
  updateReminder(task.id, task.reminderAt!, {
    reminderError: failure,
    reminderRetryAt: now + RETRY_DELAY_MS,
  })
  onFailure?.(task, failure)
}

async function present(task: PersonalTask, onFire?: (task: PersonalTask) => void, onFailure?: (task: PersonalTask, failure: Failure) => void): Promise<void> {
  const reminderAt = task.reminderAt!
  const locks = lockManager()
  if (!locks) {
    recordFailure(task, 'presentation-failed', Date.now(), onFailure)
    return
  }
  try {
    await locks.request(`rox.personal-task.reminder:${task.id}:${reminderAt}`, { ifAvailable: true }, async (lock) => {
    if (!lock) return
    const store = currentTaskStore()
    const latest = store.get(task.id)
    if (!latest || latest.reminderAt !== reminderAt || !isOpenTask(latest) || latest.reminderDeliveredFor === reminderAt) return
    if (typeof Notification === 'undefined') {
      recordFailure(latest, 'presentation-failed', Date.now(), onFailure)
      return
    }
    if (Notification.permission !== 'granted') {
      recordFailure(latest, Notification.permission === 'denied' ? 'permission-denied' : 'permission-required', Date.now(), onFailure)
      return
    }
    try {
      const notification = new Notification(latest.title, {
        body: latest.notes ? latest.notes.replace(/<!--[\s\S]*?-->/g, '').slice(0, 140) : undefined,
        silent: false,
      })
      await new Promise<void>((resolve) => {
        let settled = false
        const finish = () => {
          if (settled) return
          settled = true
          window.clearTimeout(timeout)
          resolve()
        }
        const timeout = window.setTimeout(() => {
          recordFailure(latest, 'presentation-failed', Date.now(), onFailure)
          finish()
        }, PRESENTATION_TIMEOUT_MS)
        notification.addEventListener('show', () => {
          updateReminder(latest.id, reminderAt, {
            reminderDeliveredFor: reminderAt,
            reminderRetryAt: undefined,
            reminderError: undefined,
          })
          onFire?.(latest)
          finish()
        }, { once: true })
        notification.addEventListener('error', () => {
          recordFailure(latest, 'presentation-failed', Date.now(), onFailure)
          finish()
        }, { once: true })
      })
    } catch {
      recordFailure(latest, 'presentation-failed', Date.now(), onFailure)
    }
    })
  } catch {
    recordFailure(task, 'presentation-failed', Date.now(), onFailure)
  }
}

export function useTaskReminders(
  onFire?: (task: PersonalTask) => void,
  onFailure?: (task: PersonalTask, failure: Failure) => void,
  deferUntil?: DeferUntil,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled) return
    let disposed = false
    const check = () => {
      if (disposed) return
      const now = Date.now()
      const due = dueReminders(currentTaskStore().list(), now)
      for (const task of due) {
        const deferredUntil = deferUntil?.(task, now)
        if (deferredUntil != null && Number.isFinite(deferredUntil) && deferredUntil > now) {
          updateReminder(task.id, task.reminderAt!, { reminderRetryAt: deferredUntil, reminderError: undefined })
          continue
        }
        void present(task, onFire, onFailure)
      }
    }
    check()
    const timer = window.setInterval(check, 30_000)
    const off = subscribePersonalTasks(check)
    return () => {
      disposed = true
      window.clearInterval(timer)
      off()
    }
  }, [onFire, onFailure, deferUntil, enabled])
}
