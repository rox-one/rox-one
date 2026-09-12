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
})
