/**
 * W1-06 (#1503) — WorkItem v3 (DATA-MODEL §5.1, ADR-U01) over the PersonalTask v2 record.
 *
 * Storage rule (zero behaviour change for the existing Tasks UI): a v3 task
 * file keeps the v2 `task` object verbatim and stores the v3-only fields next
 * to it in `work` (`{id, revision, schemaVersion: 3, task, work}`). v2 readers
 * ignore the extra members; the UI keeps reading and writing `PersonalTask`.
 * `WorkItem` is the v3 view (ISO-8601 dates, Operately priorities, renamed
 * placement fields) derived from both halves.
 *
 * - Fields shared by both shapes (dates, priority, list…) live only in `task`
 *   and are converted on read, so the two halves can never disagree.
 * - Fields that v2 derives (`statusKey`, `listId`, `sectionId`, `listGroupId`)
 *   are recomputed from `task` on every write (MIG-01 renames with read aliases).
 * - Fields v2 cannot express (`assigneeIds`, workspace `projectId`, `size`…)
 *   are preserved from the previous `work` half when the UI writes a task.
 */

import type { ChecklistItem, PersonalTask, Recurrence, TaskArea, TaskHeading, TaskLink, TaskListId, TaskPriority, TaskProject } from './types.ts'

/** Personal-task file schema version written by this build (v2 = Things fields, v3 = WorkItem). */
export const PERSONAL_TASK_SCHEMA_VERSION_V3 = 3

export type WorkItemPriority = 'none' | 'low' | 'normal' | 'high' | 'urgent'
export type WorkItemSize = 'xs' | 's' | 'm' | 'l' | 'xl'
export type DuePrecision = 'day' | 'month' | 'quarter' | 'year'
export type WorkItemAuthority = 'local' | 'workspace'

export const WORK_ITEM_PRIORITIES: readonly WorkItemPriority[] = ['none', 'low', 'normal', 'high', 'urgent']
export const WORK_ITEM_SIZES: readonly WorkItemSize[] = ['xs', 's', 'm', 'l', 'xl']
export const DUE_PRECISIONS: readonly DuePrecision[] = ['day', 'month', 'quarter', 'year']

/** `{kind}:{id}` reference kept denormalised on the item ("Created from"). */
export interface WorkItemOriginRef {
  kind: string
  id: string
  fragment?: string
}

/** Status definition (DATA-MODEL §5.1 `task_status`). */
export interface TaskStatusDefinition {
  key: string
  label: string
  color: 'gray' | 'blue' | 'green' | 'red' | 'amber' | 'purple'
  icon?: string
  closed: boolean
  kind: 'open' | 'done' | 'canceled'
}

/** Operately §3.3 default set; labels are i18n keys resolved by the UI. */
export const DEFAULT_TASK_STATUS_SET: readonly TaskStatusDefinition[] = Object.freeze([
  { key: 'pending', label: 'tasks.status.pending', color: 'gray', icon: 'circle', closed: false, kind: 'open' },
  { key: 'in_progress', label: 'tasks.status.inProgress', color: 'blue', icon: 'circle-half', closed: false, kind: 'open' },
  { key: 'done', label: 'tasks.status.done', color: 'green', icon: 'circle-check', closed: true, kind: 'done' },
  { key: 'canceled', label: 'tasks.status.canceled', color: 'red', icon: 'circle-x', closed: true, kind: 'canceled' },
] as const satisfies readonly TaskStatusDefinition[])

/** v3-only fields persisted beside the v2 task (`work` half of the file). */
export interface WorkItemExtension {
  authority: WorkItemAuthority
  workspaceId?: string
  ownerPrincipalId: string
  nativeId?: string
  sourceStoreId?: string
  /** Derived from v2 `projectId` / `headingId` / `areaId` (read aliases kept one release). */
  listId?: string
  sectionId?: string
  listGroupId?: string
  /** Rox / Operately (workspace) project — NOT the Things project. */
  projectId?: string
  milestoneId?: string
  spaceId?: string
  statusKey: string
  /** Kept only when it has no v2 equivalent (`urgent`); otherwise derived from `task.priority`. */
  priority?: WorkItemPriority
  size?: WorkItemSize
  duePrecision?: DuePrecision
  assigneeIds: string[]
  notesDoc?: unknown
  reopenedAt?: string
  archivedAt?: string
  reminderOffsets?: number[]
  reminderOnDates?: string[]
  remindDueDay?: boolean
  remindOverdue?: boolean
  customFields?: Record<string, unknown>
  estimateMinutes?: number
  origin?: WorkItemOriginRef
}

