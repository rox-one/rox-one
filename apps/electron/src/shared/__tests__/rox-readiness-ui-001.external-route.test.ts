import { describe, expect, it } from 'bun:test'
import { createStore } from 'jotai'
import { buildRouteFromNavigationState, parseRouteToNavigationState, resolveViewRoute } from '../route-parser'
import { getNavigationStateKey, parseNavigationStateKey } from '../types'
import type { ViewRoute } from '../routes'
import { normalizePanelRouteForReconcile } from '../../renderer/contexts/navigation-reconcile'
import { getPanelTypeFromRoute, parseSessionIdFromRoute, panelStackAtom, reconcilePanelStackAtom } from '../../renderer/atoms/panel-stack'
import { isDetailNavState } from '../../renderer/lib/nav-helpers'

describe('UI-001 external route recovery', () => {
  const rejected = [
    'future/session/private', 'settings/future', 'knowledge/unknown/doc',
    'notes/note/%E0%A4%A', 'cloud-run/%ZZ', 'extension/%', 'action/delete-session/s1',
    'tasks/calendar', 'connections/v2', 'allSessions/future/private',
    'flagged/future/private', 'archived/future/private', 'state/todo/future/private',
    'label/work/future/private', 'view/custom/future/private', 'board/future/private',
    'table/session/s1', 'heatmap/session/s1', 'memory/future', 'inbox/future',
    'feed/future', 'meetings/future', 'home/future', 'dossier/future/private',
    'sources/api/future/private', 'automations/event/future/private',
    'skills/skill/s/extra', 'projects/project/p/extra', 'pages/page/p/extra',
    'browser/instance/b/extra', 'settings/app/extra', 'knowledge/view',
    'allSessions/session/s1/extra', 'tasks/task/t/extra',
  ]

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
    for (const route of ['allSessions/session/s1', 'sources/source/s', 'skills/skill/s', 'projects/project/p', 'notes/note/n', 'pages/page/p', 'knowledge/document/d', 'extension/e/v', 'terminal/t', 'cloud-run/r', 'search?q=two%20words', 'settings/toolchain', 'settings/preferences', 'notes/note/folder/name', 'knowledge/document/folder/name', 'extension/e/folder/view', 'tasks/task/a%2Fb', 'label/work%20items/session/s1', 'board/session/s1', 'dossier/item/a%2Fb']) {
      const resolved = resolveViewRoute(route)
      expect(resolved.navigator).not.toBe('unavailable')
      // Strict raw parsing can reject a published legacy spelling; the runtime
      // must retain its complete identity and round-trip the canonical address.
      expect(resolved).toEqual(parseRouteToNavigationState(buildRouteFromNavigationState(resolved))!)
    }
    expect(parseSessionIdFromRoute('allSessions/session/s1?x=y' as ViewRoute)).toBe('s1')
    // Incoming strict raw parsing now rejects unknown knowledge kinds itself.
    expect(parseRouteToNavigationState('knowledge/unknown/doc')).toBeNull()
    expect(parseNavigationStateKey('unavailable:%ZZ')).toBeNull()
  })
  it('normalizes empty separators before resolving known routes and retains encoded entity data', () => {
    for (const route of ['tasks/', 'settings/', 'allSessions/', 'notes//note/n/', 'settings//toolchain/', 'allSessions//session/s1/', 'tasks/task/a%2F%2Fb/']) {
      const normalized = route.split('/').filter(Boolean).join('/')
      expect(resolveViewRoute(route)).toEqual(parseRouteToNavigationState(normalized)!)
    }
    expect(resolveViewRoute('tasks///future/').navigator).toBe('unavailable')
    expect(resolveViewRoute('allSessions//session/s1/extra/').navigator).toBe('unavailable')
    expect(resolveViewRoute('notes//note/%GG/').navigator).toBe('unavailable')
  })

})
