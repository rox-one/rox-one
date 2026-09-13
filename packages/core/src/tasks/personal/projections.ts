import { isOpenTask, type PersonalTask, type TaskFilterId, type TaskPriority, type TaskProjectionId, type TaskSortId } from './types.ts'
import { isSameLocalDay, startOfLocalDay } from './dates.ts'

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
  if (projection === 'logbook') return task.completedAt != null
  if (!isOpenTask(task)) return false
  switch (projection) {
    case 'inbox':
      return task.list === 'inbox'
    case 'today':
      return isTodayTask(task, now)
    case 'upcoming':
      return isUpcomingTask(task, now)
    case 'anytime':
      return task.list === 'anytime' && task.dueAt == null
    case 'someday':
      return task.list === 'someday'
    default: {
      const _never: never = projection
      return _never
    }
  }
}

export function isTodayTask(task: PersonalTask, now: number): boolean {
  if (!isOpenTask(task)) return false
  if (task.list === 'today') return true
  if (task.dueAt != null && isSameLocalDay(task.dueAt, now)) return true
  if (task.startAt != null && isSameLocalDay(task.startAt, now)) return true
  if (task.dueAt != null && task.dueAt < startOfLocalDay(now)) return true
  return false
}

export function isUpcomingTask(task: PersonalTask, now: number): boolean {
  if (!isOpenTask(task)) return false
  if (task.list === 'upcoming' && (task.dueAt == null || task.dueAt >= startOfLocalDay(now) + MS_DAY)) return true
  if (task.dueAt != null && task.dueAt >= startOfLocalDay(now) + MS_DAY) return true
  return false
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

function compareTaskOrder(a: PersonalTask, b: PersonalTask): number {
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