/** The v3 entity (DATA-MODEL §5.1). Dates are ISO-8601 strings. */
export interface WorkItem {
  id: string
  authority: WorkItemAuthority
  workspaceId?: string
  ownerPrincipalId: string
  nativeId?: string
  sourceStoreId?: string
  revision: number
  title: string
  notes: string
  notesDoc?: unknown
  list: TaskListId
  startAt?: string
  evening: boolean
  order: number
  listId?: string
  sectionId?: string
  listGroupId?: string
  parentId?: string
  projectId?: string
  milestoneId?: string
  spaceId?: string
  statusKey: string
  priority: WorkItemPriority
  size?: WorkItemSize
  dueAt?: string
  duePrecision?: DuePrecision
  assigneeIds: string[]
  createdAt: string
  updatedAt?: string
  completedAt?: string
  cancelledAt?: string
  reopenedAt?: string
  trashedAt?: string
  archivedAt?: string
  reminderAt?: string
  reminderTimeZone?: string
  reminderOffsets?: number[]
  reminderOnDates?: string[]
  remindDueDay?: boolean
  remindOverdue?: boolean
  reminderDeliveredFor?: string
  reminderRetryAt?: string
  reminderError?: PersonalTask['reminderError']
  recurrence?: Recurrence
  repeatOf?: string
  repeatOccurrenceAt?: string
  repeatNextId?: string
  checklist?: ChecklistItem[]
  tags: string[]
  customFields?: Record<string, unknown>
  estimateMinutes?: number
  origin?: WorkItemOriginRef
  /** v2 `links[]`, read-only for one release (MIG-03 moves them to `entity_link`). */
  legacyLinks?: TaskLink[]
}

export interface WorkItemDefaults {
  /** Local principal (owner) for items created before v3. */
  ownerPrincipalId: string
}

export const LOCAL_PRINCIPAL_ID = 'local'

// ── priority ────────────────────────────────────────────────────────────

export function v2PriorityToV3(priority: TaskPriority | string | undefined): WorkItemPriority {
  switch (priority) {
    case 'low': return 'low'
    case 'medium': return 'normal'
    case 'high': return 'high'
    default: return 'none'
  }
}

export function v3PriorityToV2(priority: WorkItemPriority): TaskPriority {
  switch (priority) {
    case 'low': return 'low'
    case 'normal': return 'medium'
    case 'high':
    case 'urgent': return 'high'
    default: return 'none'
  }
}

// ── status ──────────────────────────────────────────────────────────────

/**
 * MIG-01 rule: completed → `done`, cancelled → `canceled`, else `pending`.
 * An open custom key (e.g. `in_progress`) survives while the task stays open.
 */
export function deriveStatusKey(task: Pick<PersonalTask, 'completedAt' | 'cancelledAt'>, previous?: string): string {
  if (task.cancelledAt != null) return 'canceled'
  if (task.completedAt != null) return 'done'
  if (!previous || statusLifecycle(previous) !== 'open') return 'pending'
  return previous
}

/** Status semantics (DATA-MODEL §5.1): which lifecycle stamps a status key implies. */
export function statusLifecycle(statusKey: string, set: readonly TaskStatusDefinition[] = DEFAULT_TASK_STATUS_SET): 'open' | 'done' | 'canceled' {
  const definition = set.find(entry => entry.key === statusKey)
  if (definition) return definition.closed ? (definition.kind === 'canceled' ? 'canceled' : 'done') : 'open'
  if (statusKey === 'canceled') return 'canceled'
  if (statusKey === 'done') return 'done'
  return 'open'
}

// ── dates ───────────────────────────────────────────────────────────────

