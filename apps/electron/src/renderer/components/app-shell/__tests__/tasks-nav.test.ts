import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { APP_NAV_DESTINATIONS } from '../nav-destinations'
import { routes } from '../../../../shared/routes'

const appShellSource = readFileSync(join(__dirname, '../AppShell.tsx'), 'utf8')
const mainContentSource = readFileSync(join(__dirname, '../MainContentPanel.tsx'), 'utf8')

describe('Issue 17 Tasks nav and surface', () => {
  it('registers an enabled tasks destination for the Workbench rail', () => {
    const dest = APP_NAV_DESTINATIONS.find((entry) => entry.id === 'tasks')
    expect(dest).toBeDefined()
    expect(dest?.route?.()).toBe(routes.view.tasks())
    expect(dest?.labelKey).toBe('sidebar.tasks')
    expect(dest?.disabledTooltipKey).toBeUndefined()
    expect(dest?.linkId).toBe('nav:tasks')
  })

  it('wires Tasks into AppShell and MainContentPanel', () => {
    expect(appShellSource).toContain('id: "nav:tasks"')
    expect(appShellSource).toContain('handleTasksClick')
    expect(mainContentSource).toContain('isTasksNavigation')
    expect(mainContentSource).toContain('TasksPage')
  })
})
