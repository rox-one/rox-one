/**
 * Panel Stack State
 *
 * Single-lane panel model for side-by-side content panels.
 */

import { atom, type Getter, type Setter } from 'jotai'
import { parseRouteToNavigationState, parseRouteToNavigationStateOrUnavailable } from '../../shared/route-parser'
import { routes, type ViewRoute } from '../../shared/routes'

let nextPanelId = 0
function generatePanelId(): string {
  return `panel-${++nextPanelId}-${Date.now()}`
}

export type PanelType = 'session' | 'source' | 'settings' | 'skills' | 'browser' | 'knowledge' | 'clipboard-history' | 'cookbooks' | 'other'
export type PanelLaneId = 'main'
export type OpenIntent = 'implicit' | 'explicit'

/** Retained utility panels opened beside the primary surface, never replacing it. */
export type AuxiliaryTool = 'agent' | 'tasks' | 'automations' | 'memory'

/** Display context a retained tool panel restores with. Hosts still re-check every write. */
export interface ToolContextReference {
  workspaceId: string
  route: ViewRoute
  projectId?: string
}

export interface PanelLanePolicy {
  id: PanelLaneId
  order: number
  allowedTypes: PanelType[]
  locked: boolean
  singleton: boolean
}

export const PANEL_LANE_POLICIES: Record<PanelLaneId, PanelLanePolicy> = {
  main: {
    id: 'main',
    order: 0,
    allowedTypes: ['session', 'source', 'settings', 'skills', 'browser', 'knowledge', 'clipboard-history', 'cookbooks', 'other'],
    locked: false,
    singleton: false,
  },
}

export interface PanelStackEntry {
  id: string
  route: ViewRoute
  proportion: number
  panelType: PanelType
  laneId: PanelLaneId
  /** Set for retained auxiliary tool panels; the primary surface has no tool. */
  tool?: AuxiliaryTool
  toolContext?: ToolContextReference
}

export const panelStackAtom = atom<PanelStackEntry[]>([])

/**
 * Surface identity for de-duplication: one panel per screen. Browser
 * instances and distinct chat sessions are separate surfaces; retained tool
 * panels are keyed by tool. Everything else is keyed by the route's first
 * segment, so `automations` and `automations/<id>` are the same surface.
 */
