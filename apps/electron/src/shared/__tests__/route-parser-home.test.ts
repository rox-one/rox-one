import { describe, expect, it } from 'bun:test'
import { routes } from '../routes'
import {
  buildCompoundRoute,
  buildRouteFromNavigationState,
  parseCompoundRoute,
  parseRouteToNavigationState,
} from '../route-parser'
import { getNavigationStateKey, isHomeNavigation, parseNavigationStateKey } from '../types'

describe('route-parser: Home routes', () => {
  it('round-trips the bare home route', () => {
    expect(routes.view.home()).toBe('home')
    const compound = parseCompoundRoute('home')
    expect(compound).toEqual({ navigator: 'home', details: null })
    expect(buildCompoundRoute(compound!)).toBe('home')

    const state = parseRouteToNavigationState('home')
    expect(state).toEqual({ navigator: 'home', details: null })
    expect(isHomeNavigation(state!)).toBe(true)
    expect(buildRouteFromNavigationState(state!)).toBe('home')
    expect(getNavigationStateKey(state!)).toBe('home')
    expect(parseNavigationStateKey('home')).toEqual({ navigator: 'home', details: null })
  })

  it('does not throw on an unknown home subpath', () => {
    const parsed = parseRouteToNavigationState('home/unknown')
    expect(parsed === null || parsed.navigator === 'home').toBe(true)
  })
})
