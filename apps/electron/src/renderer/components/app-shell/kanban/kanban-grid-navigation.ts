/**
 * Keyboard grid navigation for the Kanban board (W1.2).
 *
 * The board renders cards inside per-column scroll containers, and each column
 * window-virtualizes its cards, so off-window cards are not in the DOM. Grid
 * navigation therefore works off a *model* of the visible grid — the same
 * ordering the board renders and selection targets, owned by
 * `visibleKanbanColumnTaskIds` in `kanban-selection` (collapsed columns/groups
 * skipped, priority sections before project sections) — and the component layer
 * turns a target `KanbanFocus` back into DOM focus (scrolling when the row is
 * virtualized out).
 *
 * This module is pure: no DOM, no React. It owns the movement contract
 * (arrows, Home/End, column boundaries, empty columns) so it can be unit-tested
 * in isolation.
 */

import type { KanbanProjectGroup } from './KanbanColumn'
import { visibleKanbanColumnTaskIds } from './kanban-selection'
import type { KanbanColumnId, KanbanColumnMeta, KanbanTask } from './types'

/** One navigable column: its id plus the visible card ids top→bottom. */
export interface KanbanGridColumn {
  id: KanbanColumnId
  /** Visible task ids in visual order (collapsed columns/groups already removed). */
  taskIds: readonly string[]
}

/** The navigable board shape: only expanded columns, in board order. */
export interface KanbanGrid {
  columns: readonly KanbanGridColumn[]
}

/**
 * A focused spot on the grid. `taskId === null` means the column container
 * itself is focused (an empty column, or the Escape target of a card).
 */
export interface KanbanFocus {
  columnId: KanbanColumnId
  taskId: string | null
}

export type KanbanGridNavKey =
  | 'ArrowUp'
  | 'ArrowDown'
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'Home'
  | 'End'

const NAV_KEYS: Record<KanbanGridNavKey, true> = {
  ArrowUp: true,
  ArrowDown: true,
  ArrowLeft: true,
  ArrowRight: true,
  Home: true,
  End: true,
}

/** Narrow a raw `KeyboardEvent.key` to a grid-navigation key. */
export function isKanbanGridNavKey(key: string): key is KanbanGridNavKey {
  return Object.hasOwn(NAV_KEYS, key)
}

/** Row index within a column for a focus (taskId null / unknown → -1). */
export interface KanbanGridPosition {
  columnIndex: number
  /** -1 when the column container itself is focused. */
  rowIndex: number
}

/**
 * Build the navigable grid from the board's render inputs. Per-column card
 * order comes from `visibleKanbanColumnTaskIds` — the single ordering rule the
 * board renders and selection flattens (`flattenVisibleKanbanTaskIds`) — so
 * keyboard order always matches the visual order. Collapsed columns are not
 * navigable at all; an expanded but empty column stays navigable as a container.
 */
export function buildKanbanGrid(
  columns: readonly KanbanColumnMeta[],
  tasksByColumn: ReadonlyMap<KanbanColumnId, readonly KanbanTask[]>,
  groupsByColumn: ReadonlyMap<KanbanColumnId, readonly KanbanProjectGroup[]> | null,
  priorityGroupsByColumn: ReadonlyMap<KanbanColumnId, readonly KanbanProjectGroup[]> | null,
  collapsedGroupKeys?: ReadonlySet<string>,
): KanbanGrid {
  const result: KanbanGridColumn[] = []
  for (const column of columns) {
    const taskIds = visibleKanbanColumnTaskIds(
      column,
      tasksByColumn,
      groupsByColumn,
      priorityGroupsByColumn,
      collapsedGroupKeys,
    )
    if (!taskIds) continue
    result.push({ id: column.id, taskIds })
  }
  return { columns: result }
}

