import { isOpenTask, type PersonalTask, type TaskFilterId, type TaskPriority, type TaskProjectionId, type TaskSortId } from './types.ts'
import { localDayKey, startOfLocalDay } from './dates.ts'

const MS_DAY = 24 * 60 * 60 * 1000

const PRIORITY_RANK: Record<TaskPriority, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
}

export function projectTasks(tasks: readonly PersonalTask[], now: number, projection: TaskProjectionId): PersonalTask[] {
  return tasks.filter((task) => matchesProjection(task, now, projection)).sort(compareTaskOrder)
}

export function tasksForProject(tasks: readonly PersonalTask[], projectId: string): PersonalTask[] {
  return tasks.filter((task) => task.projectId === projectId).sort(compareTaskOrder)
}

export function filterAndSortTasks(
  tasks: readonly PersonalTask[],
  now: number,
  opts: { filter: TaskFilterId; projectId?: string | null; sort?: TaskSortId },
): PersonalTask[] {
  const filtered = tasks.filter((task) => {
    if (opts.projectId && task.projectId !== opts.projectId) return false
    return matchesFilter(task, now, opts.filter)
  })
  return sortTasks(filtered, opts.sort ?? 'order')
}

export function matchesFilter(task: PersonalTask, now: number, filter: TaskFilterId): boolean {
  if (filter === 'all') return isOpenTask(task)
  return matchesProjection(task, now, filter)
}

export function matchesProjection(task: PersonalTask, now: number, projection: TaskProjectionId): boolean {
  if (projection === 'trash') return task.trashedAt != null
  if (task.trashedAt != null) return false
  if (projection === 'logbook') return task.completedAt != null || task.cancelledAt != null
  if (!isOpenTask(task)) return false
  switch (projection) {
    case 'inbox':
      return task.list === 'inbox' && !isFutureStart(task, now)
    case 'today':
      return isTodayTask(task, now)
    case 'upcoming':
      return isUpcomingTask(task, now)
    case 'anytime':
      return isAnytimeTask(task, now)
    case 'someday':
      return task.list === 'someday' && !isFutureStart(task, now)
    default: {
      const _never: never = projection
      return _never
    }
  }
}

function endOfLocalToday(now: number): number {
  return startOfLocalDay(now) + MS_DAY
}

/** Start date («Когда») lies on a later local day. */
export function isFutureStart(task: PersonalTask, now: number): boolean {
  return task.startAt != null && task.startAt >= endOfLocalToday(now)
}

export function isTodayTask(task: PersonalTask, now: number): boolean {
  if (!isOpenTask(task)) return false
  if (task.list === 'someday' && task.startAt == null) return false
  if (isFutureStart(task, now)) {
    // A deadline that already arrived still pulls the task into Today.
    return task.dueAt != null && task.dueAt < endOfLocalToday(now)
  }
  if (task.list === 'today') return true
  if (task.startAt != null) return true // start date reached (today or earlier)
  if (task.dueAt != null && task.dueAt < endOfLocalToday(now)) return true
  return false
}

export function isUpcomingTask(task: PersonalTask, now: number): boolean {
  if (!isOpenTask(task)) return false
  if (isFutureStart(task, now)) return true
  if (task.startAt != null) return false
  if (task.dueAt != null && task.dueAt >= endOfLocalToday(now)) return true
  return task.list === 'upcoming' && task.dueAt == null
}

/** Things «В любое время»: active tasks that are not waiting for a start date (includes Today). */
export function isAnytimeTask(task: PersonalTask, now: number): boolean {
  if (!isOpenTask(task)) return false
  if (isFutureStart(task, now)) return false
  if (task.list === 'anytime') return true
  if (task.list === 'today') return true
  return false
}

/** Local calendar day used for the Plans view and calendars: start date, else deadline. */
export function taskCalendarAt(task: PersonalTask): number | undefined {
  return task.startAt ?? task.dueAt
}

export interface UpcomingDay {
  /** YYYY-MM-DD */
  key: string
  /** Local midnight of that day. */
  at: number
  tasks: PersonalTask[]
}

/**
 * Plans («Планы»): the next `days` local days one by one (empty days kept so
 * the view reads like a calendar), then everything later grouped by month.
 */
export function upcomingByDay(
  tasks: readonly PersonalTask[],
  now: number,
  days = 7,
): { days: UpcomingDay[]; later: UpcomingDay[] } {
  const start = startOfLocalDay(now) + MS_DAY
  const list = tasks.filter((task) => !task.parentId && isUpcomingTask(task, now))
  const byDay: UpcomingDay[] = []
  for (let i = 0; i < days; i += 1) {
    const at = startOfLocalDay(start + i * MS_DAY + 3600000)
    byDay.push({ key: localDayKey(at), at, tasks: [] })
  }
  const index = new Map(byDay.map((day) => [day.key, day]))
  const later = new Map<string, UpcomingDay>()
  const undated: PersonalTask[] = []
  for (const task of list) {
    const at = taskCalendarAt(task)
    if (at == null) {
      undated.push(task)
      continue
    }
    const key = localDayKey(at)
    const slot = index.get(key)
    if (slot) {
      slot.tasks.push(task)
      continue
    }
    const d = new Date(at)
    const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const bucket = later.get(monthKey) ?? { key: monthKey, at: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), tasks: [] }
    bucket.tasks.push(task)
    later.set(monthKey, bucket)
  }
  for (const day of byDay) day.tasks.sort(compareCalendar)
  const laterList = [...later.values()].sort((a, b) => a.at - b.at)
  for (const bucket of laterList) bucket.tasks.sort(compareCalendar)
  if (undated.length) laterList.push({ key: 'undated', at: Number.POSITIVE_INFINITY, tasks: undated.sort(compareTaskOrder) })
  return { days: byDay, later: laterList }
}

