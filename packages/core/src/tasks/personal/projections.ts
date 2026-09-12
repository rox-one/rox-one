import { isOpenTask, type PersonalTask, type TaskProjectionId } from './types.ts'
import { isSameLocalDay, startOfLocalDay } from './dates.ts'

const MS_DAY = 24 * 60 * 60 * 1000

export function projectTasks(tasks: readonly PersonalTask[], now: number, projection: TaskProjectionId): PersonalTask[] {
  return tasks.filter((task) => matchesProjection(task, now, projection)).sort(compareTaskOrder)
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

export function tasksLinkedTo(
  tasks: readonly PersonalTask[],
  kind: PersonalTask['links'][number]['kind'],
  id: string,
): PersonalTask[] {
  return tasks.filter((task) => task.links.some((link) => link.kind === kind && link.id === id))
}
