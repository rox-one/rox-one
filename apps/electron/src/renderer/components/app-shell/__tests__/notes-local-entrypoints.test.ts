import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseRouteToNavigationState } from '../../../../shared/route-parser'
import { routes } from '../../../../shared/routes'
import { APP_NAV_DESTINATIONS_BY_ID } from '../nav-destinations'
import { getActiveService, getServiceContextLinks, serviceHasNavigator } from '../service-navigation'

const appShellSource = readFileSync(join(__dirname, '../AppShell.tsx'), 'utf8')
const workspaceRailSource = readFileSync(join(__dirname, '../WorkspaceIconRail.tsx'), 'utf8')
const notesPageSource = readFileSync(join(__dirname, '../../../pages/NotesPage.tsx'), 'utf8')

describe('local Notes entry points', () => {
  it('keeps Notes a primary service with its own navigation context', () => {
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

    expect(primaryLinks).toContain('id: "nav:notes"')
    expect(primaryLinks).toContain('onClick: handleNotesClick')
    expect(primaryLinks).not.toContain('id: "nav:knowledge"')
  })

  it('uses the canonical local Notes route from both rail entry points', () => {
    const notesDestination = APP_NAV_DESTINATIONS_BY_ID.notes
    const notesRailLink = workspaceRailSource.slice(
      workspaceRailSource.indexOf('if (link.kind === "notes")'),
      workspaceRailSource.indexOf('const url'),
    )

    expect(notesDestination.route?.()).toBe(routes.view.notes())
    expect(notesDestination.isActive(parseRouteToNavigationState(routes.view.notes('local-note'))!)).toBe(true)
    expect(notesDestination.isActive(parseRouteToNavigationState(routes.view.knowledge())!)).toBe(false)
    expect(notesRailLink).toContain('navigate(routes.view.notes());')
    expect(notesRailLink).not.toContain('navigate(routes.view.knowledge());')
  })

  it('loads the local Markdown Notes surface without a knowledge-engine API', () => {
    expect(notesPageSource).toContain('window.electronAPI.listNotes(activeWorkspaceId)')
    expect(notesPageSource).not.toContain('window.electronAPI.knowledge')
  })
})
