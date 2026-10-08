/**
 * W1-07 (#1504) — shell route contracts for the unified surfaces.
 *
 * Three things live here, all pure and dependency-free so both the renderer
 * and the main-process deep-link handler can import them:
 *
 * 1. The four new mode roots (`messenger`, `calendar`, `goals`, `contacts`)
 *    and their route gate. The gate mirrors #1499's entity-route gate: the
 *    renderer pushes the enabled set from its workbench-flag atoms; nothing is
 *    enabled by default, so with every flag OFF the parser behaves exactly as
 *    on the base branch.
 * 2. Stable **route ids** (`messenger.home`, `goals.goal`, …) so wave-2
 *    packages address pages by name instead of hand-building paths. Entity
 *    pages delegate to `@rox/core/entities`' `entityRoute` (single source).
 * 3. **Panel kinds** (`thread`, `entity.detail`, `chat.quick.*`,
 *    `task.detail`, `goal.add-item`, …) with their placement and widths
 *    (UI-SPEC §3.3, §5, §7.3, §8.4, §25.5). Panels are opened by kind, so a
 *    surface never imports another module's component.
 */

import { entityRoute, type EntityKind, type EntityRef } from '@rox/core/entities'

// ---------------------------------------------------------------------------
// 1. Unified mode roots + route gate
// ---------------------------------------------------------------------------

/** The four new rail modes (UI-SPEC §3.1). Order = rail order. */
export const UNIFIED_SURFACE_IDS = ['messenger', 'calendar', 'goals', 'contacts'] as const

export type UnifiedSurfaceId = (typeof UNIFIED_SURFACE_IDS)[number]

/**
 * Workbench flag per surface. Mirrors `WORKBENCH_FLAG.mode{Messenger,…}V1`
 * in `packages/core/src/platform/workbench/flags.ts` (equality is tested);
 * duplicated as literals so this module stays importable from the main
 * process without pulling the whole `@rox/core/platform` barrel.
 */
export const UNIFIED_SURFACE_FLAGS: Readonly<Record<UnifiedSurfaceId, string>> = {
  messenger: 'workbench.mode.messenger.v1',
  calendar: 'workbench.mode.calendar.v1',
  goals: 'workbench.mode.goals.v1',
  contacts: 'workbench.mode.contacts.v1',
}

export function isUnifiedSurfaceId(value: unknown): value is UnifiedSurfaceId {
  return typeof value === 'string' && (UNIFIED_SURFACE_IDS as readonly string[]).includes(value)
}

let enabledSurfaces: ReadonlySet<UnifiedSurfaceId> = new Set()

/**
 * Renderer → parser bridge. Called with the surfaces whose mode flag is on;
 * an empty iterable (the default) keeps every surface route inert.
 */
export function setUnifiedSurfaceRoutesEnabled(ids: Iterable<UnifiedSurfaceId>): void {
  const next = new Set<UnifiedSurfaceId>()
  for (const id of ids) if (isUnifiedSurfaceId(id)) next.add(id)
  enabledSurfaces = next
}

/** Test helper: back to the default (all surface routes off). */
export function resetUnifiedSurfaceRoutes(): void {
  enabledSurfaces = new Set()
}

export function isUnifiedSurfaceRouteEnabled(id: string): id is UnifiedSurfaceId {
  return isUnifiedSurfaceId(id) && enabledSurfaces.has(id)
}

/**
 * True for a bare mode-root route (`messenger`, `messenger?x=1`) whose
 * surface gate is closed. Entity routes under the same prefix
 * (`messenger/<id>`) are #1499's and keep following `entities.links.v1`.
 */
export function isClosedUnifiedSurfaceRoot(route: string): boolean {
  const path = route.split('#')[0]!.split('?')[0]!
  const segments = path.split('/').filter(Boolean)
  return segments.length === 1 && isUnifiedSurfaceId(segments[0]) && !enabledSurfaces.has(segments[0])
}

