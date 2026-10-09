import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseRouteToNavigationState } from '../../../../shared/route-parser'
import { routes } from '../../../../shared/routes'
import { APP_NAV_DESTINATIONS_BY_ID } from '../nav-destinations'
import { getActiveService, getServiceContextLinks, serviceHasNavigator } from '../service-navigation'

const appShellSource = readFileSync(join(__dirname, '../AppShell.tsx'), 'utf8')
const navDestinationsSource = readFileSync(join(__dirname, '../nav-destinations.ts'), 'utf8')
const notesPageSource = readFileSync(join(__dirname, '../../../pages/NotesPage.tsx'), 'utf8')

describe('local Notes entry points', () => {
  it('wires the primary shell sidebar and keyboard navigation to Notes', () => {
    const notes = APP_NAV_DESTINATIONS_BY_ID.notes
    const state = parseRouteToNavigationState(routes.view.notes())!
    expect(notes.railGroup).toBe('primary')
    expect(getActiveService(state)).toBe('notes')
    expect(serviceHasNavigator(state)).toBe(false)
    expect(getServiceContextLinks([
      { id: 'nav:notes' },
      { id: 'nav:labels' },
      { id: 'nav:skills' },
      { id: 'nav:knowledge' },
    ], 'notes')).toEqual([{ id: 'nav:notes' }])
    const primaryLinks = appShellSource.slice(
      appShellSource.indexOf('id: "nav:projects"'),
      appShellSource.indexOf('// --- Separator before footer ---'),
    )

    expect(appShellSource).toContain('onKeyDown={handleSidebarTreeKeyDown}')
    expect(notesPageSource).toContain('<ShellSidebarPortal')
    expect(primaryLinks).toContain('id: "nav:notes"')
    expect(primaryLinks).toContain('onClick: handleNotesClick')
    expect(primaryLinks).not.toContain('id: "nav:knowledge"')
  })

  it('uses the canonical local Notes route from the nav destination', () => {
    const notesDestination = navDestinationsSource.slice(
      navDestinationsSource.indexOf("id: 'notes'"),
      navDestinationsSource.indexOf("id: 'automations'"),
    )

    expect(notesDestination).toContain('route: () => routes.view.notes()')
    expect(notesDestination).toContain('isActive: isNotesNavigation')
    const notesDestinationEntry = APP_NAV_DESTINATIONS_BY_ID.notes
    expect(notesDestinationEntry.route?.()).toBe(routes.view.notes())
    expect(notesDestinationEntry.isActive(parseRouteToNavigationState(routes.view.notes('local-note'))!)).toBe(true)
    expect(notesDestinationEntry.isActive(parseRouteToNavigationState(routes.view.knowledge())!)).toBe(false)
  })

  it('loads the local Markdown Notes surface without a knowledge-engine API', () => {
    expect(notesPageSource).toContain('window.electronAPI.listNotes(activeWorkspaceId)')
    expect(notesPageSource).not.toContain('window.electronAPI.knowledge')
  })
})
