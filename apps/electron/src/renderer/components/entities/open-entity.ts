/**
 * W1-08 (#1505) — open an entity through the existing navigation event.
 */
import { entityRoute, type EntityRef } from '@rox/core/entities'
import { navigate, type Route } from '@/lib/navigate'
import { ENTITY_ONLY_ROUTE_PREFIXES, isEntityRoutesEnabled } from '../../../shared/route-parser'

/**
 * Returns false (and navigates nowhere) when the kind has no route yet, or
 * when its route is a kind-first entity route (`docs/…`, `goals/…`, …) and
 * #1499's `entities.links.v1` route gate is effectively off.
 */
export function openEntity(ref: EntityRef, options: { newPanel?: boolean } = {}): boolean {
  let route: string
  try { route = entityRoute(ref) } catch { return false }
  const prefix = route.split('?')[0]!.split('/')[0]!
  if (ENTITY_ONLY_ROUTE_PREFIXES.has(prefix) && !isEntityRoutesEnabled()) return false
  navigate(route as Route, options.newPanel ? { newPanel: true } : undefined)
  return true
}
