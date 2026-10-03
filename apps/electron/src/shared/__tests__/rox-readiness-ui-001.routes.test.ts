import { describe, expect, it } from 'bun:test'
import { buildRouteFromNavigationState, parseCompoundRoute, parseRoute, parseRouteToNavigationState, parseRouteToNavigationStateOrUnavailable } from '../route-parser'
import { getNavigationStateKey as getPanelKey, parseNavigationStateKey as parsePanelKey } from '../types'

describe('UI-001 unavailable routes retain their exact address', () => {
  for (const route of ['retired/surface', 'knowledge/unknown/id', 'knowledge/document']) {
    it(`keeps ${route} unavailable through parsing, route building and panel persistence`, () => {
      const state = parseRouteToNavigationStateOrUnavailable(route)
      expect(state).toEqual({ navigator: 'unavailable', route, details: null })
      expect(buildRouteFromNavigationState(state)).toBe(route)
      expect(parsePanelKey(getPanelKey(state))).toEqual(state)
    })
  }

  for (const route of ['sources/source/%', 'skills/skill/%E0%A4%A', 'allSessions/session/%FF']) {
    it(`recovers invalid encoding in ${route} without selecting a chat`, () => {
      const state = parseRouteToNavigationStateOrUnavailable(route)
      expect(state).toEqual({ navigator: 'unavailable', route, details: null })
      expect(parsePanelKey(getPanelKey(state))).toEqual(state)
      expect(buildRouteFromNavigationState(state)).toBe(route)
    })
  }

  it('keeps action parsing separate from selected view state', () => {
    const route = 'action/new-session?input=hello%20world&model=rox%2Ffast'
    expect(parseRouteToNavigationState(route)).toBeNull()
    expect(parseRoute(route)).toMatchObject({ type: 'action', name: 'new-session', params: { input: 'hello world', model: 'rox/fast' } })
  })

  it('round-trips the emitted session panel key and accepts the existing compatibility key', () => {
    const state = { navigator: 'sessions' as const, filter: { kind: 'allSessions' as const }, details: { type: 'session' as const, sessionId: 'id/with/slashes' } }
    expect(getPanelKey(state)).toBe('allSessions/chat/id/with/slashes')
    expect(parsePanelKey(getPanelKey(state))).toEqual(state)
    expect(parsePanelKey('allSessions/session/id/with/slashes')).toEqual(state)
    expect(parsePanelKey('unavailable:invalid-encoding:%')).toBeNull()
  })

  it('retains compatible persisted failure keys without altering raw addresses', () => {
    const state = { navigator: 'unavailable' as const, route: 'retired/with,a:0.5', reason: 'workspace-mismatch' as const }
    expect(parsePanelKey(getPanelKey(state))).toEqual(state)
    expect(parsePanelKey('unavailable:workspace-mismatch:retired%2Fwith%2Ca%3A0.5')).toEqual(state)
  })

  it('retains the existing cloud-run and diff list surfaces without selecting a chat', () => {
    for (const route of ['cloud-run', 'cloud-run/', 'diff', 'diff/']) {
      const state = parseRouteToNavigationStateOrUnavailable(route)
      expect(state.navigator).toBe(route.startsWith('cloud-run') ? 'cloud-run' : 'diff')
      expect('details' in state && state.details).toBeNull()
    }
  })
})