export function panelSurfaceKey(entry: { route: string; tool?: AuxiliaryTool }): string {
  if (entry.tool) return `tool:${entry.tool}`
  const clean = entry.route.replace(/^\/+/, '')
  const head = clean.split(/[/?#]/)[0] || 'home'
  if (head === 'browser') return clean
  const sessionId = parseSessionIdFromRoute(entry.route as ViewRoute)
  if (sessionId) return `session:${sessionId}`
  return head
}

/**
 * Collapse panels showing the same surface. The `preferId` panel (the one just
 * acted on) wins its surface; otherwise the first occurrence does. Returns the
 * input array unchanged when there is nothing to collapse.
 */
export function collapseDuplicateSurfaces<T extends { id: string; route: string; tool?: AuxiliaryTool; proportion: number }>(
  stack: readonly T[], preferId?: string | null,
): T[] {
  const winner = new Map<string, string>()
  for (const entry of stack) {
    const key = panelSurfaceKey(entry)
    if (!winner.has(key) || entry.id === preferId) winner.set(key, entry.id)
  }
  if (winner.size === stack.length) return stack as T[]
  const kept = stack.filter(entry => winner.get(panelSurfaceKey(entry)) === entry.id)
  const total = kept.reduce((sum, entry) => sum + entry.proportion, 0)
  return total > 0 ? kept.map(entry => ({ ...entry, proportion: entry.proportion / total })) : kept.map(entry => ({ ...entry, proportion: 1 / kept.length }))
}

/** Write a stack with duplicates collapsed, keeping focus valid. */
function setDeduped(get: Getter, set: Setter, stack: PanelStackEntry[], preferId?: string | null): PanelStackEntry[] {
  const next = collapseDuplicateSurfaces(stack, preferId)
  set(panelStackAtom, next)
  const focused = get(focusedPanelIdValueAtom)
  if (focused && !next.some(entry => entry.id === focused)) set(focusedPanelIdAtom, preferId ?? next[0]?.id ?? null)
  const expanded = get(expandedPanelIdAtom)
  if (expanded && !next.some(entry => entry.id === expanded)) set(expandedPanelIdAtom, null)
  const primary = get(primaryPanelIdAtom)
  if (primary && !next.some(entry => entry.id === primary)) {
    const prefer = next.find(entry => entry.id === preferId && !entry.tool) ?? next.find(entry => !entry.tool)
    set(primaryPanelIdAtom, prefer?.id ?? null)
  }
  return next
}
const focusedPanelIdValueAtom = atom<string | null>(null)
export const primaryPanelIdAtom = atom<string | null>(null)
export const lastAuxiliaryToolAtom = atom<AuxiliaryTool | null>(null)
/**
 * D8: the panel currently promoted to the whole workspace, or null for the
 * shared grid. Deliberately in-memory: panel ids are minted per session, so a
 * persisted value would not resolve on the next launch. Writes go through
 * `togglePanelFullScreen`/`reconcilePanelFullScreen` in panel-workspace-layout.
 */
export const expandedPanelIdAtom = atom<string | null>(null)
export const focusedPanelIdAtom = atom(
  get => get(focusedPanelIdValueAtom),
  (get, set, id: string | null) => {
    set(focusedPanelIdValueAtom, id)
    const entry = get(panelStackAtom).find(panel => panel.id === id)
    if (entry && !entry.tool) set(primaryPanelIdAtom, id)
    if (entry?.tool && entry.tool !== 'agent') set(lastAuxiliaryToolAtom, entry.tool)
  },
)

export const primaryPanelRouteAtom = atom(get => {
  const stack = get(panelStackAtom)
  return (stack.find(entry => entry.id === get(primaryPanelIdAtom) && !entry.tool)
    ?? stack.find(entry => !entry.tool))?.route ?? null
})

export const openAuxiliaryPanelAtom = atom(null, (get, set, input: {
  tool: AuxiliaryTool; route: ViewRoute; context?: ToolContextReference
}) => {
  const stack = get(panelStackAtom)
  const existing = stack.find(entry => entry.tool === input.tool)
  if (existing) {
    set(focusedPanelIdAtom, existing.id)
    return
  }
  const entry = { ...createEntry(input.route, 1), tool: input.tool, toolContext: input.context }
  set(panelStackAtom, normalizeProportions([...stack, entry]))
  set(focusedPanelIdAtom, entry.id)
})

/** Surface navigation always targets the retained primary panel. */
export const updatePrimaryPanelRouteAtom = atom(null, (get, set, route: ViewRoute) => {
  const stack = get(panelStackAtom)
  const primary = stack.find(entry => entry.id === get(primaryPanelIdAtom) && !entry.tool)
    ?? stack.find(entry => !entry.tool)
  if (!primary) {
    const entry = createEntry(route, 1)
    set(panelStackAtom, normalizeProportions([entry, ...stack]))
    set(focusedPanelIdAtom, entry.id)
  } else {
    setDeduped(get, set, stack.map(entry => entry.id === primary.id
      ? { ...entry, route, panelType: getPanelTypeFromRoute(route) } : entry), primary.id)
    set(focusedPanelIdAtom, primary.id)
  }
})

/** Late asynchronous results address their owning panel, never current focus. */
export const updatePanelRouteByIdAtom = atom(null, (get, set, input: { id: string; route: ViewRoute }) => {
  const stack = get(panelStackAtom)
  if (!stack.some(entry => entry.id === input.id)) return false
  setDeduped(get, set, stack.map(entry => entry.id === input.id
    ? { ...entry, route: input.route, panelType: getPanelTypeFromRoute(input.route) } : entry), input.id)
  return true
})

export const panelCountAtom = atom((get) => get(panelStackAtom).length)

export const focusedPanelIndexAtom = atom((get) => {
  const stack = get(panelStackAtom)
  const focusedId = get(focusedPanelIdAtom)
  if (!focusedId) return 0
  const idx = stack.findIndex(p => p.id === focusedId)
  return idx === -1 ? 0 : idx
})

export const focusedPanelRouteAtom = atom((get) => {
  const stack = get(panelStackAtom)
  const idx = get(focusedPanelIndexAtom)
  return stack[idx]?.route ?? null
})

export function getPanelTypeFromRoute(route: ViewRoute): PanelType {
  const navState = parseRouteToNavigationStateOrUnavailable(route)
  if (!navState) return 'other'

  switch (navState.navigator) {
    case 'sessions':
      return 'session'
    case 'sources':
      return 'source'
    case 'settings':
      return 'settings'
    case 'skills':
      return 'skills'
    case 'browser':
      return 'browser'
    // SiYuan Knowledge surface — routes.view.siyuan → 'knowledge/{kind}/{id}' (W2).
    // The route prefix is 'knowledge'; the deep-link scheme is 'siyuan' but never
    // appears as a route prefix.
    // 'diff/{proposalId}' (P3 write-back review surface) is knowledge-domain UI —
    // reuse the knowledge PanelType rather than widening the union.
    case 'knowledge':
    case 'diff':
      return 'knowledge'
    case 'clipboard-history':
      return 'clipboard-history'
    // Cookbooks surface (cookbooks-surface program) — its own panel type so
    // the tab strip can label/icon it apart from the generic «Панель».
    case 'cookbooks':
      return 'cookbooks'
    case 'home':
      return 'other'
    default:
      return 'other'
  }
}

export function getDefaultLaneForType(_type: PanelType): PanelLaneId {
  return 'main'
}

function createEntry(
  route: ViewRoute,
  proportion: number,
  id?: string,
  extras?: { tool?: AuxiliaryTool; toolContext?: ToolContextReference },
): PanelStackEntry {
  const panelType = getPanelTypeFromRoute(route)
  const entry: PanelStackEntry = {
    id: id ?? generatePanelId(),
    route,
    proportion,
    panelType,
    laneId: 'main',
  }
  if (extras?.tool) entry.tool = extras.tool
  if (extras?.toolContext) entry.toolContext = extras.toolContext
  return entry
}

function normalizeProportions(stack: PanelStackEntry[]): PanelStackEntry[] {
  if (stack.length === 0) return stack
  const total = stack.reduce((sum, p) => sum + p.proportion, 0)
  if (total <= 0) {
    const equal = 1 / stack.length
    return stack.map(p => ({ ...p, proportion: equal }))
  }
  return stack.map(p => ({ ...p, proportion: p.proportion / total }))
}

export function parseSessionIdFromRoute(route: ViewRoute): string | null {
  const state = parseRouteToNavigationStateOrUnavailable(route)
  return state.navigator === 'sessions' ? state.details?.sessionId ?? null : null
}

export const focusedSessionIdAtom = atom((get) => {
  const route = get(focusedPanelRouteAtom)
  if (!route) return null
  return parseSessionIdFromRoute(route)
})

/**
 * Session ids currently on screen across all open panels (the focused panel
 * plus any split-view siblings). Used to decide whether a session is "in the
 * background" — a session shown in any panel is not.
 */
export const visibleSessionIdsAtom = atom((get) => {
  const ids = new Set<string>()
  for (const entry of get(panelStackAtom)) {
    const id = parseSessionIdFromRoute(entry.route)
    if (id) ids.add(id)
  }
  return ids
})

export type PanelSpatialDirection = 'left' | 'right' | 'up' | 'down'

export interface PanelSpatialBounds {
  id: string
  left: number
  top: number
  right: number
  bottom: number
}

/** Choose the nearest visible panel in the requested geometric direction. */
export function findPanelInDirection(
  focusedId: string | null,
  panels: readonly PanelSpatialBounds[],
  direction: PanelSpatialDirection,
): string | null {
  const current = panels.find((panel) => panel.id === focusedId)
  if (!current) return null

  const currentCenterX = (current.left + current.right) / 2
  const currentCenterY = (current.top + current.bottom) / 2
  let nearestId: string | null = null
  let nearestDistance = Number.POSITIVE_INFINITY

  for (const candidate of panels) {
    if (candidate.id === focusedId) continue
    const centerX = (candidate.left + candidate.right) / 2
    const centerY = (candidate.top + candidate.bottom) / 2
    const horizontalDelta = centerX - currentCenterX
    const verticalDelta = centerY - currentCenterY
    const isInDirection =
      direction === 'right' ? horizontalDelta > 0
        : direction === 'left' ? horizontalDelta < 0
          : direction === 'down' ? verticalDelta > 0
            : verticalDelta < 0
    if (!isInDirection) continue

    const horizontalGap = Math.max(0, current.left - candidate.right, candidate.left - current.right)
    const verticalGap = Math.max(0, current.top - candidate.bottom, candidate.top - current.bottom)
    const distance = horizontalGap ** 2 + verticalGap ** 2
    if (distance < nearestDistance) {
      nearestId = candidate.id
      nearestDistance = distance
    }
  }

  return nearestId
}

export const pushPanelAtom = atom(
  null,
  (get, set, { route, afterIndex }: {
    route: ViewRoute
    afterIndex?: number
    targetLaneId?: PanelLaneId
    intent?: OpenIntent
  }) => {
    const stack = get(panelStackAtom)
    const key = panelSurfaceKey({ route })
    const same = stack.find(entry => panelSurfaceKey(entry) === key)
    if (same) {
      // One panel per surface: retarget and focus the existing one.
      setDeduped(get, set, stack.map(entry => entry.id === same.id ? { ...entry, route, panelType: getPanelTypeFromRoute(route) } : entry), same.id)
      set(focusedPanelIdAtom, same.id)
      return
    }
    let insertAt = stack.length
    if (afterIndex !== undefined && afterIndex >= 0 && afterIndex < stack.length) {
      insertAt = afterIndex + 1
    }

    // Reserve an average panel share before normalization. A zero weight
    // creates an invisible pane and cannot be restored from the URL.
    const newEntry = createEntry(route, stack.length > 0
      ? stack.reduce((sum, panel) => sum + panel.proportion, 0) / stack.length
      : 1)
    const newStack = [
      ...stack.slice(0, insertAt),
      newEntry,
      ...stack.slice(insertAt),
    ]

    const normalized = normalizeProportions(newStack)
    set(panelStackAtom, normalized)
    set(focusedPanelIdAtom, newEntry.id)
  }
)

export const closePanelAtom = atom(
  null,
  (get, set, id: string) => {
    const stack = get(panelStackAtom)
    const idx = stack.findIndex(p => p.id === id)
    if (idx === -1) return
    // The main surface remains available while a tool is open. Closing it
    // returns to the default inbox rather than leaving an orphan tool stack.
    if (!stack[idx].tool && stack.some(panel => panel.tool) && stack.filter(panel => !panel.tool).length === 1) {
      set(panelStackAtom, stack.map(panel => panel.id === id ? { ...panel, route: 'inbox' as ViewRoute, panelType: 'other' } : panel))
      set(focusedPanelIdAtom, id)
      return
    }
    const remaining = [...stack.slice(0, idx), ...stack.slice(idx + 1)]

    set(panelStackAtom, normalizeProportions(remaining))

    // Closing the promoted panel returns the workspace to the shared grid so
    // no surviving sibling is left hidden behind a stale id.
    if (get(expandedPanelIdAtom) === id) set(expandedPanelIdAtom, null)

    if (get(focusedPanelIdAtom) === id) {
      const newIdx = Math.min(idx, remaining.length - 1)
      set(focusedPanelIdAtom, remaining[newIdx]?.id ?? null)
    }
  }
)

export const reconcilePanelStackAtom = atom(
  null,
  (get, set, { entries, focusedIndex }: {
    entries: { route: ViewRoute; proportion: number; tool?: AuxiliaryTool; toolContext?: ToolContextReference }[]
    focusedIndex?: number
  }): boolean => {
    if (entries.length === 0) return false
    {
      const keep = new Set<string>()
      const focusTarget = entries[Math.min(focusedIndex ?? 0, entries.length - 1)]
      const focusKey = focusTarget ? panelSurfaceKey(focusTarget) : null
      const deduped = entries.filter((entry) => {
        const key = panelSurfaceKey(entry)
        if (keep.has(key)) return false
        if (key === focusKey && entry !== focusTarget) return false
        keep.add(key)
        return true
      })
      if (deduped.length !== entries.length) {
        const idx = focusTarget ? deduped.indexOf(focusTarget) : 0
        entries = deduped
        focusedIndex = idx < 0 ? 0 : idx
      }
    }

    const current = get(panelStackAtom)
    const used = new Set<string>()

    const requestedFocusIndex = Math.min(focusedIndex ?? 0, entries.length - 1)
    const requestedFocusRoute = entries[requestedFocusIndex]?.route ?? entries[0].route

    const build = (target: typeof entries[number], id?: string): PanelStackEntry => {
      const entry = createEntry(target.route, target.proportion, id, { tool: target.tool, toolContext: target.toolContext })
      return { ...entry, proportion: target.proportion }
    }

    const newStack = entries.map((target, i) => {
      const positional = current[i]

      if (positional && positional.route === target.route && positional.tool === target.tool && !used.has(positional.id)) {
        used.add(positional.id)
        return build(target, positional.id)
      }

      const any = current.find(c => c.route === target.route && c.tool === target.tool && !used.has(c.id))
      if (any) {
        used.add(any.id)
        return build(target, any.id)
      }

      if (positional && !used.has(positional.id)) {
        used.add(positional.id)
        return build(target, positional.id)
      }

      return build(target)
    })

    const normalized = normalizeProportions(newStack)

    if (
      normalized.length === current.length &&
      normalized.every((p, i) =>
        p.id === current[i].id &&
        p.route === current[i].route &&
        p.laneId === current[i].laneId &&
        p.panelType === current[i].panelType &&
        p.tool === current[i].tool &&
        JSON.stringify(p.toolContext ?? null) === JSON.stringify(current[i].toolContext ?? null) &&
        Math.abs(p.proportion - current[i].proportion) < 0.001
      )
    ) {
      const targetFocusId =
        normalized[Math.min(requestedFocusIndex, normalized.length - 1)]?.id ??
        normalized.find((p) => p.route === requestedFocusRoute)?.id ??
        null
      if (get(focusedPanelIdAtom) !== targetFocusId) {
        set(focusedPanelIdAtom, targetFocusId)
      }
      return false
    }

    set(panelStackAtom, normalized)

    const expandedId = get(expandedPanelIdAtom)
    if (expandedId && !normalized.some(panel => panel.id === expandedId)) set(expandedPanelIdAtom, null)

    const focusId =
      normalized[Math.min(requestedFocusIndex, normalized.length - 1)]?.id ??
      normalized.find((p) => p.route === requestedFocusRoute)?.id ??
      null
    set(focusedPanelIdAtom, focusId)

    return true
  }
)

export const resizePanelsAtom = atom(
  null,
  (get, set, { leftIndex, rightIndex, leftProportion, rightProportion }: {
    leftIndex: number
    rightIndex: number
    leftProportion: number
    rightProportion: number
  }) => {
    const stack = get(panelStackAtom)
    if (leftIndex < 0 || rightIndex >= stack.length) return
    const newStack = stack.map((p, i) => {
      if (i === leftIndex) return { ...p, proportion: leftProportion }
      if (i === rightIndex) return { ...p, proportion: rightProportion }
      return p
    })
    set(panelStackAtom, newStack)
  }
)

export const updateFocusedPanelRouteAtom = atom(
  null,
  (get, set, route: ViewRoute) => {
    const stack = get(panelStackAtom)

    if (stack.length === 0) {
      const newEntry = createEntry(route, 1)
      set(panelStackAtom, [newEntry])
      set(focusedPanelIdAtom, newEntry.id)
      return
    }

    const focusedId = get(focusedPanelIdAtom)
    const focused = stack.find(p => p.id === focusedId) ?? stack[0]

    const updated = stack.map((p) =>
      p.id === focused.id
        ? { ...p, ...createEntry(route, p.proportion, p.id), proportion: p.proportion }
        : p
    )

    setDeduped(get, set, updated, focused.id)
    set(focusedPanelIdAtom, focused.id)
  }
)

export const focusNextPanelAtom = atom(
  null,
  (get, set) => {
    const stack = get(panelStackAtom)
    if (stack.length <= 1) return
    const currentIdx = get(focusedPanelIndexAtom)
    const nextIdx = (currentIdx + 1) % stack.length
    set(focusedPanelIdAtom, stack[nextIdx].id)
  }
)

export const focusPrevPanelAtom = atom(
  null,
  (get, set) => {
    const stack = get(panelStackAtom)
    if (stack.length <= 1) return
    const currentIdx = get(focusedPanelIndexAtom)
    const prevIdx = (currentIdx - 1 + stack.length) % stack.length
    set(focusedPanelIdAtom, stack[prevIdx].id)
  }
)

/** Average per-panel share used before normalization when appending a panel. */
function averageShare(stack: readonly PanelStackEntry[]): number {
  return stack.length > 0 ? stack.reduce((sum, panel) => sum + panel.proportion, 0) / stack.length : 1
}

export interface OpenOrFocusPanelRouteInput {
  route: ViewRoute
  afterIndex?: number
  targetLaneId?: PanelLaneId
  intent?: OpenIntent
}

export interface OpenOrFocusPanelRouteResult {
  status: 'focused' | 'opened'
  panelId: string
}

/**
 * Input for atomically resuming an embedded browser panel.
 *
 * Browser panes can be offered by multiple surfaces at once (the workbench tab
 * strip and the browser strip). Keep their de-duplication in the store rather
 * than relying on a component's rendered panel-stack snapshot.
 */
export interface OpenOrFocusBrowserPanelInput {
  instanceId: string
  afterIndex?: number
}

/**
 * Focus the panel already showing `route`, or open it once when it is absent.
 *
 * The lookup and the append share one Jotai write transaction, so two immediate
 * opens of the same route cannot append duplicate panels.
 */
export const openOrFocusPanelRouteAtom = atom(
  null,
  (get, set, { route, afterIndex }: OpenOrFocusPanelRouteInput): OpenOrFocusPanelRouteResult => {
    const stack = get(panelStackAtom)
    const key = panelSurfaceKey({ route })
    const existing = stack.find((entry) => entry.route === route)
      ?? stack.find((entry) => panelSurfaceKey(entry) === key)

    if (existing) {
      setDeduped(get, set, stack.map(entry => entry.id === existing.id ? { ...entry, route, panelType: getPanelTypeFromRoute(route) } : entry), existing.id)
      set(focusedPanelIdAtom, existing.id)
      return { status: 'focused', panelId: existing.id }
    }

    const insertAt = afterIndex !== undefined && afterIndex >= 0 && afterIndex < stack.length
      ? afterIndex + 1
      : stack.length

    const newEntry = createEntry(route, averageShare(stack))
    set(panelStackAtom, normalizeProportions([
      ...stack.slice(0, insertAt),
      newEntry,
      ...stack.slice(insertAt),
    ]))
    set(focusedPanelIdAtom, newEntry.id)
    return { status: 'opened', panelId: newEntry.id }
  }
)

/**
 * Atomically focus the panel for an embedded browser instance, or create it
 * once when it is not yet present. The `get` and `set` calls occur inside the
 * same Jotai write transaction, so two immediate resume actions cannot append
 * duplicate `routes.view.browser(instanceId)` panels.
 */
export const openOrFocusBrowserPanelAtom = atom(
  null,
  (_get, set, { instanceId, afterIndex }: OpenOrFocusBrowserPanelInput): OpenOrFocusPanelRouteResult =>
    set(openOrFocusPanelRouteAtom, {
      route: routes.view.browser(instanceId),
      afterIndex,
      targetLaneId: 'main',
    }),
)
