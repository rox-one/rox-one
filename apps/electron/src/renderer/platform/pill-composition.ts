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
  { id: 'agent', kind: 'mode', titleKey: 'workbench.pill.agent', icon: 'Home', modeId: 'home' },
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
    out.push({ id: surface.id, kind: 'mode', titleKey: surface.titleKey, icon: surface.icon, mode })
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

/** The pill's visible order: composition + extras, minus exclusions, pinned and frequency-sorted. */
export function visiblePillSurfaces(
  modes: readonly ModeContribution[],
  prefs: PillPreferences,
  scene: Pick<Scene, 'surfaceIds'> | null = null,
): ResolvedPillSurface[] {
  if (scene && scene.surfaceIds.length > 0) return scenePillSurfaces(DEFAULT_PILL_SURFACES, modes, scene)
  const surfaces = resolvePillSurfaces(DEFAULT_PILL_SURFACES, modes, prefs.pinned)
  return orderPillSurfaces(surfaces, prefs, sessionUsage(prefs.usage))
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