/** Locate a focus on the grid; null when its column is not navigable. */
export function resolveKanbanFocus(
  grid: KanbanGrid,
  focus: KanbanFocus,
): KanbanGridPosition | null {
  const columnIndex = grid.columns.findIndex(column => column.id === focus.columnId)
  if (columnIndex < 0) return null
  if (focus.taskId == null) return { columnIndex, rowIndex: -1 }
  const rowIndex = grid.columns[columnIndex]!.taskIds.indexOf(focus.taskId)
  return { columnIndex, rowIndex: rowIndex < 0 ? -1 : rowIndex }
}

/**
 * Next focus for an arrow / Home / End key. Returns null at a hard boundary
 * (moving left off the first column or right off the last) or when the current
 * focus is not on the grid. Movement never mutates the board — it only computes
 * where focus should go; activation and opening stay with the tile.
 */
export function moveKanbanGridFocus(
  grid: KanbanGrid,
  focus: KanbanFocus,
  key: KanbanGridNavKey,
): KanbanFocus | null {
  const pos = resolveKanbanFocus(grid, focus)
  if (!pos) return null
  const column = grid.columns[pos.columnIndex]!
  const lastRow = column.taskIds.length - 1

  const focusAtRow = (row: number): KanbanFocus =>
    row < 0
      ? { columnId: column.id, taskId: null }
      : { columnId: column.id, taskId: column.taskIds[row]! }

  switch (key) {
    case 'ArrowDown': {
      if (column.taskIds.length === 0) return { columnId: column.id, taskId: null }
      // From the container (row -1) the first card; else the next card, clamped.
      const row = pos.rowIndex < 0 ? 0 : Math.min(pos.rowIndex + 1, lastRow)
      return focusAtRow(row)
    }
    case 'ArrowUp': {
      if (column.taskIds.length === 0) return { columnId: column.id, taskId: null }
      const row = pos.rowIndex < 0 ? -1 : Math.max(pos.rowIndex - 1, 0)
      return focusAtRow(row)
    }
    case 'Home':
      return focusAtRow(column.taskIds.length === 0 ? -1 : 0)
    case 'End':
      return focusAtRow(lastRow)
    case 'ArrowLeft':
      return moveKanbanGridColumn(grid, pos, -1)
    case 'ArrowRight':
      return moveKanbanGridColumn(grid, pos, 1)
  }
  return null
}

/**
 * Cross-column movement. Preserves the current row where the target column is
 * tall enough and clamps otherwise; an empty target column takes container
 * focus. From container focus (row -1) the target's first card is chosen.
 */
function moveKanbanGridColumn(
  grid: KanbanGrid,
  pos: KanbanGridPosition,
  delta: -1 | 1,
): KanbanFocus | null {
  const targetIndex = pos.columnIndex + delta
  if (targetIndex < 0 || targetIndex >= grid.columns.length) return null
  const target = grid.columns[targetIndex]!
  if (target.taskIds.length === 0) return { columnId: target.id, taskId: null }
  const desiredRow = pos.rowIndex < 0 ? 0 : pos.rowIndex
  const rowIndex = Math.min(desiredRow, target.taskIds.length - 1)
  return { columnId: target.id, taskId: target.taskIds[rowIndex]! }
}

/**
 * Activation of a column container (Enter/Space on the container): enter its
 * first card, or stay on the container when the column is empty. Returns null
 * when the column is not navigable.
 */
export function enterKanbanColumn(
  grid: KanbanGrid,
  columnId: KanbanColumnId,
): KanbanFocus | null {
  const column = grid.columns.find(c => c.id === columnId)
  if (!column) return null
  return { columnId: column.id, taskId: column.taskIds[0] ?? null }
}

/**
 * Escape: move focus from a card out to its column container. Already on the
 * container → null (the caller releases focus out of the board).
 */
export function exitKanbanGridFocus(focus: KanbanFocus): KanbanFocus | null {
  if (focus.taskId == null) return null
  return { columnId: focus.columnId, taskId: null }
}