import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { APP_NAV_DESTINATIONS } from '../nav-destinations'
import { routes } from '../../../../shared/routes'

const appShellSource = readFileSync(join(__dirname, '../AppShell.tsx'), 'utf8')
const mainContentSource = readFileSync(join(__dirname, '../MainContentPanel.tsx'), 'utf8')

describe('RMA-I012 Meetings nav and surface', () => {
  it('registers an enabled meetings destination for the Workbench rail', () => {
    const dest = APP_NAV_DESTINATIONS.find((entry) => entry.id === 'meetings')
    expect(dest).toBeDefined()
    expect(dest?.route?.()).toBe(routes.view.meetings())
    expect(dest?.labelKey).toBe('sidebar.meetings')
    expect(dest?.disabledTooltipKey).toBeUndefined()
    expect(dest?.linkId).toBe('nav:meetings')
  })

  it('wires Meetings into AppShell and MainContentPanel', () => {
    expect(appShellSource).toContain('id: "nav:meetings"')
    expect(appShellSource).toContain('handleMeetingsClick')
    expect(mainContentSource).toContain('isMeetingsNavigation')
    expect(mainContentSource).toContain('MeetingsPage')
  })
})
