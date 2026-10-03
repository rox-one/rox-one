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

/** Structured entries preserve commas, colons and existing percent encoding. */
export function serializePanelEntriesForUrl(entries: readonly UrlPanelEntry[]): string {
  return JSON.stringify(entries.map(({ route, proportion }) => [route, Number(proportion.toFixed(4))]))
}

/** Read current structured entries and existing comma-delimited saved URLs. */
export function parsePanelEntriesFromUrl(value: string): UrlPanelEntry[] {
  const validProportion = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 1 ? value : 0
  if (value.startsWith('[')) {
    try {
      const entries: unknown = JSON.parse(value)
      if (Array.isArray(entries) && entries.every(entry => Array.isArray(entry) && entry.length === 2 && typeof entry[0] === 'string')) {
        return entries.map(([route, proportion]) => ({ route: route as ViewRoute, proportion: validProportion(proportion) }))
      }
      return [{ route: value as ViewRoute, proportion: 0 }]
    } catch {
      return [{ route: value as ViewRoute, proportion: 0 }]
    }
  }
  return value.split(',').filter(Boolean).map(entry => {
    const colon = entry.lastIndexOf(':')
    const proportion = colon > 0 ? validProportion(Number(entry.slice(colon + 1))) : 0
    return { route: (proportion > 0 ? entry.slice(0, colon) : entry) as ViewRoute, proportion }
  })
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
