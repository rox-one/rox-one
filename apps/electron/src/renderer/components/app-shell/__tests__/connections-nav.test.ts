import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { APP_NAV_DESTINATIONS } from '../nav-destinations'
import { routes } from '../../../../shared/routes'
import { invokeShellNavigationCallback } from './rox-readiness-ui-001.shell-callback'

const appShellSource = readFileSync(join(__dirname, '../AppShell.tsx'), 'utf8')
const mainContentSource = readFileSync(join(__dirname, '../MainContentPanel.tsx'), 'utf8')

describe('CF-6.2 Connections nav and surface', () => {
  it('registers an enabled connections destination for the Workbench rail', () => {
    const dest = APP_NAV_DESTINATIONS.find((entry) => entry.id === 'connections')
    expect(dest).toBeDefined()
    expect(dest?.route?.()).toBe(routes.view.connections())
    expect(dest?.labelKey).toBe('sidebar.connections')
    expect(dest?.disabledTooltipKey).toBeUndefined()
    expect(dest?.linkId).toBe('nav:connections')
  })

  it('exposes Connections in the single primary sidebar using the canonical route', () => {
    expect(appShellSource).toContain('id: "nav:connections"')
    expect(invokeShellNavigationCallback(join(__dirname, '../AppShell.tsx'), { sidebarId: 'nav:connections' }))
      .toEqual([routes.view.connections()])
  })

  it('renders ConnectionsPage from MainContentPanel on the connections navigator', () => {
    expect(mainContentSource).toContain('isConnectionsNavigation')
    expect(mainContentSource).toContain('ConnectionsPage')
  })
})
