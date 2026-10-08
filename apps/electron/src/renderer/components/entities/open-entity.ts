/**
 * W1-08 (#1505) — open an entity through the existing navigation event.
 */
import { entityRoute, type EntityRef } from '@rox/core/entities'
import { navigate, type Route } from '@/lib/navigate'

/** Returns false when the kind has no route yet (nothing happens then). */
export function openEntity(ref: EntityRef, options: { newPanel?: boolean } = {}): boolean {
  let route: string
  try { route = entityRoute(ref) } catch { return false }
  navigate(route as Route, options.newPanel ? { newPanel: true } : undefined)
  return true
}
