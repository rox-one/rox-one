import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { routes } from '../../../../shared/routes'
import { parseRouteToNavigationState } from '../../../../shared/route-parser'
import { APP_NAV_DESTINATIONS_BY_ID } from '../nav-destinations'
import { serviceHasNavigator } from '../service-navigation'

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
    const home = APP_NAV_DESTINATIONS_BY_ID.home
    expect(home.railGroup).toBe('more')
    expect(home.route?.()).toBe(routes.view.home())
    const state = parseRouteToNavigationState(home.route!())
    expect(state).not.toBeNull()
    expect(home.isActive(state!)).toBe(true)
    expect(serviceHasNavigator(state!)).toBe(false)
  })

  it('renders HomeFrontPage from MainContentPanel on the home navigator', () => {
    expect(mainContentSource).toContain('isHomeNavigation')
    expect(mainContentSource).toContain('HomeFrontPage')
  })
})
