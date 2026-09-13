import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const COLUMN = readFileSync(join(__dirname, '..', 'KanbanColumn.tsx'), 'utf8')

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