/** Bare mode-root route for a surface (`messenger`, `calendar`, …). */
export function unifiedSurfaceRoute<S extends UnifiedSurfaceId>(surface: S): S {
  return surface
}

// ---------------------------------------------------------------------------
// 2. Route ids
// ---------------------------------------------------------------------------

/** Route ids that take no argument (surface homes and fixed views). */
const STATIC_ROUTE_IDS = {
  'home.root': 'home',
  'chat.root': 'allSessions',
  'messenger.home': 'messenger',
  'meetings.home': 'meetings',
  'calendar.home': 'calendar',
  'tasks.home': 'tasks',
  'goals.home': 'goals',
  'goals.workMap': 'goals',
  // PRD §11 #2: the Notes route id stays `notes` after the «Документы» relabel.
  'docs.home': 'notes',
  'contacts.home': 'contacts',
  'feed.home': 'feed',
  'inbox.home': 'inbox',
} as const satisfies Record<string, string>

/** Route ids for entity pages: the id resolves through `entityRoute`. */
const ENTITY_ROUTE_IDS = {
  'messenger.chat': 'channel',
  'calendar.event': 'calendar-event',
  'meetings.meeting': 'call',
  'tasks.task': 'task',
  'tasks.list': 'task-list',
  'goals.goal': 'goal',
  'goals.project': 'project',
  'goals.milestone': 'milestone',
  'goals.checkIn': 'check-in',
  'goals.space': 'space',
  'docs.doc': 'note',
  'docs.file': 'file',
  'docs.wiki': 'wiki-space',
  'docs.base': 'base',
  'docs.form': 'form',
  'contacts.person': 'person',
  'contacts.department': 'department',
} as const satisfies Record<string, EntityKind>

export type StaticSurfaceRouteId = keyof typeof STATIC_ROUTE_IDS
export type EntitySurfaceRouteId = keyof typeof ENTITY_ROUTE_IDS
export type SurfaceRouteId = StaticSurfaceRouteId | EntitySurfaceRouteId

export const SURFACE_ROUTE_IDS: readonly SurfaceRouteId[] = [
  ...(Object.keys(STATIC_ROUTE_IDS) as StaticSurfaceRouteId[]),
  ...(Object.keys(ENTITY_ROUTE_IDS) as EntitySurfaceRouteId[]),
]

export function isSurfaceRouteId(value: unknown): value is SurfaceRouteId {
  return typeof value === 'string' && (value in STATIC_ROUTE_IDS || value in ENTITY_ROUTE_IDS)
}

/** The entity kind an entity route id addresses (null for static ids). */
export function surfaceRouteKind(id: SurfaceRouteId): EntityKind | null {
  return (ENTITY_ROUTE_IDS as Record<string, EntityKind>)[id] ?? null
}

/**
 * Build the app route for a route id. Entity ids take the entity id (and an
 * optional fragment) and delegate to `entityRoute`, so they stay identical to
 * #1499's deep links.
 */
export function surfaceRoute(id: StaticSurfaceRouteId): string
export function surfaceRoute(id: EntitySurfaceRouteId, entityId: string, fragment?: string): string
export function surfaceRoute(id: SurfaceRouteId, entityId?: string, fragment?: string): string {
  const staticRoute = (STATIC_ROUTE_IDS as Record<string, string>)[id]
  if (staticRoute !== undefined) return staticRoute
  const kind = surfaceRouteKind(id)
  if (!kind || !entityId) throw new Error(`Route id "${id}" needs an entity id`)
  const ref: EntityRef = fragment ? { kind, id: entityId, fragment } : { kind, id: entityId }
  return entityRoute(ref)
}

// ---------------------------------------------------------------------------
// 3. Panel kinds
// ---------------------------------------------------------------------------

export type PanelPlacement = 'inspector' | 'modal'

export interface PanelKindDescriptor {
  kind: PanelKindId
  placement: PanelPlacement
  /** Preferred width in px (inspector) or dialog width (modal). */
  defaultWidth: number
  minWidth?: number
  maxWidth?: number
  /** Owning module (who renders it); the shell never imports the component. */
  owner: string
  /** i18n key for the panel title / tab label. */
  titleKey: string
}

