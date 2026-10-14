/**
 * Surface placement (WP6, #1533): the user decides where each surface of the
 * primary-nav registry shows — the top pills, the sidebar's primary list, the
 * sidebar «Ещё», or nowhere. One store drives the sidebar (`ShellSidebarNav`),
 * the workbench rail (`ActivityRail`) and the titlebar pill (`ModeBar`).
 *
 * Unset = the registry default (`defaultPlacement`), so existing users keep
 * today's layout until they change something. Stored per device profile in
 * localStorage (`craft-*` namespace, like the pill preferences).
 */
import { useSyncExternalStore } from 'react'

/**
 * Contextual sidebar (#1932 follow-up): the sidebar shows only the CURRENT
 * screen's own navigation, so a surface lives either in the top pills or in
 * the «Все экраны» menu (the pill overflow), or nowhere.
 */
export type NavPlacement = 'pills' | 'menu' | 'hidden'
export const NAV_PLACEMENTS: readonly NavPlacement[] = ['pills', 'menu', 'hidden']
/** Pre-contextual values still found in persisted data: both mean «in the menu». */
export const LEGACY_MENU_PLACEMENTS: ReadonlySet<string> = new Set(['primary', 'more'])

/** Persisted value → current placement (old sidebar placements become «menu»); unknown → null. */
export function normalizePlacement(value: unknown): NavPlacement | null {
  if (typeof value !== 'string') return null
  if (LEGACY_MENU_PLACEMENTS.has(value)) return 'menu'
  return (NAV_PLACEMENTS as readonly string[]).includes(value) ? value as NavPlacement : null
}
export type NavPlacements = Readonly<Record<string, NavPlacement>>

export const NAV_PLACEMENT_KEY = 'craft-nav-placement-v1'

/** Registry entry id of the Home surface: an icon-only pill by default. */
export const HOME_NAV_ID = 'home'

/** Entries that never move (Settings stays in the footer). */
export const FIXED_NAV_IDS: ReadonlySet<string> = new Set(['settings'])

const EMPTY: NavPlacements = Object.freeze({})


function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null
  } catch {
    return null
  }
}

export function readNavPlacements(): NavPlacements {
  const raw = storage()?.getItem(NAV_PLACEMENT_KEY)
  if (!raw) return EMPTY
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return EMPTY
    const out: Record<string, NavPlacement> = {}
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      const placement = normalizePlacement(value)
      if (placement && !FIXED_NAV_IDS.has(id)) out[id] = placement
    }
    return out
  } catch {
    return EMPTY
  }
}

let current: NavPlacements | null = null
const listeners = new Set<() => void>()

/** Old titlebar-pill preferences (`pill-composition.ts`, kept for pins/usage). */
const OLD_PILL_PREFS_KEY = 'craft-workbench-pill-prefs-v1'
/** Old pill surface id → registry id(s) and where the user still saw it (the sidebar). */
const OLD_PILL_EXCLUDED: Readonly<Record<string, Readonly<Record<string, NavPlacement>>>> = {
  feed: { feed: 'menu' },
  team: { messenger: 'menu', sessions: 'menu' },
  notes: { docs: 'menu' },
  browser: { browser: 'menu' },
}
/** Old pinned extra mode id → registry id. */
const MODE_TO_NAV: Readonly<Record<string, string>> = {
  inbox: 'inbox', chat: 'sessions', tasks: 'tasks', notes: 'docs', calendar: 'calendar',
  goals: 'goals', messenger: 'messenger', feed: 'feed', meetings: 'meetings',
}

/**
 * One-time migration of the old pill hides/pins into the placement store.
 * Before WP6 an excluded pill surface was still in the sidebar, so it moves
 * to its sidebar group (not «Скрыт» — hiding it would remove it from the app);
 * an extra pinned mode becomes «Пилюли сверху». An old Home exclusion is
 * dropped: restoring the Главная pill is the point of WP6 (#3).
 */
export function migrateOldPillPreferences(raw: string | null): Record<string, NavPlacement> {
  const out: Record<string, NavPlacement> = {}
  if (!raw) return out
  try {
    const parsed = JSON.parse(raw) as { excluded?: unknown; pinned?: unknown }
    for (const id of Array.isArray(parsed.excluded) ? parsed.excluded : []) {
      Object.assign(out, typeof id === 'string' ? OLD_PILL_EXCLUDED[id] ?? {} : {})
    }
    for (const id of Array.isArray(parsed.pinned) ? parsed.pinned : []) {
      const navId = typeof id === 'string' ? MODE_TO_NAV[id] : undefined
      if (navId && !out[navId]) out[navId] = 'pills'
    }
  } catch {
    /* corrupt old prefs: nothing to migrate */
  }
  return out
}

function get(): NavPlacements {
  if (current) return current
  const store = storage()
  if (store && store.getItem(NAV_PLACEMENT_KEY) === null) {
    const migrated = migrateOldPillPreferences(store.getItem(OLD_PILL_PREFS_KEY))
    try {
      store.setItem(NAV_PLACEMENT_KEY, JSON.stringify(migrated))
    } catch {
      /* ignore */
    }
    current = Object.keys(migrated).length > 0 ? migrated : EMPTY
    return current
  }
  current = readNavPlacements()
  return current
}

/** Set (or with `null` reset to the default) the placement of one surface. */
export function setNavPlacement(id: string, placement: NavPlacement | null): void {
  if (FIXED_NAV_IDS.has(id)) return
  const next: Record<string, NavPlacement> = { ...get() }
  if (placement) next[id] = placement
  else delete next[id]
  current = next
  try {
    storage()?.setItem(NAV_PLACEMENT_KEY, JSON.stringify(next))
  } catch {
    /* quota / private mode: keep the in-memory copy */
  }
  for (const listener of listeners) listener()
}

export function resetNavPlacements(): void {
  current = EMPTY
  try {
    // Keep the (empty) key: its absence would re-run the one-time migration.
    storage()?.setItem(NAV_PLACEMENT_KEY, '{}')
  } catch {
    /* ignore */
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  // Another window changed the placements: re-read on the storage event.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== NAV_PLACEMENT_KEY) return
    current = readNavPlacements()
    listener()
  }
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage)
  }
}

/** React binding; the snapshot is referentially stable until a change. */
export function useNavPlacements(): NavPlacements {
  return useSyncExternalStore(subscribe, get, get)
}

/** Test seam. */
export function __resetNavPlacementsForTests(): void {
  current = null
  listeners.clear()
}
