import { encodePanelEntries, decodePanelEntries } from '../lib/panel-url'
import { buildRouteFromNavigationState, resolveViewRoute } from '../../shared/route-parser'
import type { ViewRoute } from '../../shared/routes'
import type { NavigationState } from '../../shared/types'

export type AutoSelectionResolver = (state: NavigationState) => NavigationState

/** Keep the full query spelling when selection changes only the route path. */
export function preserveRouteQuery(originalRoute: string, resolvedRoute: string): ViewRoute {
  const queryIndex = originalRoute.indexOf('?')
  return (queryIndex < 0 ? resolvedRoute : resolvedRoute.split('?')[0] + originalRoute.slice(queryIndex)) as ViewRoute
}

type UrlPanelEntry = { route: ViewRoute; proportion: number }

/** Compatibility exports share the current canonical panel URL codec. */
export function serializePanelEntriesForUrl(entries: readonly UrlPanelEntry[]): string {
  return encodePanelEntries(entries)
}
export function parsePanelEntriesFromUrl(value: string): UrlPanelEntry[] {
  return decodePanelEntries(value).map(entry => ({ ...entry, route: entry.route as ViewRoute }))
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
  const navState = resolveViewRoute(route)
  if (navState.navigator === 'unavailable') return route

  // Preserve explicit detail routes exactly as encoded in URL.
  // Reconciliation should only auto-select for filter/list routes.
  if ('details' in navState && navState.details) {
    return route
  }

  const resolved = resolveAutoSelection(navState)
  return preserveRouteQuery(route, buildRouteFromNavigationState(resolved))
}