/**
 * Panel kinds (UI-SPEC §1 inspector stack, §3.3, §5, §7.3, §8.4, §25.5).
 * Widths: quick panels 328, comments 360, task detail 560 (Lark `cmt/28`).
 * `agent.panel` (380) is reserved for W1-15 (#1512) and not listed here.
 */
export const PANEL_KINDS = [
  'thread',
  'entity.detail',
  'entity.preview',
  'referenced-in',
  'chat.quick.docs',
  'chat.quick.tasks',
  'chat.quick.calendar',
  'chat.quick.contacts',
  'chat.quick.goals',
  'chat.search',
  'chat.settings',
  'task.detail',
  'event.detail',
  'goal.add-item',
] as const

export type PanelKindId = (typeof PANEL_KINDS)[number]

const QUICK = { placement: 'inspector', defaultWidth: 328, minWidth: 280, maxWidth: 480, owner: 'messenger' } as const

export const PANEL_KIND_DESCRIPTORS: Readonly<Record<PanelKindId, PanelKindDescriptor>> = {
  thread: { kind: 'thread', ...QUICK, titleKey: 'surfaces.panel.thread' },
  'entity.detail': {
    kind: 'entity.detail', placement: 'inspector', defaultWidth: 328, minWidth: 280, maxWidth: 560,
    owner: 'entities', titleKey: 'surfaces.panel.entityDetail',
  },
  'entity.preview': {
    kind: 'entity.preview', placement: 'inspector', defaultWidth: 328, minWidth: 280, maxWidth: 480,
    owner: 'entities', titleKey: 'surfaces.panel.entityPreview',
  },
  'referenced-in': {
    kind: 'referenced-in', placement: 'inspector', defaultWidth: 328, minWidth: 280, maxWidth: 480,
    owner: 'entities', titleKey: 'surfaces.panel.referencedIn',
  },
  'chat.quick.docs': { kind: 'chat.quick.docs', ...QUICK, titleKey: 'surfaces.panel.quickDocs' },
  'chat.quick.tasks': { kind: 'chat.quick.tasks', ...QUICK, titleKey: 'surfaces.panel.quickTasks' },
  'chat.quick.calendar': { kind: 'chat.quick.calendar', ...QUICK, titleKey: 'surfaces.panel.quickCalendar' },
  'chat.quick.contacts': { kind: 'chat.quick.contacts', ...QUICK, titleKey: 'surfaces.panel.quickContacts' },
  'chat.quick.goals': { kind: 'chat.quick.goals', ...QUICK, titleKey: 'surfaces.panel.quickGoals' },
  'chat.search': { kind: 'chat.search', ...QUICK, titleKey: 'surfaces.panel.chatSearch' },
  'chat.settings': { kind: 'chat.settings', ...QUICK, titleKey: 'surfaces.panel.chatSettings' },
  'task.detail': {
    kind: 'task.detail', placement: 'inspector', defaultWidth: 560, minWidth: 320, maxWidth: 561,
    owner: 'tasks', titleKey: 'surfaces.panel.taskDetail',
  },
  'event.detail': {
    kind: 'event.detail', placement: 'inspector', defaultWidth: 328, minWidth: 280, maxWidth: 480,
    owner: 'calendar', titleKey: 'surfaces.panel.eventDetail',
  },
  'goal.add-item': {
    kind: 'goal.add-item', placement: 'modal', defaultWidth: 560, owner: 'goals',
    titleKey: 'surfaces.panel.goalAddItem',
  },
}

export function isPanelKind(value: unknown): value is PanelKindId {
  return typeof value === 'string' && (PANEL_KINDS as readonly string[]).includes(value)
}

/** A request to open a panel: kind + optional subject entity + params. */
export interface PanelRequest {
  kind: PanelKindId
  ref?: EntityRef
  params?: Readonly<Record<string, string>>
}
