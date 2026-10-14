/**
 * Pill v3 composition (W1.4, D1). The titlebar pill is DATA, not a hardcoded
 * list of modes: `DEFAULT_PILL_SURFACES` declares the starter order
 * (Лента · Команда · Агент · Заметки · Браузер). Mode surfaces resolve against
 * the mode registry; the browser entry is a panel surface whose activation is
 * provided by the host (no dependency on the W1.3 palette).
 *
 * Ordering = explicit pins/exclusions (localStorage) + a usage counter
 * (localStorage). The frequency order is frozen for the whole session
 * (`sessionUsageSnapshot`), so the pill never jumps while the user works:
 * counts recorded now apply from the next launch. Manual pin/exclude is an
 * explicit user action and reorders immediately.
 */
import { useSyncExternalStore } from 'react'
import type { ModeContribution } from '@rox/core/platform'
import { isModeNavigable, listPinnedModes } from '@rox/core/platform'
import type { Route } from '../../shared/routes'
import type { Scene } from './scenes'
import type { LucideIcon } from 'lucide-react'
import type { NavigationState } from '../../shared/types'
import type { ResolvedPrimaryNavEntry } from '../components/app-shell/primary-nav'
import type { NavPlacements } from '../components/app-shell/nav-placement'

export type PillSurfaceKind = 'mode' | 'panel'

export interface PillSurface {
  /** Stable id used for storage, pin/exclude and hotkey slots. */
  id: string
  kind: PillSurfaceKind
  /** i18n key for the label and tooltip. */
  titleKey: string
  /** Lucide icon name, resolved through `resolveLucideIcon`. */
  icon: string
  /** Registry mode id for `kind === 'mode'`. */
  modeId?: string
  /** Used when `modeId` is not registered (e.g. its flag is off). */
  fallbackModeId?: string
  /** Icon-only segment (label in tooltip + aria-label). */
  iconOnly?: boolean
}

export const PILL_BROWSER_SURFACE_ID = 'browser'

/**
 * Starter composition (D1). Order is the documented «стартовый порядок».
 * `Команда` maps to the unified `messenger` surface (каналы/чаты) and falls
 * back to `chat` while `workbench.mode.messenger.v1` is off, so the starter
 * set stays complete on the default (all-flags-off) configuration.
 */
export const DEFAULT_PILL_SURFACES: readonly PillSurface[] = [
  { id: 'feed', kind: 'mode', titleKey: 'workbench.pill.feed', icon: 'Rss', modeId: 'feed' },
  {
    id: 'team',
    kind: 'mode',
    titleKey: 'workbench.pill.team',
    icon: 'MessagesSquare',
    modeId: 'messenger',
    fallbackModeId: 'chat',
  },
  // WP6: Home is an icon-only pill («Главная» in the tooltip/aria-label), always first.
  { id: 'agent', kind: 'mode', titleKey: 'workbench.mode.home', icon: 'Home', modeId: 'home', iconOnly: true },
  { id: 'notes', kind: 'mode', titleKey: 'workbench.pill.notes', icon: 'NotebookPen', modeId: 'notes' },
  { id: PILL_BROWSER_SURFACE_ID, kind: 'panel', titleKey: 'workbench.pill.browser', icon: 'Globe' },
]

export interface ResolvedPillSurface {
  /** Surface id from the composition (or the mode id for user-pinned extras). */
  id: string
  kind: PillSurfaceKind
  titleKey: string
  icon: string
  /** Registry mode for mode surfaces; `null` for panels. */
  mode: ModeContribution | null
  /** Icon-only segment (label in tooltip + aria-label). */
  iconOnly?: boolean
  /** Glyph component for registry surfaces that are not modes (WP6 placement). */
  iconComponent?: LucideIcon
  /** Active test for registry surfaces that are not seeded modes. */
  isActive?: (navState: NavigationState) => boolean
  /** Joined through a Settings placement (not the starter composition). */
  placed?: boolean
}

function resolveMode(
  surface: PillSurface,
  byId: ReadonlyMap<string, ModeContribution>,
): ModeContribution | undefined {
  return (
    (surface.modeId ? byId.get(surface.modeId) : undefined) ??
    (surface.fallbackModeId ? byId.get(surface.fallbackModeId) : undefined)
  )
}

