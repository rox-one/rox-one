/**
 * Things-style personal tasks (Rox tracker Issue 17).
 * Distinct from the DAG Conductor `tasks:` runner.
 */

export const PERSONAL_TASK_BUNDLE_VERSION = 2

export type TaskListId = 'inbox' | 'today' | 'upcoming' | 'anytime' | 'someday'
export type TaskProjectionId = TaskListId | 'logbook'
export type TaskPriority = 'none' | 'low' | 'medium' | 'high'
export type TaskLinkKind = 'note' | 'session' | 'message' | 'workflowRun'
export type RecurrenceRule = 'daily' | 'weekly' | 'monthly' | 'yearly'

export interface TaskLink {
  kind: TaskLinkKind
  id: string
}

export interface Recurrence {
  rule: RecurrenceRule
  interval: number
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
}

export interface TaskProject {
  id: string
  name: string
  areaId?: string
  order: number
}

export interface TaskArea {
  id: string
  name: string
  order: number
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
  nextSeq?: number
  revision?: number
  tasks: PersonalTask[]
  projects: TaskProject[]
  areas: TaskArea[]
  headings: TaskHeading[]
  audit: TaskAuditEvent[]
}

export function emptyBundle(): PersonalTaskBundle {
  return {
    version: PERSONAL_TASK_BUNDLE_VERSION,
    nextSeq: 0,
    revision: 0,
    tasks: [],
    projects: [],
    areas: [],
    headings: [],
    audit: [],
  }
}

export function isOpenTask(task: PersonalTask): boolean {
  return task.completedAt == null && task.cancelledAt == null
}
