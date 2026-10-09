import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const COLUMN = readFileSync(join(__dirname, '..', 'KanbanColumn.tsx'), 'utf8')
const CONTAINER = readFileSync(join(__dirname, '..', 'KanbanBoardContainer.tsx'), 'utf8')

describe('kanban column virtualization chrome', () => {
  it('windows column and group task lists instead of mapping every tile', () => {
    expect(COLUMN).toContain('KanbanVirtualTaskList')
    expect(COLUMN).not.toContain('tasks.map(task =>')
    expect(COLUMN).not.toContain('group.tasks.map')
  })

  it('shows translated empty drop copy and 70% chevron contrast', () => {
    expect(COLUMN).toContain("t('kanban.column.emptyDrop')")
    expect(COLUMN).toContain('data-testid="kanban-column-empty"')
    expect(COLUMN).toContain('text-foreground/70')
    expect(COLUMN).not.toContain('text-foreground/40')
  })
})

describe('kanban board workboard live wiring (row b2.2)', () => {
  it('subscribes to workboard:changed and reloads through the coalescer', () => {
    expect(CONTAINER).toContain('createBoardLiveRefresh(')
    expect(CONTAINER).toContain('window.electronAPI.onWorkboardChanged')
    expect(CONTAINER).toContain('window.electronAPI.readWorkboard')
    expect(CONTAINER).toContain('workboardLiveStateAtom')
  })

  it('keeps the kanban config subscription and unsubscribes on unmount', () => {
    expect(CONTAINER).toContain('onKanbanConfigChanged')
    expect(CONTAINER).toContain('unsubscribe()')
    expect(CONTAINER).toContain('handle.dispose()')
  })

  it('keeps the optimistic drag + rollback and defers reloads during a card write', () => {
    expect(CONTAINER).toContain('restorePrior')
    expect(CONTAINER).toContain('beginCardWrite()')
    expect(CONTAINER).toContain('endCardWrite')
  })
})
