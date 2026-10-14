/**
 * Bulk operations for the Задачи multi-select bar. Every operation runs inside a
 * single store mutation and returns an undo snapshot that restores each touched
 * task (and its subtasks) to its previous state and removes tasks the operation
 * spawned (next occurrences of repeating tasks).
 */
import { startOfLocalDay, type PersonalTask, type PersonalTaskStore, type TaskWhen } from '@rox/core/tasks/personal'

const DAY = 24 * 60 * 60 * 1000

export type BulkKind = 'complete' | 'today' | 'evening' | 'someday' | 'trash' | 'move'

type Fields = Record<string, unknown>

interface TaskChange {
  id: string
  /** Previous values of the fields the action changed (undefined = absent). */
  before: Fields
  /** Values right after the action; undo skips the task if any of them moved since. */
  after: Fields
}

interface ProjectChange {
  id: string
  before: number | undefined
  after: number | undefined
}

export interface BulkSnapshot {
  changes: TaskChange[]
  projects: ProjectChange[]
  /** Repeat copies spawned for the bulk-completed ids (removed on undo). */
  spawned: string[]
  /** Ids the operation actually changed (for toasts). */
  affected: string[]
}

/** Things-style destination ids shared by the move dialog and the bulk bar. */
export function applyDestinationTo(current: PersonalTaskStore, taskId: string, dest: string, now = Date.now()): void {
  const task = current.get(taskId)
  if (!task) return
  const tomorrow = startOfLocalDay(now) + DAY
  if (dest === 'list:inbox') current.moveTo(taskId, { list: 'inbox', projectId: null, areaId: null })
  else if (dest === 'when:today') current.setWhen(taskId, { kind: 'today' })
  else if (dest === 'when:evening') current.setWhen(taskId, { kind: 'evening' })
  else if (dest === 'when:tomorrow' || dest === 'when:upcoming') current.setWhen(taskId, { kind: 'date', at: tomorrow })
  else if (dest === 'when:anytime') current.setWhen(taskId, { kind: 'anytime' })
  else if (dest === 'when:someday') current.setWhen(taskId, { kind: 'someday' })
  else if (dest === 'noplace') current.moveTo(taskId, { projectId: null, areaId: null })
  else if (dest.startsWith('project:')) current.moveTo(taskId, { projectId: dest.slice(8) })
  else if (dest.startsWith('area:')) current.moveTo(taskId, { areaId: dest.slice(5) })
  else if (dest.startsWith('heading:')) {
    const [, pid, hid] = dest.split(':')
    if (pid && hid) current.moveTo(taskId, { projectId: pid, headingId: hid })
  } else if (dest === 'trash') current.trash(taskId)
  else if (dest === 'logbook' && !current.get(taskId)!.completedAt) current.completeTask(taskId)
  if (current.get(taskId)?.trashedAt != null && dest !== 'trash') current.restore(taskId)
}

const WHEN: Record<'today' | 'evening' | 'someday', TaskWhen> = {
  today: { kind: 'today' },
  evening: { kind: 'evening' },
  someday: { kind: 'someday' },
}

function copy<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value)) as T
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function diff(before: PersonalTask, after: PersonalTask): { before: Fields; after: Fields } | null {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  const b: Fields = {}
  const a: Fields = {}
  for (const key of keys) {
    if (key === 'id' || key === 'createdAt') continue
    const prev = (before as unknown as Fields)[key]
    const next = (after as unknown as Fields)[key]
    if (same(prev, next)) continue
    b[key] = copy(prev)
    a[key] = copy(next)
  }
  return Object.keys(b).length ? { before: b, after: a } : null
}

/**
 * Runs one bulk operation on `current` (already a mutable draft).
 * `pending` holds ids mid-complete-animation; every action skips them.
 */
