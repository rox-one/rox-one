import { describe, expect, it } from 'bun:test'
import { isDetailNavState, sessionCatalogOwnsWorkspace } from '../nav-helpers'
import { parseRouteToNavigationState } from '../../../shared/route-parser'
import { routes } from '../../../shared/routes'

describe('isDetailNavState', () => {
  it('treats Settings Overview as a compact detail surface', () => {
    expect(isDetailNavState({ navigator: 'settings', subpage: null })).toBe(true)
    expect(isDetailNavState({ navigator: 'settings', subpage: 'runtime' })).toBe(true)
  })

  it('keeps other navigator semantics', () => {
    expect(isDetailNavState(null)).toBe(false)
    expect(isDetailNavState({ navigator: 'sessions', filter: { kind: 'allSessions' }, details: null })).toBe(false)
    expect(isDetailNavState({
      navigator: 'sessions',
      filter: { kind: 'allSessions' },
      details: { type: 'session', sessionId: 's1' },
    })).toBe(true)
    expect(isDetailNavState({ navigator: 'home', details: null })).toBe(true)
    expect(isDetailNavState({ navigator: 'memory', details: null })).toBe(false)
    expect(isDetailNavState({ navigator: 'tasks', details: null })).toBe(false)
    expect(isDetailNavState({ navigator: 'pages', details: null })).toBe(true)
    expect(isDetailNavState({ navigator: 'pages', details: { type: 'page', pageSlug: 'dash' } })).toBe(true)
  })
})

describe('session catalog workspace', () => {
  const desktop = { panelCount: 1, isCompact: false, navigatorHidden: false }

  it('uses the available area for a single catalog and preserves its filter route', () => {
    for (const route of [routes.view.allSessions(), routes.view.flagged(), routes.view.archived()]) {
      const state = parseRouteToNavigationState(route)
      const before = JSON.stringify(state)
      expect(sessionCatalogOwnsWorkspace(state, desktop)).toBe(true)
      expect(JSON.stringify(state)).toBe(before)
    }
  })

  it('keeps real session details, collection canvases and other services in content panels', () => {
    expect(sessionCatalogOwnsWorkspace({ navigator: 'sessions', filter: { kind: 'allSessions' }, details: { type: 'session', sessionId: 'actual' } }, desktop)).toBe(false)
    for (const route of [routes.view.board(), routes.view.table(), routes.view.heatmap(), routes.view.settings(), routes.view.notes(), routes.view.knowledge()]) {
      expect(sessionCatalogOwnsWorkspace(parseRouteToNavigationState(route), desktop)).toBe(false)
    }
    expect(sessionCatalogOwnsWorkspace(null, desktop)).toBe(false)
  })

  it('does not conceal other retained panels or override compact/focus mode', () => {
    const state = parseRouteToNavigationState(routes.view.allSessions())
    expect(sessionCatalogOwnsWorkspace(state, { ...desktop, panelCount: 4 })).toBe(false)
    expect(sessionCatalogOwnsWorkspace(state, { ...desktop, isCompact: true })).toBe(false)
    expect(sessionCatalogOwnsWorkspace(state, { ...desktop, navigatorHidden: true })).toBe(false)
    expect(sessionCatalogOwnsWorkspace(state, { ...desktop, panelCount: 0 })).toBe(true)
  })
})
