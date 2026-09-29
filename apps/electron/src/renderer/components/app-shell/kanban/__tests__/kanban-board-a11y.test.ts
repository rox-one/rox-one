import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const BOARD = readFileSync(join(__dirname, '..', 'KanbanBoard.tsx'), 'utf8')
const CONTAINER = readFileSync(join(__dirname, '..', 'KanbanBoardContainer.tsx'), 'utf8')

describe('kanban board a11y + move rollback (GG #561)', () => {
  it('wires KeyboardSensor alongside SmartPointerSensor like sortable-list', () => {
    expect(BOARD).toContain('KeyboardSensor')
    expect(BOARD).toContain('useSensor(KeyboardSensor)')
    expect(BOARD).toContain('SmartPointerSensor')
    expect(BOARD).toContain('accessibility={{')
    expect(BOARD).toContain('announcements')
    expect(BOARD).toContain("t('kanban.a11y.instructions')")
    expect(BOARD).toContain("t('kanban.a11y.dragStart'")
    expect(BOARD).toContain("t('kanban.a11y.dragEnd'")
  })

  it('routes keyboard/pointer tile overs through onMoveTask (same handleMoveTask path)', () => {
    expect(BOARD).toContain('onMoveTask?.(String(active.id), { columnId: toColumn })')
    expect(BOARD).toContain('const overTask = tasks.find(t => t.id === overId)')
  })

  it('awaits setKanbanColumn and restores prior column+status on failure', () => {
    expect(CONTAINER).toContain("type: 'setKanbanColumn'")
    expect(CONTAINER).toContain('await window.electronAPI.sessionCommand')
    expect(CONTAINER).toContain('restorePrior')
    expect(CONTAINER).toContain("t('kanban.toastMoveFailed')")
    expect(CONTAINER).toContain('appliedAutoStatus')
    expect(CONTAINER).toContain('previousStatusId')
    expect(CONTAINER).toContain('kanbanColumn: previousColumn')
  })
})