/**
 * Resolve the composition (plus user-pinned mode ids not in the composition)
 * against the registry. Unavailable mode surfaces (missing or non-navigable
 * mode) are dropped; panel surfaces are kept for the host to gate.
 */
export function resolvePillSurfaces(
  surfaces: readonly PillSurface[],
  modes: readonly ModeContribution[],
  extraPinnedIds: readonly string[] = [],
): ResolvedPillSurface[] {
  const byId = new Map(modes.map((mode) => [mode.id, mode]))
  const out: ResolvedPillSurface[] = []
  const seen = new Set<string>()
  for (const surface of surfaces) {
    if (surface.kind === 'panel') {
      out.push({ id: surface.id, kind: 'panel', titleKey: surface.titleKey, icon: surface.icon, mode: null })
      seen.add(surface.id)
      continue
    }
    const mode = resolveMode(surface, byId)
    if (!mode || !isModeNavigable(mode)) continue
    out.push({ id: surface.id, kind: 'mode', titleKey: surface.titleKey, icon: surface.icon, mode, ...(surface.iconOnly ? { iconOnly: true } : {}) })
    seen.add(surface.id)
  }
  const extras = [...extraPinnedIds]
    .filter((id) => !seen.has(id))
    .map((id) => byId.get(id))
    .filter((mode): mode is ModeContribution => Boolean(mode && isModeNavigable(mode)))
    .sort((a, b) => a.order - b.order)
  for (const mode of extras) {
    out.push({ id: mode.id, kind: 'mode', titleKey: mode.titleKey, icon: mode.icon, mode })
    seen.add(mode.id)
  }
  return out
}

/**
 * Navigable registry modes the pill does not represent — the «Все панели…»
 * candidates. `listPinnedModes` is the core default-pin partition; the
 * composition decides the starter subset.
 */
export function pillOverflowModes(
  surfaces: readonly PillSurface[],
  modes: readonly ModeContribution[],
): ModeContribution[] {
  const byId = new Map(modes.map((mode) => [mode.id, mode]))
  const represented = new Set<string>()
  for (const surface of surfaces) {
    if (surface.kind !== 'mode') continue
    if (surface.modeId) represented.add(surface.modeId)
    if (surface.fallbackModeId) represented.add(surface.fallbackModeId)
    const mode = resolveMode(surface, byId)
    if (mode) represented.add(mode.id)
  }
  const { pinned, overflow } = listPinnedModes(modes)
  return [...pinned, ...overflow].filter((mode) => isModeNavigable(mode) && !represented.has(mode.id))
}

// --- preferences + usage ----------------------------------------------------

export interface PillPreferences {
  /** Surface ids the user pinned (rendered first, in this order). */
  pinned: string[]
  /** Surface ids the user excluded from the pill. */
  excluded: string[]
  /** Activation counts by surface id. */
  usage: Record<string, number>
}

/** Namespaced like the renderer's `craft-*` keys (`lib/local-storage.ts`). */
export const PILL_PREFERENCES_KEY = 'craft-workbench-pill-prefs-v1'

function emptyPreferences(): PillPreferences {
  return { pinned: [], excluded: [], usage: {} }
}

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null
  } catch {
    return null
  }
}

export function readPillPreferences(): PillPreferences {
  const raw = storage()?.getItem(PILL_PREFERENCES_KEY)
  if (!raw) return emptyPreferences()
  try {
    const parsed = JSON.parse(raw) as Partial<PillPreferences>
    return {
      pinned: Array.isArray(parsed.pinned) ? [...parsed.pinned] : [],
      excluded: Array.isArray(parsed.excluded) ? [...parsed.excluded] : [],
      usage: parsed.usage && typeof parsed.usage === 'object' ? { ...parsed.usage } : {},
    }
  } catch {
    return emptyPreferences()
  }
}

function writePillPreferences(prefs: PillPreferences): void {
  try {
    storage()?.setItem(PILL_PREFERENCES_KEY, JSON.stringify(prefs))
  } catch {
    /* quota / private mode: keep the in-memory copy */
  }
}

