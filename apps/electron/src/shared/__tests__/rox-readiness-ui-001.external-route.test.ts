import { describe, expect, it } from 'bun:test'
import { createStore } from 'jotai'
import { buildRouteFromNavigationState, parseRouteToNavigationState, resolveViewRoute } from '../route-parser'
import { getNavigationStateKey, parseNavigationStateKey } from '../types'
import type { ViewRoute } from '../routes'
import { normalizePanelRouteForReconcile } from '../../renderer/contexts/navigation-reconcile'
import { getPanelTypeFromRoute, parseSessionIdFromRoute, panelStackAtom, reconcilePanelStackAtom } from '../../renderer/atoms/panel-stack'
import { isDetailNavState } from '../../renderer/lib/nav-helpers'

describe('UI-001 external route recovery', () => {
  const rejected = ['future/session/private', 'settings/future', 'knowledge/unknown/doc', 'notes/note/%E0%A4%A', 'cloud-run/%ZZ', 'extension/%', 'action/delete-session/s1']

  for (const route of rejected) {
    it(`retains unavailable address ${route} without session selection`, () => {
      const state = resolveViewRoute(route)
      expect(state).toEqual({ navigator: 'unavailable', route, details: null })
      expect(buildRouteFromNavigationState(state)).toBe(route)
      expect(parseNavigationStateKey(getNavigationStateKey(state))).toEqual(state)
      expect(isDetailNavState(state)).toBe(true)
      expect(getPanelTypeFromRoute(route as ViewRoute)).toBe('other')
      expect(parseSessionIdFromRoute(route as ViewRoute)).toBeNull()
      let selections = 0
      expect(normalizePanelRouteForReconcile(route as ViewRoute, () => {
        selections++
        return { navigator: 'sessions', filter: { kind: 'allSessions' }, details: { type: 'session', sessionId: 'unrelated' } }
      })).toBe(route as ViewRoute)
      expect(selections).toBe(0)
    })
  }

  it('reconciles valid and malformed panels atomically, retaining focus and proportions', () => {
    const store = createStore()
    const entries = [
      { route: 'allSessions/session/s1' as ViewRoute, proportion: 0.6 },
      { route: 'notes/note/%ZZ' as ViewRoute, proportion: 0.4 },
    ]
    expect(() => store.set(reconcilePanelStackAtom, { entries, focusedIndex: 1 })).not.toThrow()
    expect(store.get(panelStackAtom).map(({ route, panelType, proportion }) => ({ route, panelType, proportion })))
      .toEqual([{ route: entries[0].route, panelType: 'session', proportion: 0.6 }, { route: entries[1].route, panelType: 'other', proportion: 0.4 }])
  })

  it('preserves established parsing, query and explicit entity addresses', () => {
    for (const route of ['allSessions/session/s1', 'sources/source/s', 'skills/skill/s', 'projects/project/p', 'notes/note/n', 'pages/page/p', 'knowledge/document/d', 'extension/e/v', 'terminal/t', 'cloud-run/r', 'search?q=two%20words']) {
      expect(resolveViewRoute(route)).toEqual(parseRouteToNavigationState(route)!)
    }
    expect(parseSessionIdFromRoute('allSessions/session/s1?x=y' as ViewRoute)).toBe('s1')
    expect(parseRouteToNavigationState('knowledge/unknown/doc')?.navigator).toBe('sessions')
    expect(parseNavigationStateKey('unavailable:%ZZ')).toBeNull()
  })
})
