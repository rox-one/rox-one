/**
 * PERF-10 (#1577) — every route chunk the primary rail can reach.
 *
 * Kept free of imports so both the renderer registry (which types the ids
 * against `RoutePageName`) and the perf harness (which models warm-up) can
 * read the same list.
 */
export const RAIL_SURFACE_ROUTE_IDS = [
  'notes',
  'tasks',
  'planWorkspace',
  'agentsWorkspace',
  'inbox',
  'feed',
  'skillsCatalog',
  'integrationsCatalog',
  'knowledgeHome',
  'pagesHome',
  'connections',
  'browser',
  'terminal',
  'cloudRun',
  'automationEditor',
] as const

export type RailSurfaceRouteId = (typeof RAIL_SURFACE_ROUTE_IDS)[number]