let currentPrefs: PillPreferences | null = null
const prefsListeners = new Set<() => void>()
let sessionUsageSnapshot: Record<string, number> | null = null

function getPreferences(): PillPreferences {
  if (!currentPrefs) currentPrefs = readPillPreferences()
  return currentPrefs
}

function commit(next: PillPreferences): void {
  currentPrefs = next
  writePillPreferences(next)
  for (const listener of prefsListeners) listener()
}

export function subscribePillPreferences(listener: () => void): () => void {
  prefsListeners.add(listener)
  return () => prefsListeners.delete(listener)
}

/** React binding: re-renders the pill when pins/exclusions/usage change. */
export function usePillPreferences(): PillPreferences {
  return useSyncExternalStore(subscribePillPreferences, getPreferences, getPreferences)
}

/** +1 for a surface the user actually opened. Never reorders the current view. */
export function recordPillActivation(id: string): void {
  const prefs = getPreferences()
  commit({ ...prefs, usage: { ...prefs.usage, [id]: (prefs.usage[id] ?? 0) + 1 } })
}

export function setPillPinned(id: string, pinned: boolean): void {
  const prefs = getPreferences()
  const next = new Set(prefs.pinned)
  if (pinned) next.add(id)
  else next.delete(id)
  commit({ ...prefs, pinned: [...next], excluded: pinned ? prefs.excluded.filter((x) => x !== id) : prefs.excluded })
}

export function setPillExcluded(id: string, excluded: boolean): void {
  const prefs = getPreferences()
  const next = new Set(prefs.excluded)
  if (excluded) next.add(id)
  else next.delete(id)
  commit({
    ...prefs,
    excluded: [...next],
    pinned: excluded ? prefs.pinned.filter((p) => p !== id) : prefs.pinned,
  })
}

/** Frozen per-session usage snapshot (module-scope: shared by pill + hotkeys). */
function sessionUsage(usage: Readonly<Record<string, number>>): Record<string, number> {
  if (!sessionUsageSnapshot) sessionUsageSnapshot = { ...usage }
  return sessionUsageSnapshot
}

/**
 * Drop the frozen session usage snapshot so the next read rebuilds it from the
 * stored counters. Called on a workspace switch (and available to logout): the
 * frozen frequency ordering must not leak across rooms.
 */
export function resetPillSessionUsage(): void {
  sessionUsageSnapshot = null
}

/** Test/idle seam: drop the in-memory prefs and the frozen session snapshot. */
export function __resetPillCompositionForTests(): void {
  currentPrefs = null
  sessionUsageSnapshot = null
  prefsListeners.clear()
}

// --- ordering ---------------------------------------------------------------

/** Ids sorted by descending usage; ties keep the incoming order. */
export function frequencyOrder(
  ids: readonly string[],
  usage: Readonly<Record<string, number>>,
): string[] {
  return ids
    .map((id, index) => ({ id, index, count: usage[id] ?? 0 }))
    .sort((a, b) => b.count - a.count || a.index - b.index)
    .map((entry) => entry.id)
}

/**
 * Explicit pins first (in pinned order), then frequency order. Excluded
 * surfaces are dropped, but the pill is never empty: if every surface is
 * excluded the exclusion is ignored.
 */
export function orderPillSurfaces(
  surfaces: readonly ResolvedPillSurface[],
  prefs: PillPreferences,
  usage: Readonly<Record<string, number>>,
): ResolvedPillSurface[] {
  const excluded = new Set(prefs.excluded)
  const visible = surfaces.filter((surface) => !excluded.has(surface.id))
  const pool = visible.length > 0 ? visible : [...surfaces]
  const rank = new Map(frequencyOrder(pool.map((s) => s.id), usage).map((id, index) => [id, index]))
  const pinnedRank = new Map(prefs.pinned.map((id, index) => [id, index]))
  return [...pool].sort((a, b) => {
    const pa = pinnedRank.get(a.id)
    const pb = pinnedRank.get(b.id)
    if (pa !== undefined || pb !== undefined) {
      if (pa === undefined) return 1
      if (pb === undefined) return -1
      return pa - pb
    }
    return (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0)
  })
}

