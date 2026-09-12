import { describe, expect, it } from 'bun:test'
import {
  flattenKanbanColumnTasks,
  kanbanColumnWindow,
  kanbanTileRowHeight,
  KANBAN_COLUMN_OVERSCAN,
  KANBAN_TILE_BASE_HEIGHT,
  KANBAN_TILE_STACK_GAP,
} from '../kanban-virtualization'
import type { KanbanTask } from '../types'

function task(id: string, subtasks = 0): KanbanTask {
  return {
    id,
    title: id,
    column: 'todo',
    statusId: 'todo',
    model: 'rox/fast',
    subtasks: Array.from({ length: subtasks }, (_, index) => ({
      id: `${id}-s${index}`,
      title: `s${index}`,
      runState: 'pending' as const,
      model: 'rox/fast',
    })),
  }
}

describe('kanbanTileRowHeight', () => {
  it('uses the collapsed stack height when the tile is closed', () => {
    expect(kanbanTileRowHeight(task('a'), false)).toBe(KANBAN_TILE_BASE_HEIGHT + KANBAN_TILE_STACK_GAP)
  })

  it('grows for expanded subtask rows', () => {
    const collapsed = kanbanTileRowHeight(task('a', 3), false)
    const expanded = kanbanTileRowHeight(task('a', 3), true)
    expect(expanded).toBeGreaterThan(collapsed)
  })
})

describe('flattenKanbanColumnTasks', () => {
  it('windows a 2000-tile column to the viewport plus overscan', () => {
    const tasks = Array.from({ length: 2000 }, (_, index) => task(`t${index}`))
    const started = performance.now()
    const flattened = flattenKanbanColumnTasks(tasks, new Set())
    const window = kanbanColumnWindow(flattened, 0, 4_800, 640)
    const elapsed = performance.now() - started
    const visible = flattened.entries.slice(window.startIndex, window.endIndex)

    expect(flattened.entries).toHaveLength(2000)
    expect(flattened.totalHeight).toBe(2000 * (KANBAN_TILE_BASE_HEIGHT + KANBAN_TILE_STACK_GAP))
    expect(visible.length).toBeGreaterThan(0)
    expect(visible.length).toBeLessThan(2000)
    expect(visible.length).toBeLessThan(Math.ceil((640 + 2 * KANBAN_COLUMN_OVERSCAN) / 80) + 4)
    expect(elapsed).toBeLessThan(50)
  })

  it('keeps expanded tiles in the offset math', () => {
    const flattened = flattenKanbanColumnTasks([task('a', 2), task('b')], new Set(['a']))
    const first = flattened.entries[0]
    const second = flattened.entries[1]
    expect(first?.kind).toBe('row')
    expect(second?.kind).toBe('row')
    expect(first && first.height).toBe(kanbanTileRowHeight(task('a', 2), true))
    expect(second && second.offset).toBe(first?.height)
  })
})
