/**
 * Things-style personal tasks (Rox tracker Issue 17).
 * Distinct from the DAG Conductor `tasks:` runner.
 */

export const PERSONAL_TASK_BUNDLE_VERSION = 1

export type TaskListId = 'inbox' | 'today' | 'upcoming' | 'anytime' | 'someday'
export type TaskProjectionId = TaskListId | 'logbook' | 'trash'
/** Unified list (`all`) plus the classic projections, used as filters not the only model. */
export type TaskFilterId = TaskProjectionId | 'all'
export type TaskSortId = 'order' | 'due' | 'priority' | 'project' | 'title'
export type TaskPriority = 'none' | 'low' | 'medium' | 'high'
export type TaskLinkKind = 'note' | 'session' | 'message' | 'workflowRun' | 'meeting' | 'feed' | 'mail' | 'decision'
export type RecurrenceRule = 'daily' | 'weekly' | 'monthly' | 'yearly'

export interface TaskLink {
  kind: TaskLinkKind
  id: string
  /** Human label captured when the link was made (source title), optional. */
  label?: string
}

export interface Recurrence {
  rule: RecurrenceRule
  interval: number
  /** weekly only: local weekdays (0 = Sunday … 6 = Saturday). Empty/absent = same weekday. */
  weekdays?: number[]
  /** 'fixed' (default): next date from the schedule; 'after': N units after completion. */
  mode?: 'fixed' | 'after'
  /** Stop repeating after this local timestamp. */
  until?: number
  /** IANA timezone used for calendar arithmetic and the scheduled wall-clock time. */
  timeZone?: string
}


/** Lightweight checklist line inside a task (Things-style, not a task of its own). */
export interface ChecklistItem {
  id: string
  title: string
  done: boolean
}

export interface PersonalTask {
  id: string
  title: string
  notes: string
  list: TaskListId
  projectId?: string
  areaId?: string
  headingId?: string
  parentId?: string
  tags: string[]
  priority: TaskPriority
  dueAt?: number
  startAt?: number
  evening: boolean
  recurrence?: Recurrence
  links: TaskLink[]
  order: number
  createdAt: number
  completedAt?: number
  cancelledAt?: number
  // — Things-style additions (all optional; v1 bundles load unchanged) —
  /** Checklist lines. */
  checklist?: ChecklistItem[]
  /** Epoch timestamp for the reminder occurrence. */
  reminderAt?: number
  /** IANA timezone in which the reminder's wall-clock time was selected. */
  reminderTimeZone?: string
  /** Reminder timestamp acknowledged by the local OS notification surface. */
  reminderDeliveredFor?: number
  /** Retry eligibility after a local presentation failure. */
  reminderRetryAt?: number
  reminderError?: 'permission-denied' | 'permission-required' | 'presentation-failed'
  /** Set when the task was moved to Корзина (restorable until emptied). */
  trashedAt?: number
  /** Where the task came from (meeting, feed item, mail, session…). Also kept in links. */
  source?: TaskLink
  /** Id of the task this one was spawned from by a repeat rule. */
  repeatOf?: string
  /** Scheduled timestamp represented by this recurring occurrence. */
  repeatOccurrenceAt?: number
  /** Stable idempotency link to the one successor of a completed recurrence. */
  repeatNextId?: string
  /** Last modification time (for sync/debug; optional). */
  updatedAt?: number
}

export interface TaskProject {
  id: string
  name: string
  areaId?: string
  order: number
  notes?: string
  /** Deadline of the whole project. */
  deadlineAt?: number
  completedAt?: number
  trashedAt?: number
  createdAt?: number
}

export interface TaskArea {
  id: string
  name: string
  order: number
  collapsed?: boolean
  trashedAt?: number
}

export interface TaskHeading {
  id: string
  title: string
  projectId: string
  order: number
}

export interface TaskAuditEvent {
  at: number
  action: string
  taskId?: string
  detail?: string
}

export interface PersonalTaskBundle {
  version: number
  tasks: PersonalTask[]
  projects: TaskProject[]
  areas: TaskArea[]
  headings: TaskHeading[]
  audit: TaskAuditEvent[]
}

export function emptyBundle(): PersonalTaskBundle {
  return {
    version: PERSONAL_TASK_BUNDLE_VERSION,
    tasks: [],
    projects: [],
    areas: [],
    headings: [],
    audit: [],
  }
}

export function isOpenTask(task: PersonalTask): boolean {
  return task.completedAt == null && task.cancelledAt == null && task.trashedAt == null
}

export function isTrashedTask(task: PersonalTask): boolean {
  return task.trashedAt != null
}
