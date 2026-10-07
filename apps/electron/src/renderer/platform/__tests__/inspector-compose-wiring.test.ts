import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')

describe('inspector action rail compose wiring', () => {
  it('exports stable event names consumed by mode screens', () => {
    const events = readFileSync(join(root, 'inspector-compose-events.ts'), 'utf8')
    expect(events).toContain("export const ROX_TASKS_COMPOSE_EVENT = 'rox:tasks:compose'")
    expect(events).toContain("export const ROX_MEETINGS_COMPOSE_EVENT = 'rox:meetings:compose'")
    expect(events).toContain("export const ROX_NOTES_COMPOSE_EVENT = 'rox:notes:compose'")
  })

  it('TasksPage listens for tasks compose', () => {
    const tasks = readFileSync(join(root, '../pages/TasksPage.tsx'), 'utf8')
    expect(tasks).toContain('ROX_TASKS_COMPOSE_EVENT')
    expect(tasks).toContain('addEventListener')
  })

  it('InspectorActionRail dispatches compose after adjacent navigation', () => {
    const rail = readFileSync(join(root, 'InspectorActionRail.tsx'), 'utf8')
    expect(rail).toContain('pushPanelAtom')
    expect(rail).toContain('ROX_TASKS_COMPOSE_EVENT')
    expect(rail).toContain('focusedPanelIndexAtom')
  })
})
