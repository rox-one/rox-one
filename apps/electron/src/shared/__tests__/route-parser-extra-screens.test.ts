/**
 * Extra workbench screens share one `screen` navigator:
 * `<screenId>` and `<screenId>/item/<itemId>`.
 */
import { describe, test, expect } from 'bun:test'
import {
  COMPOUND_ROUTE_PREFIXES,
  isCompoundRoute,
  parseCompoundRoute,
  buildCompoundRoute,
  parseRouteToNavigationState,
  buildRouteFromNavigationState,
} from '../route-parser'
import { getNavigationStateKey, parseNavigationStateKey, isScreenNavigation } from '../types'
import { routes } from '../routes'
import { EXTRA_SCREEN_IDS, buildExtraScreenRoute, isExtraScreenId, parseExtraScreenSegments } from '../extra-screens'

describe('extra screen routes', () => {
  test('every extra screen id is a compound route prefix (rox:// accepts it)', () => {
    for (const id of EXTRA_SCREEN_IDS) {
      expect(COMPOUND_ROUTE_PREFIXES).toContain(id)
      expect(isCompoundRoute(id)).toBe(true)
      expect(isCompoundRoute(`${id}/item/x`)).toBe(true)
    }
  })

  test('route builders', () => {
    expect(routes.view.screen('dossier')).toBe('dossier')
    expect(routes.view.screen('dossier', 'a b')).toBe('dossier/item/a%20b')
    expect(buildExtraScreenRoute('dossier', null)).toBe('dossier')
  })

  test('segment parser rejects unknown ids', () => {
    expect(isExtraScreenId('dossier')).toBe(true)
    expect(isExtraScreenId('nope')).toBe(false)
    expect(parseExtraScreenSegments(['nope'])).toBeNull()
    expect(parseExtraScreenSegments(['dossier', 'item', 'a%20b'])).toEqual({ screen: 'dossier', itemId: 'a b' })
  })

  for (const id of EXTRA_SCREEN_IDS) {
    test(`${id}: parse, build and panel-key round trips`, () => {
      expect(parseCompoundRoute(id)).toEqual({ navigator: 'screen', screen: id, details: null })
      const bare = parseRouteToNavigationState(id)
      expect(bare).toEqual({ navigator: 'screen', screen: id, details: null })
      expect(bare && isScreenNavigation(bare)).toBe(true)

      const detailRoute = `${id}/item/item-1`
      const detail = parseRouteToNavigationState(detailRoute)
      expect(detail).toEqual({ navigator: 'screen', screen: id, details: { type: 'item', itemId: 'item-1' } })

      const bareState = { navigator: 'screen' as const, screen: id, details: null }
      expect(buildRouteFromNavigationState(bareState)).toBe(id)
      expect(getNavigationStateKey(bareState)).toBe(id)
      expect(parseNavigationStateKey(id)).toEqual(bareState)

      const detailState = { navigator: 'screen' as const, screen: id, details: { type: 'item' as const, itemId: 'item-1' } }
      expect(buildRouteFromNavigationState(detailState)).toBe(detailRoute)
      expect(getNavigationStateKey(detailState)).toBe(detailRoute)
      expect(parseNavigationStateKey(detailRoute)).toEqual(detailState)
      expect(buildCompoundRoute({ navigator: 'screen', screen: id, details: { type: 'item', id: 'item-1' } })).toBe(detailRoute)
    })
  }
})
