/**
 * Task timeline model — maps Things-style tasks onto the shared gantt engine.
 * A task's bar runs from its start («Когда»: startAt, or today for Сегодня) to
 * its deadline (dueAt); a single date yields a one-day bar. Tasks with neither
 * go to the unscheduled tray. Pure functions; the page applies the patches.
 */
import type { PersonalTask } from '@rox/core/tasks/personal'
import { addDays, daysBetween, parseIsoDate, toIsoDate } from '@rox/shared/projects/roadmap'
import { applySpanDrag, type GanttDragMode, type GanttRange, type GanttSpan } from '@/components/gantt/gantt-engine'

export type TimelineGroupBy = 'none' | 'project' | 'area' | 'list'

export interface TimelineGroup {
  key: string
  /** Project/area id or list id the caller turns into a title; null = ungrouped. */
  id: string | null
  kind: TimelineGroupBy
  tasks: PersonalTask[]
}

/** Local calendar date of an epoch timestamp. */
export function isoOf(ms: number): string {
  return toIsoDate(new Date(ms))
}

/** Local midnight of an ISO date. */
export function epochOf(iso: string): number {
  return parseIsoDate(iso).getTime()
}

/** The task's bar, or null when it is unscheduled. */
export function taskSpan(task: PersonalTask, today: string): GanttSpan | null {
  const start = task.startAt != null ? isoOf(task.startAt) : task.list === 'today' ? today : undefined
  const end = task.dueAt != null ? isoOf(task.dueAt) : undefined
  const s = start ?? end
  const e = end ?? start
  if (!s || !e) return null
  // A deadline before the start still renders as a one-day bar at the start.
  return e < s ? { start: s, end: s } : { start: s, end: e }
}

/** Splits tasks into scheduled (with span) and unscheduled, keeping input order. */
export function partitionTasks(tasks: readonly PersonalTask[], today: string): { scheduled: { task: PersonalTask; span: GanttSpan }[]; unscheduled: PersonalTask[] } {
  const scheduled: { task: PersonalTask; span: GanttSpan }[] = []
  const unscheduled: PersonalTask[] = []
  for (const task of tasks) {
    const span = taskSpan(task, today)
    if (span) scheduled.push({ task, span })
    else unscheduled.push(task)
  }
  return { scheduled, unscheduled }
}

/** Window covering every span and today, padded a week before and two after, at least four weeks. */
export function timelineRange(spans: readonly GanttSpan[], today: string): GanttRange {
  let min = today
  let max = today
  for (const span of spans) {
    if (span.start < min) min = span.start
    if (span.end > max) max = span.end
  }
  const start = addDays(min, -7)
  let end = addDays(max, 14)
  if (daysBetween(start, end) < 27) end = addDays(start, 27)
  return { start, end }
}

/** Groups tasks in input order; groups appear in first-seen order, the ungrouped bucket last. */
export function groupTasks(tasks: readonly PersonalTask[], by: TimelineGroupBy): TimelineGroup[] {
  if (by === 'none') return [{ key: 'all', id: null, kind: 'none', tasks: [...tasks] }]
  const groups = new Map<string, TimelineGroup>()
  let rest: TimelineGroup | null = null
  for (const task of tasks) {
    const id = by === 'project' ? task.projectId ?? null : by === 'area' ? task.areaId ?? null : task.list
    if (id == null) {
      rest ??= { key: `${by}:none`, id: null, kind: by, tasks: [] }
      rest.tasks.push(task)
      continue
    }
    const key = `${by}:${id}`
    let group = groups.get(key)
    if (!group) groups.set(key, (group = { key, id, kind: by, tasks: [] }))
    group.tasks.push(task)
  }
  return rest ? [...groups.values(), rest] : [...groups.values()]
}

export interface SchedulePatch {
  /** New start (local midnight); undefined = leave as is. */
  startAt?: number
  /** New deadline (local midnight); undefined = leave as is. */
  dueAt?: number
}

/**
 * Patch for a drag of `days` on a task bar. Only dates the task already had
 * (or the one the resized edge creates) change, so a deadline-only task keeps
 * no start when moved.
 */
export function dragPatch(task: PersonalTask, mode: GanttDragMode, days: number, today: string): SchedulePatch {
  const span = taskSpan(task, today)
  if (!span || !days) return {}
  const next = applySpanDrag(span, mode, days)
  const hasStart = task.startAt != null || task.list === 'today'
  const hasDue = task.dueAt != null
  const patch: SchedulePatch = {}
  if (mode === 'move') {
    if (hasStart) patch.startAt = epochOf(next.start)
    if (hasDue) patch.dueAt = epochOf(next.end)
  } else if (mode === 'start') {
    if (hasStart || next.start !== span.start) patch.startAt = epochOf(next.start)
  } else if (hasDue || next.end !== span.end) {
    patch.dueAt = epochOf(next.end)
  }
  return patch
}

