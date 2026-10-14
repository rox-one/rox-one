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

/** Workspace tasks only have a deadline: any timeline move/drop sets it. */
export function workspaceDuePatch(patch: SchedulePatch): number | null {
  return patch.dueAt ?? patch.startAt ?? null
}
