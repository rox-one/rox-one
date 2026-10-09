import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  buildKanbanGrid,
  enterKanbanColumn,
  exitKanbanGridFocus,
  isKanbanGridNavKey,
  moveKanbanGridFocus,
  resolveKanbanFocus,
  type KanbanGrid,
} from '../kanban-grid-navigation'
import type { KanbanProjectGroup } from '../KanbanColumn'
import type { KanbanColumnMeta, KanbanTask } from '../types'

/**
 * A board with three cards in `todo`, one in `doing`, an empty middle column,
 * and two in `done` — enough to exercise rows, boundaries and empty columns.
 */
function sampleGrid(): KanbanGrid {
  return {
    columns: [
      { id: 'todo', taskIds: ['t1', 't2', 't3'] },
      { id: 'doing', taskIds: ['d1'] },
      { id: 'empty', taskIds: [] },
      { id: 'done', taskIds: ['n1', 'n2'] },
    ],
  }
}

describe('buildKanbanGrid mirrors visible board order', () => {
  const columns: KanbanColumnMeta[] = [
    { id: 'backlog', defaultCollapsed: true },
    { id: 'todo' },
    { id: 'doing' },
  ]
  const tasks: KanbanTask[] = [
    { id: 't1', title: 't1', column: 'todo', statusId: 'todo', subtasks: [] },
    { id: 't2', title: 't2', column: 'todo', statusId: 'todo', subtasks: [] },
    { id: 'd1', title: 'd1', column: 'doing', statusId: 'todo', subtasks: [] },
  ]
  const tasksByColumn = new Map([
    ['todo', tasks.filter(t => t.column === 'todo')],
    ['doing', tasks.filter(t => t.column === 'doing')],
  ])

  it('drops collapsed columns and keeps board order', () => {
    const grid = buildKanbanGrid(columns, tasksByColumn, null, null)
    expect(grid.columns.map(c => c.id)).toEqual(['todo', 'doing'])
    expect(grid.columns[0]!.taskIds).toEqual(['t1', 't2'])
  })

  it('skips collapsed project groups and their cards', () => {
    const groupsByColumn = new Map<string, KanbanProjectGroup[]>([
      [
        'todo',
        [
          { projectId: 'p1', name: 'P1', tasks: [tasks[0]!, tasks[1]!] },
          { projectId: null, name: 'None', tasks: [] },
        ],
      ],
    ])
    const collapsed = new Set(['p1'])
    const grid = buildKanbanGrid(columns, tasksByColumn, groupsByColumn, null, collapsed)
    expect(grid.columns.find(c => c.id === 'todo')!.taskIds).toEqual([])
  })
})

describe('grid movement within a column', () => {
  it('moves down and up between cards', () => {
    const grid = sampleGrid()
    expect(moveKanbanGridFocus(grid, { columnId: 'todo', taskId: 't1' }, 'ArrowDown')).toEqual({
      columnId: 'todo',
      taskId: 't2',
    })
    expect(moveKanbanGridFocus(grid, { columnId: 'todo', taskId: 't2' }, 'ArrowUp')).toEqual({
      columnId: 'todo',
      taskId: 't1',
    })
  })

  it('clamps at the first and last card', () => {
    const grid = sampleGrid()
    expect(moveKanbanGridFocus(grid, { columnId: 'todo', taskId: 't1' }, 'ArrowUp')).toEqual({
      columnId: 'todo',
      taskId: 't1',
    })
    expect(moveKanbanGridFocus(grid, { columnId: 'todo', taskId: 't3' }, 'ArrowDown')).toEqual({
      columnId: 'todo',
      taskId: 't3',
    })
  })

  it('Home goes to the first card and End to the last', () => {
    const grid = sampleGrid()
    expect(moveKanbanGridFocus(grid, { columnId: 'todo', taskId: 't2' }, 'Home')).toEqual({
      columnId: 'todo',
      taskId: 't1',
    })
    expect(moveKanbanGridFocus(grid, { columnId: 'todo', taskId: 't1' }, 'End')).toEqual({
      columnId: 'todo',
      taskId: 't3',
    })
  })

  it('from column-container focus moves into the first card', () => {
    const grid = sampleGrid()
    expect(moveKanbanGridFocus(grid, { columnId: 'todo', taskId: null }, 'ArrowDown')).toEqual({
      columnId: 'todo',
      taskId: 't1',
    })
  })
})

