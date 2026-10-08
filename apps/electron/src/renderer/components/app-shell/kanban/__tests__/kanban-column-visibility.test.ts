import { describe, expect, it } from 'bun:test'
import { shouldHideEmptyNestedKanbanColumns } from '../kanban-column-visibility'

describe('shouldHideEmptyNestedKanbanColumns', () => {
  it('hides empty nested groups only when the display setting is disabled', () => {
    expect(shouldHideEmptyNestedKanbanColumns('project', false)).toBe(true)
    expect(shouldHideEmptyNestedKanbanColumns('project', true)).toBe(false)
  })

  it('keeps workflow status lanes visible as drop targets', () => {
    expect(shouldHideEmptyNestedKanbanColumns('none', false)).toBe(false)
    expect(shouldHideEmptyNestedKanbanColumns('status', false)).toBe(false)
  })
})
