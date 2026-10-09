import type { KanbanProjectGroup } from './KanbanColumn'
import type { KanbanColumnId, KanbanColumnMeta, KanbanTask } from './types'

/**
 * Single source of truth for the board's visible ordering: the card ids one
 * column shows, top→bottom, with collapsed groups removed.
 *
 * `null` means the column itself is collapsed: the board renders nothing for it,
 * so callers drop it (grid navigation) or skip it (selection flattening). A
 * grouped column follows its rendered section order — priority sections win over
 * project sections when both exist — and the ungrouped bucket is keyed
 * `__none__` so `collapsedGroupKeys` can hide it as well.
 */
export function visibleKanbanColumnTaskIds(
  column: KanbanColumnMeta,
  tasksByColumn: ReadonlyMap<KanbanColumnId, readonly KanbanTask[]>,
  groupsByColumn: ReadonlyMap<KanbanColumnId, readonly KanbanProjectGroup[]> | null,
  priorityGroupsByColumn: ReadonlyMap<KanbanColumnId, readonly KanbanProjectGroup[]> | null,
  collapsedGroupKeys?: ReadonlySet<string>,
): string[] | null {
  if (column.collapsed ?? column.defaultCollapsed ?? false) return null
  const sections =
    priorityGroupsByColumn?.get(column.id) ??
    groupsByColumn?.get(column.id)
  if (!sections) return (tasksByColumn.get(column.id) ?? []).map(task => task.id)
  const ids: string[] = []
  for (const section of sections) {
    const groupKey = section.projectId ?? '__none__'
    if (collapsedGroupKeys?.has(groupKey)) continue
    for (const task of section.tasks) ids.push(task.id)
  }
  return ids
}

/**
 * One visual ordering for board selection, range selection, and bulk targets:
 * `visibleKanbanColumnTaskIds` per column, concatenated in board order. Keyboard
 * grid navigation (`buildKanbanGrid`) reads the same rule, so the two orders
 * cannot drift apart.
 */
export function flattenVisibleKanbanTaskIds(
  columns: readonly KanbanColumnMeta[],
  tasksByColumn: ReadonlyMap<KanbanColumnId, readonly KanbanTask[]>,
  groupsByColumn: ReadonlyMap<KanbanColumnId, readonly KanbanProjectGroup[]> | null,
  priorityGroupsByColumn: ReadonlyMap<KanbanColumnId, readonly KanbanProjectGroup[]> | null,
  collapsedGroupKeys?: ReadonlySet<string>,
): string[] {
  const ids: string[] = []
  for (const column of columns) {
    const columnIds = visibleKanbanColumnTaskIds(
      column,
      tasksByColumn,
      groupsByColumn,
      priorityGroupsByColumn,
      collapsedGroupKeys,
    )
    if (!columnIds) continue
    for (const id of columnIds) ids.push(id)
  }
  return ids
}