/**
 * PERF-10 (#1577) — every lazy route chunk in one registry.
 *
 * The panel used to declare its lazy pages inline, so nothing outside the
 * panel could load a chunk before the user navigated (lazy route loaders were
 * never preloaded; a nested lazy page made it a two-step waterfall). The
 * registry keeps the same lazy pages and adds `preloadRoute()`, which resolves
 * one loader and memoizes its promise: `React.lazy` then resolves from the
 * module cache, so the visit only waits for data.
 */
import { RAIL_SURFACE_ROUTE_IDS } from '../../../shared/rail-surfaces'
import { createRoutePreloader } from '@/lib/route-preload'

export const ROUTE_PAGE_LOADERS = {
  search: () => import('@/pages/SearchPage'),
  notes: () => import('@/pages/NotesPage'),
  connections: () => import('@/pages/ConnectionsPage'),
  extraScreens: () => import('@/pages/extra-screens/ExtraScreenHost'),
  surfaces: () => import('@/platform/SurfaceHost'),
  tasks: () => import('@/pages/workspace-work/WorkspaceTasksPage'),
  planWorkspace: () => import('@/pages/workspace-work/PlanWorkspacePage'),
  agentsWorkspace: () => import('@/pages/workspace-work/AgentsWorkspacePage'),
  inbox: () => import('@/pages/InboxPage'),
  feed: () => import('@/pages/FeedPage'),
  knowledgeEntity: () => import('@/pages/KnowledgeEntityPage'),
  skillInfo: () => import('@/pages/SkillInfoPage'),
  sourceInfo: () => import('@/pages/SourceInfoPage'),
  skillsCatalog: () => import('@/pages/SkillsCatalogPage'),
  integrationsCatalog: () => import('@/pages/IntegrationsCatalogPage'),
  projectInfo: () => import('@/pages/ProjectInfoPage'),
  browser: () => import('@/pages/BrowserPanelPage'),
  extensionSurface: () => import('@/pages/ExtensionSurfacePage'),
  terminal: () => import('@/pages/TerminalSurfacePage'),
  cloudRun: () => import('@/pages/CloudRunSurfacePage'),
  pagesHome: () => import('../pages/PagesHome').then((m) => ({ default: m.PagesHome })),
  kanban: () => import('./kanban/KanbanBoardContainer').then((m) => ({ default: m.KanbanBoardContainer })),
  sessionTable: () => import('./session-table/SessionTableHost').then((m) => ({ default: m.SessionTableHost })),
  automationEditor: () => import('../automations/AutomationEditor').then((m) => ({ default: m.AutomationEditor })),
  knowledgeDiff: () => import('../../knowledge/KnowledgeDiff').then((m) => ({ default: m.KnowledgeDiff })),
  knowledgeHome: () => import('../../knowledge/KnowledgeHome').then((m) => ({ default: m.KnowledgeHome })),
  knowledgeProposals: () => import('../../knowledge/KnowledgeProposals').then((m) => ({ default: m.KnowledgeProposals })),
}

export type RoutePageName = keyof typeof ROUTE_PAGE_LOADERS

export const ROUTE_PAGE_NAMES = Object.keys(ROUTE_PAGE_LOADERS) as readonly RoutePageName[]

/**
 * Route chunks belonging to a rail surface: warm-up loads these during idle so
 * a first visit waits for data, not for a chunk (PERF-10 warm-up step 8). The
 * ids come from the import-free shared list, checked against the registry.
 */
export const RAIL_SURFACE_ROUTES = RAIL_SURFACE_ROUTE_IDS satisfies readonly RoutePageName[]

const preloads = createRoutePreloader(ROUTE_PAGE_LOADERS)

/** Load a route chunk now and remember the promise (`React.lazy` reuses it). */
export const preloadRoute = preloads.preload

/** Route chunks already asked for (warm-up/report introspection). */
export const preloadedRouteNames = preloads.preloaded

/** Test hook: forget every preload. */
export const resetRoutePreloadsForTests = preloads.reset