function compareCalendar(a: PersonalTask, b: PersonalTask): number {
  const aa = taskCalendarAt(a) ?? 0
  const bb = taskCalendarAt(b) ?? 0
  if (startOfLocalDay(aa) !== startOfLocalDay(bb)) return aa - bb
  return compareTaskOrder(a, b)
}

/** Top-level progress of a project for the pie: done = completed (not cancelled), total excludes trash. */
export function projectProgress(tasks: readonly PersonalTask[], projectId: string): { done: number; total: number; open: number } {
  let done = 0
  let total = 0
  let open = 0
  for (const task of tasks) {
    if (task.projectId !== projectId || task.parentId || task.trashedAt != null) continue
    total += 1
    if (task.completedAt != null) done += 1
    else if (task.cancelledAt == null) open += 1
  }
  return { done, total, open }
}

/** Distinct tags across tasks, most used first. */
export function allTaskTags(tasks: readonly PersonalTask[]): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>()
  for (const task of tasks) {
    if (task.trashedAt != null) continue
    for (const tag of task.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

/** Case-insensitive search over title, notes, tags and checklist lines. */
export function matchesTaskSearch(task: PersonalTask, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const words = q.split(/\s+/)
  const hay = [task.title, task.notes, task.tags.map((tag) => `#${tag}`).join(' '), (task.checklist ?? []).map((item) => item.title).join(' ')]
    .join(' ')
    .toLowerCase()
  return words.every((word) => hay.includes(word))
}

export type TodayBucket = 'overdue' | 'morning' | 'afternoon' | 'evening' | 'allDay' | 'unscheduled'

export interface TodayPlanGroup {
  bucket: TodayBucket
  projectId?: string
  tasks: PersonalTask[]
}

export function buildTodayPlan(tasks: readonly PersonalTask[], now: number): TodayPlanGroup[] {
  const today = projectTasks(tasks, now, 'today')
  const buckets: Record<TodayBucket, PersonalTask[]> = {
    overdue: [],
    morning: [],
    afternoon: [],
    evening: [],
    allDay: [],
    unscheduled: [],
  }
  const start = startOfLocalDay(now)
  for (const task of today) {
    if (task.dueAt != null && task.dueAt < start) {
      buckets.overdue.push(task)
      continue
    }
    if (task.evening) {
      buckets.evening.push(task)
      continue
    }
    if (task.dueAt == null && task.startAt == null) {
      buckets.unscheduled.push(task)
      continue
    }
    const ts = task.startAt ?? task.dueAt!
    const hour = new Date(ts).getHours()
    if (new Date(ts).getHours() === 0 && new Date(ts).getMinutes() === 0 && !task.startAt) {
      buckets.allDay.push(task)
    } else if (hour < 12) {
      buckets.morning.push(task)
    } else if (hour < 18) {
      buckets.afternoon.push(task)
    } else {
      buckets.evening.push(task)
    }
  }

  const groups: TodayPlanGroup[] = []
  const order: TodayBucket[] = ['overdue', 'morning', 'afternoon', 'evening', 'allDay', 'unscheduled']
  for (const bucket of order) {
    const items = buckets[bucket]
    if (items.length === 0) continue
    const byProject = new Map<string, PersonalTask[]>()
    for (const task of items) {
      const key = task.projectId ?? ''
      const list = byProject.get(key) ?? []
      list.push(task)
      byProject.set(key, list)
    }
    for (const [projectId, grouped] of byProject) {
      groups.push({ bucket, projectId: projectId || undefined, tasks: grouped.sort(compareTaskOrder) })
    }
  }
  return groups
}

export function compareTaskOrder(a: PersonalTask, b: PersonalTask): number {
  if (a.order !== b.order) return a.order - b.order
  return a.createdAt - b.createdAt
}

function compareDue(a: PersonalTask, b: PersonalTask): number {
  const aDue = a.dueAt ?? Number.POSITIVE_INFINITY
  const bDue = b.dueAt ?? Number.POSITIVE_INFINITY
  if (aDue !== bDue) return aDue - bDue
  return compareTaskOrder(a, b)
}

export function sortTasks(tasks: readonly PersonalTask[], sort: TaskSortId): PersonalTask[] {
  const copy = [...tasks]
  switch (sort) {
    case 'order':
      return copy.sort(compareTaskOrder)
    case 'due':
      return copy.sort(compareDue)
    case 'priority':
      return copy.sort((a, b) => {
        const rank = PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority]
        return rank !== 0 ? rank : compareTaskOrder(a, b)
      })
    case 'project':
      return copy.sort((a, b) => {
        const byProject = (a.projectId ?? '').localeCompare(b.projectId ?? '')
        return byProject !== 0 ? byProject : compareTaskOrder(a, b)
      })
    case 'title':
      return copy.sort((a, b) => {
        const byTitle = a.title.localeCompare(b.title)
        return byTitle !== 0 ? byTitle : compareTaskOrder(a, b)
      })
    default: {
      const _never: never = sort
      return _never
    }
  }
}

export function tasksLinkedTo(
  tasks: readonly PersonalTask[],
  kind: PersonalTask['links'][number]['kind'],
  id: string,
): PersonalTask[] {
  return tasks.filter((task) => task.links.some((link) => link.kind === kind && link.id === id))
}