export function epochToIso(value: number | undefined): string | undefined {
  if (value === undefined || value === null || !Number.isFinite(value)) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

export function isoToEpoch(value: string | undefined): number | undefined {
  if (value === undefined || value === null) return undefined
  const time = Date.parse(value)
  return Number.isNaN(time) ? undefined : time
}

// ── derive / convert ────────────────────────────────────────────────────

function clean<T extends object>(value: T): T {
  for (const key of Object.keys(value) as (keyof T)[]) if (value[key] === undefined) delete value[key]
  return value
}

/**
 * The `work` half for a v2 task: derived fields recomputed from `task`,
 * v3-only fields carried over from `previous` (MIG-01 when `previous` is absent).
 */
export function deriveWorkItemExtension(task: PersonalTask, previous: WorkItemExtension | null | undefined, defaults: WorkItemDefaults = { ownerPrincipalId: LOCAL_PRINCIPAL_ID }): WorkItemExtension {
  const base: WorkItemExtension = previous ? { ...previous, assigneeIds: [...(previous.assigneeIds ?? [])] } : { authority: 'local', ownerPrincipalId: defaults.ownerPrincipalId, statusKey: 'pending', assigneeIds: [] }
  base.authority = base.authority ?? 'local'
  base.ownerPrincipalId = base.ownerPrincipalId || defaults.ownerPrincipalId
  base.statusKey = deriveStatusKey(task, previous?.statusKey)
  base.listId = task.projectId
  base.sectionId = task.headingId
  base.listGroupId = task.projectId ? undefined : task.areaId
  // `urgent` has no v2 value: keep it only while the v2 priority still reads `high`.
  if (base.priority === 'urgent' && task.priority === 'high') base.priority = 'urgent'
  else delete base.priority
  if (!base.origin && task.source) base.origin = taskLinkToOriginRef(task.id, task.source)
  return clean(base)
}

export function toWorkItem(task: PersonalTask, revision: number, extension?: WorkItemExtension | null, defaults?: WorkItemDefaults): WorkItem {
  const work = extension ?? deriveWorkItemExtension(task, null, defaults)
  const item: WorkItem = {
    id: task.id,
    authority: work.authority ?? 'local',
    workspaceId: work.workspaceId,
    ownerPrincipalId: work.ownerPrincipalId,
    nativeId: work.nativeId,
    sourceStoreId: work.sourceStoreId,
    revision,
    title: task.title,
    notes: task.notes,
    notesDoc: work.notesDoc,
    list: task.list,
    startAt: epochToIso(task.startAt),
    evening: task.evening,
    order: task.order,
    // Read aliases: a v2 file without `work` still answers listId/sectionId/listGroupId.
    listId: work.listId ?? task.projectId,
    sectionId: work.sectionId ?? task.headingId,
    listGroupId: work.listGroupId ?? (task.projectId ? undefined : task.areaId),
    parentId: task.parentId,
    projectId: work.projectId,
    milestoneId: work.milestoneId,
    spaceId: work.spaceId,
    statusKey: work.statusKey ?? deriveStatusKey(task),
    priority: work.priority ?? v2PriorityToV3(task.priority),
    size: work.size,
    dueAt: epochToIso(task.dueAt),
    duePrecision: work.duePrecision,
    assigneeIds: [...(work.assigneeIds ?? [])],
    createdAt: epochToIso(task.createdAt) ?? new Date(0).toISOString(),
    updatedAt: epochToIso(task.updatedAt),
    completedAt: epochToIso(task.completedAt),
    cancelledAt: epochToIso(task.cancelledAt),
    reopenedAt: work.reopenedAt,
    trashedAt: epochToIso(task.trashedAt),
    archivedAt: work.archivedAt,
    reminderAt: epochToIso(task.reminderAt),
    reminderTimeZone: task.reminderTimeZone,
    reminderOffsets: work.reminderOffsets,
    reminderOnDates: work.reminderOnDates,
    remindDueDay: work.remindDueDay,
    remindOverdue: work.remindOverdue,
    reminderDeliveredFor: epochToIso(task.reminderDeliveredFor),
    reminderRetryAt: epochToIso(task.reminderRetryAt),
    reminderError: task.reminderError,
    recurrence: task.recurrence,
    repeatOf: task.repeatOf,
    repeatOccurrenceAt: epochToIso(task.repeatOccurrenceAt),
    repeatNextId: task.repeatNextId,
    checklist: task.checklist,
    tags: [...task.tags],
    customFields: work.customFields,
    estimateMinutes: work.estimateMinutes,
    origin: work.origin ?? (task.source ? taskLinkToOriginRef(task.id, task.source) : undefined),
    legacyLinks: task.links.length > 0 ? task.links : undefined,
  }
  return clean(item)
}

/** Inverse of `toWorkItem`: the v2 task the UI reads plus the v3 `work` half. */
export function fromWorkItem(item: WorkItem, previousTask?: PersonalTask | null): { task: PersonalTask; work: WorkItemExtension } {
  const lifecycle = statusLifecycle(item.statusKey)
  const completedAt = isoToEpoch(item.completedAt) ?? (lifecycle === 'done' ? isoToEpoch(item.updatedAt) ?? Date.now() : undefined)
  const cancelledAt = isoToEpoch(item.cancelledAt) ?? (lifecycle === 'canceled' ? isoToEpoch(item.updatedAt) ?? Date.now() : undefined)
  const task: PersonalTask = clean({
    ...(previousTask ?? {}),
    id: item.id,
    title: item.title,
    notes: item.notes,
    list: item.list,
    projectId: item.listId,
    areaId: item.listId ? undefined : item.listGroupId,
    headingId: item.sectionId,
    parentId: item.parentId,
    tags: [...item.tags],
    priority: v3PriorityToV2(item.priority),
    dueAt: isoToEpoch(item.dueAt),
    startAt: isoToEpoch(item.startAt),
    evening: item.evening,
    recurrence: item.recurrence,
    links: item.legacyLinks ?? previousTask?.links ?? [],
    order: item.order,
    createdAt: isoToEpoch(item.createdAt) ?? Date.now(),
    completedAt: lifecycle === 'done' ? completedAt : undefined,
    cancelledAt: lifecycle === 'canceled' ? cancelledAt : undefined,
    checklist: item.checklist,
    reminderAt: isoToEpoch(item.reminderAt),
    reminderTimeZone: item.reminderTimeZone,
    reminderDeliveredFor: isoToEpoch(item.reminderDeliveredFor),
    reminderRetryAt: isoToEpoch(item.reminderRetryAt),
    reminderError: item.reminderError,
    trashedAt: isoToEpoch(item.trashedAt),
    repeatOf: item.repeatOf,
    repeatOccurrenceAt: isoToEpoch(item.repeatOccurrenceAt),
    repeatNextId: item.repeatNextId,
    updatedAt: isoToEpoch(item.updatedAt),
  } as PersonalTask)
  const work: WorkItemExtension = clean({
    authority: item.authority,
    workspaceId: item.workspaceId,
    ownerPrincipalId: item.ownerPrincipalId,
    nativeId: item.nativeId,
    sourceStoreId: item.sourceStoreId,
    listId: item.listId,
    sectionId: item.sectionId,
    listGroupId: item.listId ? undefined : item.listGroupId,
    projectId: item.projectId,
    milestoneId: item.milestoneId,
    spaceId: item.spaceId,
    statusKey: item.statusKey,
    priority: item.priority === 'urgent' ? 'urgent' : undefined,
    size: item.size,
    duePrecision: item.duePrecision,
    assigneeIds: [...item.assigneeIds],
    notesDoc: item.notesDoc,
    reopenedAt: item.reopenedAt,
    archivedAt: item.archivedAt,
    reminderOffsets: item.reminderOffsets,
    reminderOnDates: item.reminderOnDates,
    remindDueDay: item.remindDueDay,
    remindOverdue: item.remindOverdue,
    customFields: item.customFields,
    estimateMinutes: item.estimateMinutes,
    origin: item.origin,
  } as WorkItemExtension)
  return { task, work }
}

// ── MIG-02: meta.json → task-list / task-list-group / task-section ──────

export interface TaskListRecord {
  id: string
  ownerType: 'user' | 'project' | 'space' | 'chat'
  ownerId: string
  name: string
  notes?: string
  deadlineAt?: string
  groupId?: string
  sortKey: string
  statusSetEnabled: boolean
  completedAt?: string
  archivedAt?: string
  trashedAt?: string
  createdAt?: string
}

export interface TaskSectionRecord {
  id: string
  taskListId: string
  title: string
  sortKey: string
}

export interface TaskListGroupRecord {
  id: string
  principalId: string
  name: string
  sortKey: string
  collapsed: boolean
  trashedAt?: string
}

export interface PersonalTaskWorkMeta {
  schemaVersion: typeof PERSONAL_TASK_SCHEMA_VERSION_V3
  taskLists: TaskListRecord[]
  taskSections: TaskSectionRecord[]
  taskListGroups: TaskListGroupRecord[]
  /** Customised local status sets (`meta.json.statusSets`), keyed by task-list id or `default`. */
  statusSets?: Record<string, TaskStatusDefinition[]>
}

/** Lexicographic sort key preserving numeric `order` (negative and fractional orders included). */
export function orderToSortKey(order: number): string {
  if (!Number.isFinite(order)) return 'm'
  // Shift into the positive range and pad: 1e9 offset keeps any realistic order positive.
  const shifted = Math.round((order + 1e9) * 1000)
  return `o${String(Math.max(0, shifted)).padStart(16, '0')}`
}

export function taskProjectToList(project: TaskProject, ownerPrincipalId: string): TaskListRecord {
  return clean({
    id: project.id,
    ownerType: 'user',
    ownerId: ownerPrincipalId,
    name: project.name,
    notes: project.notes,
    deadlineAt: epochToIso(project.deadlineAt),
    groupId: project.areaId,
    sortKey: orderToSortKey(project.order),
    statusSetEnabled: false,
    completedAt: epochToIso(project.completedAt),
    trashedAt: epochToIso(project.trashedAt),
    createdAt: epochToIso(project.createdAt),
  } as TaskListRecord)
}

export function taskHeadingToSection(heading: TaskHeading): TaskSectionRecord {
  return { id: heading.id, taskListId: heading.projectId, title: heading.title, sortKey: orderToSortKey(heading.order) }
}

export function taskAreaToGroup(area: TaskArea, ownerPrincipalId: string): TaskListGroupRecord {
  return clean({ id: area.id, principalId: ownerPrincipalId, name: area.name, sortKey: orderToSortKey(area.order), collapsed: area.collapsed === true, trashedAt: epochToIso(area.trashedAt) } as TaskListGroupRecord)
}

export function deriveWorkMeta(
  meta: { projects?: TaskProject[]; areas?: TaskArea[]; headings?: TaskHeading[] },
  ownerPrincipalId: string = LOCAL_PRINCIPAL_ID,
  statusSets?: Record<string, TaskStatusDefinition[]>,
): PersonalTaskWorkMeta {
  const work: PersonalTaskWorkMeta = {
    schemaVersion: PERSONAL_TASK_SCHEMA_VERSION_V3,
    taskLists: (meta.projects ?? []).map(project => taskProjectToList(project, ownerPrincipalId)),
    taskSections: (meta.headings ?? []).map(taskHeadingToSection),
    taskListGroups: (meta.areas ?? []).map(area => taskAreaToGroup(area, ownerPrincipalId)),
  }
  if (statusSets && Object.keys(statusSets).length > 0) work.statusSets = statusSets
  return work
}

// ── MIG-03: TaskLink / source → entity_link ─────────────────────────────

export interface MigratedTaskLink {
  from: { kind: 'task'; id: string }
  to: WorkItemOriginRef
  relation: 'mentions' | 'attached-to' | 'derived-from'
  role?: string
}

const MESSENGER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** DATA-MODEL §6.2 MIG-03 target ref for one v2 TaskLink. */
export function taskLinkTarget(link: TaskLink): WorkItemOriginRef | null {
  if (!link || typeof link.id !== 'string' || link.id.length === 0) return null
  switch (link.kind) {
    case 'note': return { kind: 'note', id: link.id }
    case 'session': return { kind: 'session', id: link.id }
    case 'message': {
      // `sessionId#msgId` (agent chat) vs a messenger message uuid.
      const hash = link.id.indexOf('#')
      if (hash > 0) return { kind: 'session', id: link.id.slice(0, hash), fragment: `msg-${link.id.slice(hash + 1)}` }
      if (MESSENGER_ID.test(link.id)) return { kind: 'channel-message', id: link.id }
      return { kind: 'session', id: link.id }
    }
    case 'workflowRun': return { kind: 'workflow-run', id: link.id }
    case 'meeting': return { kind: 'call', id: link.id }
    case 'feed': return { kind: 'feed-item', id: link.id }
    case 'mail': return { kind: 'mail-thread', id: link.id }
    case 'decision': return { kind: 'decision', id: link.id }
    default: return null
  }
}

export function taskLinkToOriginRef(_taskId: string, link: TaskLink): WorkItemOriginRef | undefined {
  return taskLinkTarget(link) ?? undefined
}

/** Every entity_link edge MIG-03 writes for one task (deduped by `(to, relation)`). */
export function migrateTaskLinks(task: Pick<PersonalTask, 'id' | 'links' | 'source'>): MigratedTaskLink[] {
  const out: MigratedTaskLink[] = []
  const seen = new Set<string>()
  const push = (edge: MigratedTaskLink) => {
    const key = `${edge.relation}|${edge.to.kind}:${edge.to.id}#${edge.to.fragment ?? ''}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(edge)
  }
  if (task.source) {
    const to = taskLinkTarget(task.source)
    if (to) push({ from: { kind: 'task', id: task.id }, to, relation: 'derived-from', role: 'origin' })
  }
  for (const link of task.links ?? []) {
    const to = taskLinkTarget(link)
    if (!to) continue
    const relation: MigratedTaskLink['relation'] = link.kind === 'message' ? 'derived-from' : link.kind === 'note' ? 'mentions' : 'attached-to'
    push({ from: { kind: 'task', id: task.id }, to, relation })
  }
  return out
}
