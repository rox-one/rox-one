/**
 * Personal-task reminders: while Rox runs, a task whose `reminderAt` has
 * arrived (within the last 12 h, open, not trashed) raises one system
 * notification. Fired reminders are remembered per task+time in
 * localStorage so a reload never repeats them.
 */
import { useEffect } from 'react'
import { isOpenTask, type PersonalTask } from '@craft-agent/core/tasks/personal'
import { loadPersonalTaskStore, subscribePersonalTasks } from './personal-tasks'

const FIRED_KEY = 'rox.tasks.reminders.fired.v1'
const WINDOW_MS = 12 * 60 * 60 * 1000

export function dueReminders(tasks: readonly PersonalTask[], now: number, fired: Record<string, number>): PersonalTask[] {
  return tasks.filter((task) =>
    task.reminderAt != null
    && task.reminderAt <= now
    && task.reminderAt > now - WINDOW_MS
    && isOpenTask(task)
    && fired[task.id] !== task.reminderAt,
  )
}

function readFired(): Record<string, number> {
  try {
    const raw = localStorage.getItem(FIRED_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? parsed as Record<string, number> : {}
  } catch {
    return {}
  }
}

function writeFired(fired: Record<string, number>): void {
  try {
    const entries = Object.entries(fired).slice(-500)
    localStorage.setItem(FIRED_KEY, JSON.stringify(Object.fromEntries(entries)))
  } catch { /* storage full — best effort */ }
}

export function useTaskReminders(onFire?: (task: PersonalTask) => void): void {
  useEffect(() => {
    let disposed = false
    const check = () => {
      if (disposed) return
      const fired = readFired()
      const due = dueReminders(loadPersonalTaskStore().list(), Date.now(), fired)
      if (!due.length) return
      for (const task of due) {
        fired[task.id] = task.reminderAt!
        try {
          if (typeof Notification !== 'undefined') new Notification(task.title, { body: task.notes ? task.notes.replace(/<!--[\s\S]*?-->/g, '').slice(0, 140) : undefined, silent: false })
        } catch { /* notifications unavailable */ }
        onFire?.(task)
      }
      writeFired(fired)
    }
    check()
    const timer = window.setInterval(check, 30_000)
    const off = subscribePersonalTasks(check)
    return () => {
      disposed = true
      window.clearInterval(timer)
      off()
    }
  }, [onFire])
}