export function runBulkOperation(
  current: PersonalTaskStore,
  ids: readonly string[],
  kind: BulkKind,
  opts: { pending?: ReadonlySet<string>; dest?: string; now?: number } = {},
): BulkSnapshot {
  const idSet = new Set(ids)
  const touched = (task: PersonalTask) => idSet.has(task.id) || (task.parentId != null && idSet.has(task.parentId))
  const beforeTasks = new Map(current.list().filter(touched).map((task) => [task.id, copy(task)]))
  const beforeProjects = new Map(current.projects().map((project) => [project.id, project.trashedAt]))
  const affected: string[] = []
  const spawned: string[] = []
  for (const id of ids) {
    const task = current.get(id)
    if (!task || opts.pending?.has(id)) continue
    switch (kind) {
      case 'complete': {
        if (task.completedAt || task.cancelledAt) continue
        const hadNext = task.repeatNextId != null
        const { next } = current.completeTask(id, opts.now)
        if (next && !hadNext) spawned.push(next.id)
        break
      }
      case 'trash':
        if (task.trashedAt != null) continue
        current.trash(id, opts.now)
        break
      case 'move':
        if (!opts.dest) continue
        applyDestinationTo(current, id, opts.dest, opts.now)
        break
      default:
        current.setWhen(id, WHEN[kind], opts.now)
    }
    affected.push(id)
  }
  const changes: TaskChange[] = []
  for (const [id, before] of beforeTasks) {
    const live = current.get(id)
    const delta = live ? diff(before, live) : null
    if (delta) changes.push({ id, ...delta })
  }
  const projects: ProjectChange[] = []
  for (const project of current.projects()) {
    const before = beforeProjects.get(project.id)
    if (beforeProjects.has(project.id) && before !== project.trashedAt) projects.push({ id: project.id, before, after: project.trashedAt })
  }
  return { changes, projects, spawned, affected }
}

/**
 * Reverts only the fields the action changed. A task (or project) edited after
 * the action — any changed field no longer holds its post-action value — is left alone.
 */
export function undoBulkOperation(current: PersonalTaskStore, snapshot: BulkSnapshot): void {
  for (const id of snapshot.spawned) if (current.get(id)) current.remove(id)
  for (const change of snapshot.changes) {
    const live = current.get(change.id) as unknown as Fields | undefined
    if (!live) continue
    if (!Object.entries(change.after).every(([key, value]) => same(live[key], value))) continue
    const patch: Fields = {}
    for (const key of Object.keys(change.after)) patch[key] = copy(change.before[key])
    current.update(change.id, patch as Parameters<PersonalTaskStore['update']>[1])
  }
  for (const change of snapshot.projects) {
    const project = current.projects().find((p) => p.id === change.id)
    if (project && project.trashedAt === change.after) current.updateProject(change.id, { trashedAt: change.before })
  }
}

// ── Selection transitions (pure, used by the page and tests) ─────────────────

export interface SelectionState {
  multi: Set<string>
  focus: string | null
}

/** After a ⌘-toggle: one or zero ids collapse back to plain single selection. */
export function settleToggle(next: Set<string>, focus: string | null): SelectionState {
  if (next.size > 1) return { multi: next, focus }
  const [only] = [...next]
  return { multi: new Set(), focus: only ?? null }
}

export function selectAll(order: readonly string[], focus: string | null): SelectionState {
  if (order.length < 2) return { multi: new Set(), focus: order[0] ?? focus }
  return { multi: new Set(order), focus: focus && order.includes(focus) ? focus : order[0]! }
}

export function clearSelection(focus: string | null): SelectionState {
  return { multi: new Set(), focus }
}

export function plainClick(id: string): SelectionState {
  return { multi: new Set(), focus: id }
}

/** Rows left the view: re-settle the pruned set, collapsing to single selection at ≤ 1. */
export function settlePrune(pruned: Set<string>, focus: string | null): SelectionState {
  if (pruned.size > 1) return { multi: pruned, focus: focus && pruned.has(focus) ? focus : [...pruned][0]! }
  const [only] = [...pruned]
  return { multi: new Set(), focus: only ?? focus }
}

/** ⇧-click range: keep the focused row if it is inside the range, else focus the clicked row. */
export function rangeFocus(range: ReadonlySet<string>, focus: string | null, clicked: string): string {
  return focus && range.has(focus) ? focus : clicked
}