describe('grid movement across column boundaries', () => {
  it('preserves the row when the target column is tall enough', () => {
    const grid: KanbanGrid = {
      columns: [
        { id: 'a', taskIds: ['a1', 'a2', 'a3'] },
        { id: 'b', taskIds: ['b1', 'b2', 'b3'] },
      ],
    }
    expect(moveKanbanGridFocus(grid, { columnId: 'a', taskId: 'a2' }, 'ArrowRight')).toEqual({
      columnId: 'b',
      taskId: 'b2',
    })
    expect(moveKanbanGridFocus(grid, { columnId: 'b', taskId: 'b3' }, 'ArrowLeft')).toEqual({
      columnId: 'a',
      taskId: 'a3',
    })
  })

  it('clamps the row when the target column is shorter', () => {
    const grid = sampleGrid()
    // t3 is row 2 in `todo`; `doing` has only one card → clamp to it.
    expect(moveKanbanGridFocus(grid, { columnId: 'todo', taskId: 't3' }, 'ArrowRight')).toEqual({
      columnId: 'doing',
      taskId: 'd1',
    })
  })

  it('lands on container focus when crossing into an empty column', () => {
    const grid = sampleGrid()
    expect(moveKanbanGridFocus(grid, { columnId: 'doing', taskId: 'd1' }, 'ArrowRight')).toEqual({
      columnId: 'empty',
      taskId: null,
    })
  })

  it('from an empty column moves to the adjacent column first card', () => {
    const grid = sampleGrid()
    expect(moveKanbanGridFocus(grid, { columnId: 'empty', taskId: null }, 'ArrowRight')).toEqual({
      columnId: 'done',
      taskId: 'n1',
    })
    expect(moveKanbanGridFocus(grid, { columnId: 'empty', taskId: null }, 'ArrowLeft')).toEqual({
      columnId: 'doing',
      taskId: 'd1',
    })
  })

  it('stops at the outer boundaries', () => {
    const grid = sampleGrid()
    expect(moveKanbanGridFocus(grid, { columnId: 'todo', taskId: 't1' }, 'ArrowLeft')).toBeNull()
    expect(moveKanbanGridFocus(grid, { columnId: 'done', taskId: 'n1' }, 'ArrowRight')).toBeNull()
  })

  it('returns null when the focus is not on the grid', () => {
    const grid = sampleGrid()
    expect(moveKanbanGridFocus(grid, { columnId: 'ghost', taskId: 'x' }, 'ArrowDown')).toBeNull()
  })
})

describe('empty columns keep container focus', () => {
  it('ArrowUp/Down/Home/End on an empty column stay on the container', () => {
    const grid = sampleGrid()
    const at = { columnId: 'empty', taskId: null }
    for (const key of ['ArrowUp', 'ArrowDown', 'Home', 'End'] as const) {
      expect(moveKanbanGridFocus(grid, at, key)).toEqual(at)
    }
  })
})

describe('activation and escape', () => {
  it('Enter/Space on a container enters the first card', () => {
    const grid = sampleGrid()
    expect(enterKanbanColumn(grid, 'todo')).toEqual({ columnId: 'todo', taskId: 't1' })
  })

  it('Enter/Space on an empty column stays on the container', () => {
    const grid = sampleGrid()
    expect(enterKanbanColumn(grid, 'empty')).toEqual({ columnId: 'empty', taskId: null })
  })

  it('Escape moves a card out to its column container, then releases', () => {
    expect(exitKanbanGridFocus({ columnId: 'todo', taskId: 't1' })).toEqual({
      columnId: 'todo',
      taskId: null,
    })
    expect(exitKanbanGridFocus({ columnId: 'todo', taskId: null })).toBeNull()
  })
})

describe('helpers', () => {
  it('resolveKanbanFocus reports row -1 for container focus', () => {
    const grid = sampleGrid()
    expect(resolveKanbanFocus(grid, { columnId: 'doing', taskId: 'd1' })).toEqual({
      columnIndex: 1,
      rowIndex: 0,
    })
    expect(resolveKanbanFocus(grid, { columnId: 'empty', taskId: null })).toEqual({
      columnIndex: 2,
      rowIndex: -1,
    })
  })

  it('isKanbanGridNavKey narrows only navigation keys', () => {
    expect(isKanbanGridNavKey('ArrowUp')).toBe(true)
    expect(isKanbanGridNavKey('End')).toBe(true)
    expect(isKanbanGridNavKey('Enter')).toBe(false)
    expect(isKanbanGridNavKey('Escape')).toBe(false)
  })
})

describe('board + column wiring', () => {
  const BOARD = readFileSync(join(__dirname, '..', 'KanbanBoard.tsx'), 'utf8')
  const COLUMN = readFileSync(join(__dirname, '..', 'KanbanColumn.tsx'), 'utf8')

  it('board owns grid keyboard navigation', () => {
    expect(BOARD).toContain('moveKanbanGridFocus(grid, current, event.key)')
    expect(BOARD).toContain('enterKanbanColumn(grid, current.columnId)')
    expect(BOARD).toContain('exitKanbanGridFocus(current)')
    expect(BOARD).toContain('onKeyDown={handleBoardKeyDown}')
    expect(BOARD).toContain('data-kanban-task-id')
  })

  it('column exposes a focusable scroll container with a focus ring', () => {
    expect(COLUMN).toContain('data-kanban-column-scroll={column.id}')
    expect(COLUMN).toContain('tabIndex={-1}')
    expect(COLUMN).toContain('focus-visible:ring-2')
    expect(COLUMN).toContain("t('kanban.a11y.columnRegion'")
    expect(COLUMN).toContain('data-kanban-task-id={taskId}')
  })
})