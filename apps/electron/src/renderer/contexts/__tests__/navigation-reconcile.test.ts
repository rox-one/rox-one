import { describe, expect, it } from 'bun:test'
import { normalizePanelRouteForReconcile, parsePanelEntriesFromUrl } from '../navigation-reconcile'
import type { ViewRoute } from '../../../shared/routes'
import type { NavigationState } from '../../../shared/types'

describe('normalizePanelRouteForReconcile', () => {
  it('auto-selects session details for filter-only session routes', () => {
    const resolver = (state: NavigationState): NavigationState => {
      if (state.navigator === 'sessions' && !state.details) {
        return {
          ...state,
          details: { type: 'session', sessionId: 's1' },
        }
      }
      return state
    }

    const normalized = normalizePanelRouteForReconcile('allSessions', resolver)
    expect(normalized).toBe('allSessions/session/s1')
  })

  it('keeps explicit session details unchanged', () => {
    const resolver = (state: NavigationState): NavigationState => {
      if (state.navigator === 'sessions' && !state.details) {
        return {
          ...state,
          details: { type: 'session', sessionId: 's1' },
        }
      }
      return state
    }

    const normalized = normalizePanelRouteForReconcile('allSessions/session/s2', resolver)
    expect(normalized).toBe('allSessions/session/s2')
  })

  it('normalizes each session panel route independently', () => {
    const resolver = (state: NavigationState): NavigationState => {
      if (state.navigator === 'sessions' && !state.details) {
        const sessionId = state.filter.kind === 'flagged' ? 'flagged-1' : 'all-1'
        return {
          ...state,
          details: { type: 'session', sessionId },
        }
      }
      return state
    }

    const routes = ['allSessions', 'flagged'] as const
    const normalized = routes.map((route) => normalizePanelRouteForReconcile(route, resolver))

    expect(normalized).toEqual(['allSessions/session/all-1', 'flagged/session/flagged-1'])
  })

  it('keeps route unchanged when resolver leaves state without details', () => {
    const resolver = (state: NavigationState): NavigationState => state

    const normalized = normalizePanelRouteForReconcile('allSessions', resolver)
    expect(normalized).toBe('allSessions')
  })

  it('preserves every query parameter when reconciling a list or search route', () => {
    const identity = (state: NavigationState) => state
    expect<string>(normalizePanelRouteForReconcile('tasks?view=calendar' as ViewRoute, identity)).toBe('tasks?view=calendar')
    expect<string>(normalizePanelRouteForReconcile('search?q=ok&mode=future' as ViewRoute, identity)).toBe('search?q=ok&mode=future')
    expect<string>(normalizePanelRouteForReconcile('allSessions?keep=a%2Cb' as ViewRoute, state => ({ ...state, details: { type: 'session', sessionId: 's1' } } as NavigationState)))
      .toBe('allSessions/session/s1?keep=a%2Cb')
  })

  it('keeps non-session routes unchanged with session-only resolver', () => {
    const resolver = (state: NavigationState): NavigationState => {
      if (state.navigator === 'sessions' && !state.details) {
        return {
          ...state,
          details: { type: 'session', sessionId: 's1' },
        }
      }
      return state
    }

    expect(normalizePanelRouteForReconcile('settings', resolver)).toBe('settings')
    expect(normalizePanelRouteForReconcile('sources', resolver)).toBe('sources')
  })

  it('keeps explicit detail route even if resolver tries to rewrite it', () => {
    const resolver = (state: NavigationState): NavigationState => {
      if ('details' in state) {
        if (state.navigator === 'sessions') {
          return { ...state, details: { type: 'session', sessionId: 'rewritten' } }
        }
        if (state.navigator === 'sources') {
          return { ...state, details: { type: 'source', sourceSlug: 'rewritten' } }
        }
      }
      return state
    }

    expect(normalizePanelRouteForReconcile('allSessions/session/s2', resolver)).toBe('allSessions/session/s2')
    expect(normalizePanelRouteForReconcile('sources/source/github', resolver)).toBe('sources/source/github')
  })

  it('keeps explicit detail routes distinct across multiple panels', () => {
    const resolver = (_state: NavigationState): NavigationState => {
      return {
        navigator: 'sessions',
        filter: { kind: 'allSessions' },
        details: { type: 'session', sessionId: 'same' },
      }
    }

    const routes = ['allSessions/session/left', 'allSessions/session/right'] as const
    const normalized = routes.map((route) => normalizePanelRouteForReconcile(route, resolver))

    expect(normalized).toEqual(['allSessions/session/left', 'allSessions/session/right'])
  })
  it('returns no entries for malformed structured panel data so focused-route recovery can run', () => {
    for (const value of ['[', '[1]', '[["tasks"]]', ' [ [ "tasks", 1 ] ', '[["",0]]', '[[" ",0]]', '  ']) expect(parsePanelEntriesFromUrl(value)).toEqual([])
    expect(parsePanelEntriesFromUrl('[["tasks",0]]')).toEqual([{ route: 'tasks', proportion: 0 }])
  })

})

// PR1412 also preserves query spelling for auto-selected collection roots.
it('auto-selected collection retains opaque view parameters', () => {
  const route = 'allSessions?keep=a%2Fb&next=%3F' as ViewRoute
  const resolved = normalizePanelRouteForReconcile(route, state => ({ ...state, details: { type: 'session', sessionId: 'chosen' } }) as NavigationState)
  expect(resolved).toBe('allSessions/session/chosen?keep=a%2Fb&next=%3F')
})
