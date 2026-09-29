import { describe, expect, it } from 'bun:test'
import { parseCompoundRoute, buildCompoundRoute, parseRouteToNavigationState, buildRouteFromNavigationState } from '../route-parser'
import { routes } from '../routes'
import { COMPOUND_ROUTE_PREFIXES } from '../route-parser'

describe('inbox route', () => {
  it('builds and parses inbox routes', () => {
    expect(routes.view.inbox()).toBe('inbox')
    expect(routes.view.inbox('perm:s1:r 1')).toBe('inbox/item/perm%3As1%3Ar%201')
    expect(parseCompoundRoute('inbox')).toEqual({ navigator: 'inbox', details: null })
    expect(parseCompoundRoute('inbox/item/perm%3As1')).toEqual({ navigator: 'inbox', details: { type: 'item', id: 'perm:s1' } })
    expect(buildCompoundRoute({ navigator: 'inbox', details: { type: 'item', id: 'x/y' } })).toBe('inbox/item/x%2Fy')
    expect(COMPOUND_ROUTE_PREFIXES).toContain('inbox')
  })

  it('round-trips navigation state', () => {
    const state = parseRouteToNavigationState('inbox/item/abc')
    expect(state).toEqual({ navigator: 'inbox', details: { type: 'item', itemId: 'abc' } })
    expect(buildRouteFromNavigationState(state!)).toBe('inbox/item/abc')
    expect(parseRouteToNavigationState('inbox')).toEqual({ navigator: 'inbox', details: null })
  })
})
