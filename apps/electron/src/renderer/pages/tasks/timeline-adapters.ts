/**
 * Adapters that let non-personal task models reuse the task timeline.
 */
import type { PersonalTask } from '@rox/core/tasks/personal'
import type { WorkspaceTask } from '@rox/shared/workspace-work'
import type { SchedulePatch } from './timeline-model'

/** A workspace task as a timeline row: a one-day bar on its deadline; grouped by project. */
export function workspaceTaskToTimeline(task: WorkspaceTask): PersonalTask {
  return {
    id: task.id,
    title: task.title,
    notes: '',
    list: 'anytime',
    projectId: task.project?.id,
    tags: [],
    priority: 'none',
    dueAt: task.dueAt ?? undefined,
    evening: false,
    links: [],
    order: task.createdAt,
    createdAt: task.createdAt,
    completedAt: task.status === 'done' ? task.updatedAt : undefined,
    cancelledAt: task.status === 'canceled' ? task.updatedAt : undefined,
  }
}

/**
 * New workspace deadline for a timeline patch (deadline-only rows send dueAt as a
 * local day). The original time of day is kept; a first deadline lands at midnight.
 */
export function workspaceDuePatch(patch: SchedulePatch, previous: number | null): number | null {
  if (patch.dueAt == null) return null
  if (previous == null) return patch.dueAt
  const prev = new Date(previous)
  const day = new Date(patch.dueAt)
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), prev.getHours(), prev.getMinutes(), prev.getSeconds(), prev.getMilliseconds()).getTime()
}

/** Overlays pending (optimistic) deadlines onto workspace tasks. */
export function withOptimisticDue<T extends { id: string; dueAt: number | null }>(tasks: readonly T[], overlay: ReadonlyMap<string, number>): T[] {
  if (!overlay.size) return [...tasks]
  return tasks.map((task) => (overlay.has(task.id) ? { ...task, dueAt: overlay.get(task.id)! } : task))
}

/**
 * Drop overlay entries only once the snapshot dueAt matches (write confirmed).
 * Unmatched entries stay so an in-flight or rejected write does not flash the bar
 * back and forth on every unrelated snapshot bump.
 */
export function reconcileOptimisticDue<T extends { id: string; dueAt: number | null }>(
  overlay: ReadonlyMap<string, number>,
  tasks: readonly T[],
): Map<string, number> {
  if (!overlay.size) return new Map()
  const byId = new Map(tasks.map((task) => [task.id, task.dueAt]))
  const next = new Map<string, number>()
  for (const [id, due] of overlay) {
    const snap = byId.get(id)
    if (snap === undefined) continue // task gone
    if (snap === due) continue // confirmed
    next.set(id, due)
  }
  return next
}
