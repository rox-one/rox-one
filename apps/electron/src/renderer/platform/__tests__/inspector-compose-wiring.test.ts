import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')

describe('inspector action rail compose wiring', () => {
  it('exposes a mount-safe compose request API for the mode screens', () => {
    const requests = readFileSync(join(root, 'inspector-compose-events.ts'), 'utf8')
    expect(requests).toContain('export function requestCompose(target: ComposeTarget)')
    expect(requests).toContain('export function consumePendingCompose(target: ComposeTarget)')
    expect(requests).toContain("export type ComposeTarget = 'tasks' | 'meetings' | 'notes'")
  })

  it('every mode screen consumes its own compose request on mount', () => {
    for (const [file, target] of [
      ['../pages/TasksPage.tsx', 'tasks'],
      ['../pages/MeetingsPage.tsx', 'meetings'],
      ['../pages/NotesPage.tsx', 'notes'],
    ] as const) {
      const page = readFileSync(join(root, file), 'utf8')
      expect(page).toContain(`consumePendingCompose('${target}')`)
      expect(page).not.toContain('COMPOSE_EVENT')
    }
  })

  it('InspectorActionRail requests compose for the panel it pushes next', () => {
    const rail = readFileSync(join(root, 'InspectorActionRail.tsx'), 'utf8')
    expect(rail).toContain('pushPanelAtom')
    expect(rail).toContain("requestCompose('tasks')")
    expect(rail).toContain("requestCompose('meetings')")
    expect(rail).toContain("requestCompose('notes')")
    expect(rail).toContain('focusedPanelIndexAtom')
    expect(rail).not.toContain('dispatchEvent')
  })
})
