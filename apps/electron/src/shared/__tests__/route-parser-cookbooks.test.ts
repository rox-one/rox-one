/**
 * Cookbooks route round-trips: route string ⇄ NavigationState ⇄ panel key.
 * Guards the touchpoints a new navigator must thread through (prefix list,
 * parse, build, convert, key serialization, type guard). v1 has no detail
 * variant — the surface is a single runtime-owned address.
 */

import { describe, test, expect } from 'bun:test'
import {
  isCompoundRoute,
  parseCompoundRoute,
  buildCompoundRoute,
  parseRouteToNavigationState,
  buildRouteFromNavigationState,
} from '../route-parser'
import {
  getNavigationStateKey,
  parseNavigationStateKey,
  isCookbooksNavigation,
  type NavigationState,
} from '../types'
import { routes } from '../routes'

describe('cookbooks routes', () => {
  test('route builder emits the cookbooks prefix', () => {
    expect(routes.view.cookbooks()).toBe('cookbooks')
  })

  test('cookbooks is a compound route prefix', () => {
    expect(isCompoundRoute('cookbooks')).toBe(true)
  })

  test('parses bare cookbooks route (main owns the runtime view)', () => {
    expect(parseCompoundRoute('cookbooks')).toEqual({ navigator: 'cookbooks', details: null })
    const state = parseRouteToNavigationState('cookbooks')
    expect(state).toEqual({ navigator: 'cookbooks', details: null })
    expect(state && isCookbooksNavigation(state)).toBe(true)
  })

  test('rejects malformed cookbooks routes (v1 has no detail variant)', () => {
    expect(parseCompoundRoute('cookbooks/extra')).toBeNull()
    expect(parseCompoundRoute('cookbooks/doc/x')).toBeNull()
  })

  test('round-trips route ⇄ navigation state', () => {
    const state = parseRouteToNavigationState('cookbooks')
    expect(state).not.toBeNull()
    expect(buildRouteFromNavigationState(state!)).toBe('cookbooks')
  })

  test('buildCompoundRoute emits the cookbooks route', () => {
    expect(buildCompoundRoute({ navigator: 'cookbooks', details: null })).toBe('cookbooks')
  })

  test('round-trips navigation state ⇄ panel key', () => {
    const state: NavigationState = { navigator: 'cookbooks', details: null }
    expect(getNavigationStateKey(state)).toBe('cookbooks')
    expect(parseNavigationStateKey('cookbooks')).toEqual(state)
  })

  test('the guard accepts only the cookbooks navigator', () => {
    expect(isCookbooksNavigation({ navigator: 'cookbooks', details: null })).toBe(true)
    expect(isCookbooksNavigation({ navigator: 'playbooks', details: null })).toBe(false)
  })
})
