/**
 * Bulk operations for the Задачи multi-select bar. Every operation runs inside a
 * single store mutation and returns an undo snapshot that restores each touched
 * task (and its subtasks) to its previous state and removes tasks the operation
 * spawned (next occurrences of repeating tasks).
 */
import { startOfLocalDay, type PersonalTask, type PersonalTaskStore, type TaskWhen } from '@rox/core/tasks/personal'

const DAY = 24 * 60 * 60 * 1000

export type BulkKind = 'complete' | 'today' | 'evening' | 'someday' | 'trash' | 'move'

export interface BulkSnapshot {
  /** Deep copies of every touched task before the operation. */
  before: PersonalTask[]
  /** Ids created by the operation (removed on undo). */
  created: string[]
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

function copy(task: PersonalTask): PersonalTask {
  return JSON.parse(JSON.stringify(task)) as PersonalTask
}

/**
 * Runs one bulk operation on `current` (already a mutable draft).
 * `pending` holds ids mid-complete-animation; complete skips them.
 */
export function runBulkOperation(
  current: PersonalTaskStore,
  ids: readonly string[],
  kind: BulkKind,
  opts: { pending?: ReadonlySet<string>; dest?: string; now?: number } = {},
): BulkSnapshot {
  const idSet = new Set(ids)
  const existing = new Set(current.list().map((task) => task.id))
  const before = current.list().filter((task) => idSet.has(task.id) || (task.parentId != null && idSet.has(task.parentId))).map(copy)
  const affected: string[] = []
  for (const id of ids) {
    const task = current.get(id)
    if (!task) continue
    switch (kind) {
      case 'complete':
        if (task.completedAt || task.cancelledAt || opts.pending?.has(id)) continue
        current.completeTask(id, opts.now)
        break
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
  const created = current.list().map((task) => task.id).filter((id) => !existing.has(id))
  return { before, created, affected }
}

/** Restores every snapshotted task field-for-field and drops spawned tasks. */
export function undoBulkOperation(current: PersonalTaskStore, snapshot: BulkSnapshot): void {
  for (const id of snapshot.created) if (current.get(id)) current.remove(id)
  for (const saved of snapshot.before) {
    const live = current.get(saved.id)
    if (!live) continue
    const patch: Record<string, unknown> = {}
    for (const key of Object.keys(live)) if (key !== 'id' && key !== 'createdAt' && !(key in saved)) patch[key] = undefined
    for (const [key, value] of Object.entries(saved)) if (key !== 'id' && key !== 'createdAt') patch[key] = value
    current.update(saved.id, patch as Parameters<PersonalTaskStore['update']>[1])
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
