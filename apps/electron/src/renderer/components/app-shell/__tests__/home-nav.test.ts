import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { routes } from '../../../../shared/routes'

const appShellSource = readFileSync(join(__dirname, '../AppShell.tsx'), 'utf8')
const mainContentSource = readFileSync(join(__dirname, '../MainContentPanel.tsx'), 'utf8')
const modesSeedSource = readFileSync(join(__dirname, '../../../platform/modes-seed.ts'), 'utf8')

describe('Workbench Home nav and surface', () => {
  it('seeds Home as a live Mode Bar destination', () => {
    expect(modesSeedSource).toContain("id: 'home'")
    expect(modesSeedSource).toContain('routes.view.home()')
    expect(modesSeedSource).toContain('isHomeNavigation')
    expect(routes.view.home()).toBe('home')
  })

  it('hides the navigator column on the home route', () => {
    expect(appShellSource).toContain('isHomeNavigation(navState)')
    expect(appShellSource).toContain('isHomeNavigation(navState) || isConnectionsNavigation(navState)')
  })

  it('renders HomeFrontPage from MainContentPanel on the home navigator', () => {
    expect(mainContentSource).toContain('isHomeNavigation')
    expect(mainContentSource).toContain('HomeFrontPage')
  })
})