/** Patch for dropping an unscheduled task on a day: it starts that day. */
export function dropPatch(date: string): SchedulePatch {
  return { startAt: epochOf(date) }
}

/** Minimal store surface used to apply a schedule patch. */
export interface ScheduleStore {
  get(id: string): PersonalTask | undefined
  setWhen(id: string, when: import('@rox/core/tasks/personal').TaskWhen, now?: number, opts?: { keepOrder?: boolean }): unknown
  setDeadline(id: string, at: number | undefined): unknown
}

/**
 * Applies a timeline patch. A start of today or earlier becomes Сегодня (never a
 * past Upcoming date); the evening flag is preserved; an unchanged start day is
 * left alone; the task keeps its order while its list stays the same.
 */
export function applySchedule(store: ScheduleStore, id: string, patch: SchedulePatch, now = Date.now()): void {
  const task = store.get(id)
  if (!task) return
  if (patch.startAt != null) {
    const todayStart = epochOf(isoOf(now))
    const day = epochOf(isoOf(patch.startAt))
    const current = task.startAt != null ? epochOf(isoOf(task.startAt)) : task.list === 'today' ? todayStart : null
    const effective = day <= todayStart ? todayStart : day
    if (effective !== current) {
      if (effective === todayStart) store.setWhen(id, { kind: task.evening ? 'evening' : 'today' }, now, { keepOrder: true })
      else store.setWhen(id, { kind: 'date', at: effective, evening: task.evening }, now, { keepOrder: true })
    }
  }
  if (patch.dueAt != null) store.setDeadline(id, patch.dueAt)
}

/** Scheduled task ids in timeline row order (groups, then rows). */
export function timelineRowOrder(tasks: readonly PersonalTask[], by: TimelineGroupBy, today: string): string[] {
  return groupTasks(partitionTasks(tasks, today).scheduled.map((s) => s.task), by).flatMap((g) => g.tasks.map((task) => task.id))
}

// ── Dependencies (finish-to-start) ──

export interface DependencyEdge {
  from: string
  to: string
  /** The blocked task starts before its blocker ends (same day is fine). */
  violated: boolean
}

/** Edges between scheduled tasks (blocker → blocked) for the timeline arrows. */
export function dependencyEdges(tasks: readonly PersonalTask[], spans: ReadonlyMap<string, GanttSpan>): DependencyEdge[] {
  const out: DependencyEdge[] = []
  for (const task of tasks) {
    const to = spans.get(task.id)
    if (!to) continue
    for (const blocker of task.blockedBy ?? []) {
      const from = spans.get(blocker)
      if (from) out.push({ from: blocker, to: task.id, violated: to.start < from.end })
    }
  }
  return out
}

/**
 * Finish-to-start conflicts touching `id` (as blocked or as blocker) among open
 * tasks; used to warn after a reschedule. Unscheduled tasks never conflict.
 */
export function dependencyConflicts(tasks: readonly PersonalTask[], id: string, today: string): { blocker: PersonalTask; blocked: PersonalTask }[] {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const out: { blocker: PersonalTask; blocked: PersonalTask }[] = []
  const check = (blocked: PersonalTask, blocker: PersonalTask | undefined) => {
    if (!blocker || blocker.completedAt != null) return
    const a = taskSpan(blocker, today), b = taskSpan(blocked, today)
    if (a && b && b.start < a.end) out.push({ blocker, blocked })
  }
  const self = byId.get(id)
  if (!self) return out
  for (const blocker of self.blockedBy ?? []) check(self, byId.get(blocker))
  for (const task of tasks) if (task.blockedBy?.includes(id)) check(task, self)
  return out
}

/** Monday–Sunday (local) containing `today`, as ISO dates. */
export function weekRange(today: string): GanttRange {
  const date = parseIsoDate(today)
  const offset = (date.getDay() + 6) % 7
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate() - offset)
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6)
  return { start: toIsoDate(start), end: toIsoDate(end) }
}

/** Open tasks whose span overlaps the week (any project/area). */
export function weekTasks(tasks: readonly PersonalTask[], today: string): PersonalTask[] {
  const week = weekRange(today)
  return tasks.filter((task) => {
    const span = taskSpan(task, today)
    return span != null && span.start <= week.end && span.end >= week.start
  })
}

/** Group header text: list → its projection label; project/area → its name. */
export function timelineGroupTitle(
  group: TimelineGroup,
  t: (key: string) => string,
  projectName: (id: string) => string | undefined,
  areaName: (id: string) => string | undefined,
): string {
  if (group.kind === 'list') return t(`tasks.projection.${group.id}`)
  if (group.kind === 'area') {
    const name = group.id != null ? areaName(group.id) : undefined
    return name || t('tasks.move.noArea')
  }
  if (group.kind === 'project') {
    const name = group.id != null ? projectName(group.id) : undefined
    return name || t('tasks.move.noPlace')
  }
  // kind === 'none' (single ungrouped bucket)
  return group.id != null ? (projectName(group.id) ?? group.id) : t('tasks.move.noPlace')
}