/** Surface placement input (WP6): registry surfaces + the user's explicit choices. */
export interface PillNavPlacement {
  surfaces: readonly ResolvedPrimaryNavEntry[]
  placements: NavPlacements
}

/** Registry id a resolved pill surface stands for (its mode, or the browser panel). */
export function navIdForPill(surface: Pick<ResolvedPillSurface, 'id' | 'kind' | 'mode'>, nav: readonly ResolvedPrimaryNavEntry[]): string | null {
  if (surface.kind === 'panel') return surface.id === PILL_BROWSER_SURFACE_ID ? 'browser' : null
  const modeId = surface.mode?.id
  return nav.find((entry) => entry.modeId !== undefined && entry.modeId === modeId)?.id ?? nav.find((entry) => entry.id === surface.id)?.id ?? null
}

/**
 * WP6 exclusive placement: the pill shows exactly the registry surfaces whose
 * placement is «Пилюли сверху» — the starter composition keeps its spec
 * (label/icon/fallback) for the ones it declares, every other pill-placed
 * surface joins by its mode (or its root route). Pins and the frozen usage
 * order still sort them; the old pill «exclude» list is superseded by the
 * placement store (migrated once, `nav-placement.ts`).
 */
function placedPillSurfaces(
  modes: readonly ModeContribution[],
  prefs: PillPreferences,
  nav: PillNavPlacement,
): ResolvedPillSurface[] {
  const byId = new Map(modes.map((mode) => [mode.id, mode]))
  const pillIds = new Set(nav.surfaces.filter((entry) => entry.placement === 'pills').map((entry) => entry.id))
  const represented = new Set<string>()
  const specs: PillSurface[] = []
  for (const spec of DEFAULT_PILL_SURFACES) {
    const navId = spec.kind === 'panel'
      ? (spec.id === PILL_BROWSER_SURFACE_ID ? 'browser' : null)
      : navIdForPill({ id: spec.id, kind: 'mode', mode: resolveMode(spec, byId) ?? null }, nav.surfaces)
    if (!navId || !pillIds.has(navId)) continue
    specs.push(spec)
    represented.add(navId)
  }
  const resolved = resolvePillSurfaces(specs, modes)
  for (const entry of nav.surfaces) {
    if (!pillIds.has(entry.id) || represented.has(entry.id)) continue
    if (entry.action === 'open-browser') {
      resolved.push({ id: PILL_BROWSER_SURFACE_ID, kind: 'panel', titleKey: 'workbench.pill.browser', icon: 'Globe', mode: null })
      continue
    }
    const mode = entry.modeId ? byId.get(entry.modeId) : undefined
    if (mode) {
      if (!isModeNavigable(mode)) continue
      resolved.push({
        id: mode.id, kind: 'mode', titleKey: entry.labelKey, icon: mode.icon, mode, placed: true,
        ...(entry.id === 'home' ? { iconOnly: true, titleKey: 'workbench.mode.home' } : {}),
      })
      continue
    }
    if (entry.modeId || !entry.route || entry.disabled) continue
    resolved.push({
      id: entry.id, kind: 'mode', titleKey: entry.labelKey, icon: '', iconComponent: entry.icon, isActive: entry.isActive, placed: true,
      mode: { id: entry.id, titleKey: entry.labelKey, icon: '', rootRoute: entry.route(), order: 1000 } as ModeContribution,
    })
  }
  return orderPillSurfaces(resolved, { ...prefs, excluded: [] }, sessionUsage(prefs.usage))
}

/** Home (icon-only) leads the rendered pill. */
function homeFirst(list: ResolvedPillSurface[]): ResolvedPillSurface[] {
  const home = list.findIndex((surface) => surface.iconOnly)
  if (home > 0) list.unshift(...list.splice(home, 1))
  return list
}

/**
 * The pill's rendered order. With `nav` (the app): exclusive WP6 placement;
 * an active Сцена still overrides the composition. Without `nav`: the
 * pre-WP6 composition (pins, exclusions, frequency) — kept for old callers/tests.
 */
