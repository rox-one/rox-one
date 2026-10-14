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

export type NavPlacement = 'pills' | 'primary' | 'more' | 'hidden'
export const NAV_PLACEMENTS: readonly NavPlacement[] = ['pills', 'primary', 'more', 'hidden']
export type NavPlacements = Readonly<Record<string, NavPlacement>>

export const NAV_PLACEMENT_KEY = 'craft-nav-placement-v1'

/** Registry entry id of the Home surface: an icon-only pill by default. */
export const HOME_NAV_ID = 'home'

/** Entries that never move (Settings stays in the footer). */
export const FIXED_NAV_IDS: ReadonlySet<string> = new Set(['settings'])

const EMPTY: NavPlacements = Object.freeze({})

function isPlacement(value: unknown): value is NavPlacement {
  return typeof value === 'string' && (NAV_PLACEMENTS as readonly string[]).includes(value)
}

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
      if (isPlacement(value) && !FIXED_NAV_IDS.has(id)) out[id] = value
    }
    return out
  } catch {
    return EMPTY
  }
}

let current: NavPlacements | null = null
const listeners = new Set<() => void>()

function get(): NavPlacements {
  if (!current) current = readNavPlacements()
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
    storage()?.removeItem(NAV_PLACEMENT_KEY)
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
