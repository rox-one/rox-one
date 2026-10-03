import { buildRouteFromNavigationState, parseRouteToNavigationStateOrUnavailable } from '../../shared/route-parser'
import type { ViewRoute } from '../../shared/routes'
import type { NavigationState } from '../../shared/types'

export type AutoSelectionResolver = (state: NavigationState) => NavigationState

/** Preserve raw view query bytes when automatic selection changes only its path. */
export function preserveRouteQuery(originalRoute: string, resolvedRoute: string): ViewRoute {
  const index = originalRoute.indexOf('?')
  return (index < 0 ? resolvedRoute : resolvedRoute.split('?')[0] + originalRoute.slice(index)) as ViewRoute
}

/**
 * Normalize a panel route during URL reconciliation.
 *
 * Ensures filter-only routes (e.g. `allSessions`) can be upgraded to
 * canonical detail routes (e.g. `allSessions/session/{id}`) via the same
 * auto-selection policy used by normal navigation.
 */
export function normalizePanelRouteForReconcile(
  route: ViewRoute,
  resolveAutoSelection: AutoSelectionResolver,
): ViewRoute {
  const navState = parseRouteToNavigationStateOrUnavailable(route)
  if (navState.navigator === 'unavailable') return route

  // Preserve explicit detail routes exactly as encoded in URL.
  // Reconciliation should only auto-select for filter/list routes.
  if ('details' in navState && navState.details) {
    return route
  }

  const resolved = resolveAutoSelection(navState)
  return preserveRouteQuery(route, buildRouteFromNavigationState(resolved))
}