export function visiblePillSurfaces(
  modes: readonly ModeContribution[],
  prefs: PillPreferences,
  scene: Pick<Scene, 'surfaceIds'> | null = null,
  nav: PillNavPlacement | null = null,
): ResolvedPillSurface[] {
  if (scene && scene.surfaceIds.length > 0) return homeFirst(scenePillSurfaces(DEFAULT_PILL_SURFACES, modes, scene))
  if (nav) return homeFirst(placedPillSurfaces(modes, prefs, nav))
  const surfaces = resolvePillSurfaces(DEFAULT_PILL_SURFACES, modes, prefs.pinned)
  return orderPillSurfaces(surfaces, prefs, sessionUsage(prefs.usage))
}

/**
 * ⌘1…7 slots: Home is not numbered (it is the icon-only lead), so the
 * remaining surfaces keep the slots they had before Home moved to the front.
 */
export function pillSlotSurfaces(rendered: readonly ResolvedPillSurface[]): ResolvedPillSurface[] {
  return rendered.filter((surface) => !surface.iconOnly)
}

/**
 * WP6 shared selector: what the titlebar pill ACTUALLY renders (scene, flags,
 * non-navigable modes, browser availability, TopBar compact) and which
 * registry surfaces that covers. The sidebar and the rail show a pill-placed
 * surface only when it is not in this set, so nothing becomes unreachable.
 */
export interface PillModel {
  rendered: ResolvedPillSurface[]
  slots: ResolvedPillSurface[]
  navIds: ReadonlySet<string>
}

export function resolvePillModel(input: {
  modes: readonly ModeContribution[]
  prefs: PillPreferences
  scene: Pick<Scene, 'surfaceIds'> | null
  nav: PillNavPlacement
  browserAvailable: boolean
  pillShown: boolean
}): PillModel {
  const all = visiblePillSurfaces(input.modes, input.prefs, input.scene, input.nav)
    .filter((surface) => surface.kind !== 'panel' || input.browserAvailable)
  const navIds = new Set<string>()
  if (input.pillShown) {
    for (const surface of all) {
      const id = navIdForPill(surface, input.nav.surfaces)
      if (id) navIds.add(id)
    }
  }
  return { rendered: all, slots: pillSlotSurfaces(all), navIds }
}

/**
 * Composition for an active Сцена (D8/W2.2): the scene's ordered `surfaceIds`
 * are the priority source of the pill, overriding frequency ordering and manual
 * pins. Ids known to the composition keep their declared spec (label/icon/mode
 * fallback); unknown ids are treated as bare registry mode ids; unavailable
 * modes are dropped by `resolvePillSurfaces`, so a scene saved with a now
 * disabled mode degrades gracefully.
 */
export function scenePillSurfaces(
  surfaces: readonly PillSurface[],
  modes: readonly ModeContribution[],
  scene: Pick<Scene, 'surfaceIds'>,
): ResolvedPillSurface[] {
  const catalog = new Map(surfaces.map((surface) => [surface.id, surface]))
  const byId = new Map(modes.map((mode) => [mode.id, mode]))
  const specs: PillSurface[] = []
  const seen = new Set<string>()
  for (const id of scene.surfaceIds) {
    if (seen.has(id)) continue
    seen.add(id)
    const known = catalog.get(id)
    if (known) {
      specs.push(known)
      continue
    }
    const mode = byId.get(id)
    if (mode) specs.push({ id: mode.id, kind: 'mode', titleKey: mode.titleKey, icon: mode.icon, modeId: mode.id })
  }
  return resolvePillSurfaces(specs, modes)
}

/** ⌘/Ctrl 1…7 → the n-th visible pill surface. */
export function pillSurfaceForSlot(
  surfaces: readonly ResolvedPillSurface[],
  slot: number,
): ResolvedPillSurface | null {
  return surfaces[slot - 1] ?? null
}

/** Activate a surface: navigate to a mode root, or run the host panel opener. */
export function activatePillSurface(
  surface: ResolvedPillSurface,
  deps: { navigate: (route: Route) => void; openBrowser: () => void },
): void {
  if (surface.kind === 'panel') {
    if (surface.id === PILL_BROWSER_SURFACE_ID) deps.openBrowser()
    return
  }
  if (surface.mode?.rootRoute) deps.navigate(surface.mode.rootRoute as Route)
}