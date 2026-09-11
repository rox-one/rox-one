import { describe, expect, it } from 'bun:test'
import { routes } from '../routes'
import {
  buildRouteFromNavigationState,
  parseCompoundRoute,
  parseRouteToNavigationState,
} from '../route-parser'
import { isSessionsNavigation } from '../types'

describe('route-parser: board session card', () => {
  it('round-trips board without a session', () => {
    expect(routes.view.board()).toBe('board')
    const compound = parseCompoundRoute('board')
    expect(compound).toEqual({
      navigator: 'sessions',
      sessionFilter: { kind: 'allSessions' },
      viewMode: 'board',
      details: null,
    })
    const state = parseRouteToNavigationState('board')
    if (!state || !isSessionsNavigation(state)) throw new Error('expected sessions')
    expect(state.viewMode).toBe('board')
    expect(state.details).toBeNull()
    expect(buildRouteFromNavigationState(state)).toBe('board')
  })

  it('round-trips board/session/{id} as board + session details', () => {
    const route = routes.view.board('s-42')
    expect(route).toBe('board/session/s-42')
    const compound = parseCompoundRoute(route)
    expect(compound?.viewMode).toBe('board')
    expect(compound?.details).toEqual({ type: 'session', id: 's-42' })
    const state = parseRouteToNavigationState(route)
    if (!state || !isSessionsNavigation(state)) throw new Error('expected sessions')
    expect(state.viewMode).toBe('board')
    expect(state.details).toEqual({ type: 'session', sessionId: 's-42' })
    expect(buildRouteFromNavigationState(state)).toBe(route)
  })
})
