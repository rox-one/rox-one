/**
 * Column-list windowing for Issue 05 board virtualization.
 * Reuses table flatten/window math; estimated tile heights plus overscan.
 */

import {
  flattenTableGroups,
  virtualTableWindow,
  type FlattenedTableGroups,
} from '../session-table/table-virtualization'
import type { KanbanTask } from './types'

export const KANBAN_TILE_BASE_HEIGHT = 88
export const KANBAN_TILE_STACK_GAP = 8
export const KANBAN_SUBTASK_ROW_HEIGHT = 28
export const KANBAN_EXPANDED_CHROME_HEIGHT = 40
export const KANBAN_COLUMN_OVERSCAN = 480

export function kanbanTileRowHeight(task: KanbanTask, expanded: boolean): number {
  const body = expanded
    ? KANBAN_TILE_BASE_HEIGHT + KANBAN_EXPANDED_CHROME_HEIGHT + task.subtasks.length * KANBAN_SUBTASK_ROW_HEIGHT
    : KANBAN_TILE_BASE_HEIGHT
  return body + KANBAN_TILE_STACK_GAP
}

/**
 * `measuredHeights` (task id → rendered tile height, without the stack gap)
 * replaces the estimate once a tile has been laid out, so taller cards
 * (labels, model chip, subtask affordance) never overlap their neighbours.
 */
export function flattenKanbanColumnTasks(
  tasks: readonly KanbanTask[],
  expandedTaskIds: ReadonlySet<string>,
  measuredHeights?: ReadonlyMap<string, number>,
): FlattenedTableGroups<KanbanTask, { key: string }> {
  return flattenTableGroups([{ bucket: null, items: tasks }], new Set(), {
    getItemKey: (task) => task.id,
    rowHeight: KANBAN_TILE_BASE_HEIGHT + KANBAN_TILE_STACK_GAP,
    headerHeight: 0,
    getRowHeight: (task) => {
      const measured = measuredHeights?.get(task.id)
      return measured != null && measured > 0
        ? Math.ceil(measured) + KANBAN_TILE_STACK_GAP
        : kanbanTileRowHeight(task, expandedTaskIds.has(task.id))
    },
  })
}

export function kanbanColumnWindow(
  flattened: FlattenedTableGroups<KanbanTask, { key: string }>,
  listOffsetTop: number,
  scrollTop: number,
  viewportHeight: number,
  overscan = KANBAN_COLUMN_OVERSCAN,
) {
  return virtualTableWindow(
    flattened.entries,
    scrollTop - listOffsetTop,
    viewportHeight,
    overscan,
  )
}

export function listOffsetInScrollParent(list: HTMLElement, scrollParent: HTMLElement): number {
  const listBox = list.getBoundingClientRect()
  const parentBox = scrollParent.getBoundingClientRect()
  return listBox.top - parentBox.top + scrollParent.scrollTop
}
