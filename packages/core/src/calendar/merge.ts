import type { CalendarEvent, MergedTodayItem, TaskLike } from './types.ts'

const MS_DAY = 24 * 60 * 60 * 1000

function startOfLocalDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function isSameLocalDay(ts: number, now: number): boolean {
  return startOfLocalDay(ts) === startOfLocalDay(now)
}

export function eventOverlapsLocalDay(event: CalendarEvent, now: number): boolean {
  if (event.deleted) return false
  const start = startOfLocalDay(now)
  const end = start + MS_DAY
  return event.startAt < end && event.endAt > start
}

export function mergeTodayUpcoming(
  tasks: readonly TaskLike[],
  events: readonly CalendarEvent[],
  now: number,
): MergedTodayItem[] {
  const items: MergedTodayItem[] = []
  for (const task of tasks) {
    if (task.completedAt != null) continue
    const today = task.list === 'today' || (task.dueAt != null && (isSameLocalDay(task.dueAt, now) || task.dueAt < startOfLocalDay(now)))
    const upcoming = task.list === 'upcoming' || (task.dueAt != null && task.dueAt >= startOfLocalDay(now) + MS_DAY)
    if (!today && !upcoming) continue
    items.push({ kind: 'task', id: task.id, title: task.title, at: task.dueAt, projectId: task.projectId, task })
  }
  for (const event of events) {
    if (!eventOverlapsLocalDay(event, now) && event.startAt < startOfLocalDay(now) + 14 * MS_DAY && event.startAt >= startOfLocalDay(now) + MS_DAY) {
      items.push({ kind: 'event', id: event.id, title: event.title, at: event.startAt, event })
      continue
    }
    if (eventOverlapsLocalDay(event, now)) {
      items.push({ kind: 'event', id: event.id, title: event.title, at: event.startAt, event })
    }
  }
  return items.sort((a, b) => (a.at ?? Number.MAX_SAFE_INTEGER) - (b.at ?? Number.MAX_SAFE_INTEGER))
}

export function timezoneWarnings(events: readonly CalendarEvent[], localTimeZone: string): CalendarEvent[] {
  return events.filter((event) => !event.deleted && event.timeZone !== localTimeZone)
}
