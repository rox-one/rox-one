/**
 * Shell layout preferences (rail pins, top pills, second-sidebar visibility,
 * per-screen unread). Small external stores persisted in localStorage so the
 * rail, pills, Settings and onboarding share one source of truth without a
 * provider.
 */
import * as React from 'react'
import * as storage from '@/lib/local-storage'

type Listener = () => void

function createStore<T>(read: () => T, write: (value: T) => void) {
  let value = read()
  const listeners = new Set<Listener>()
  return {
    get: () => value,
    set(next: T) {
      if (Object.is(next, value)) return
      value = next
      write(next)
      for (const listener of listeners) listener()
    },
    /** Re-read storage (tests, cross-window sync). */
    reload() { value = read(); for (const listener of listeners) listener() },
    subscribe(listener: Listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
}

function readIdList(key: storage.StorageKey, fallback: readonly string[]): string[] {
  const raw = storage.get<unknown>(key, null)
  if (!Array.isArray(raw)) return [...fallback]
  const seen = new Set<string>()
  for (const id of raw) if (typeof id === 'string' && id) seen.add(id)
  return [...seen]
}

/** Rail: pinned screens in order (Mark / screens-groups.md). Settings is always at the bottom, never pinned. */
export const DEFAULT_RAIL_PINS: readonly string[] = ['home', 'sessions', 'inbox', 'messenger', 'feed', 'docs', 'tasks', 'calendar', 'browser']
/** Top pills (zero allowed). Главная renders icon-only. */
export const DEFAULT_PILLS: readonly string[] = ['home', 'feed', 'sessions', 'docs', 'browser']
export const RAIL_FIXED_BOTTOM_IDS: ReadonlySet<string> = new Set(['settings'])

export const railPinsStore = createStore<string[]>(
  () => readIdList(storage.KEYS.shellRailPins, DEFAULT_RAIL_PINS),
  (value) => storage.set(storage.KEYS.shellRailPins, value),
)

export const pillsStore = createStore<string[]>(
  () => readIdList(storage.KEYS.shellPills, DEFAULT_PILLS),
  (value) => storage.set(storage.KEYS.shellPills, value),
)

/** 'shown' = expanded or icons (the existing collapse toggle); 'hidden' = no second sidebar. */
export type SecondarySidebarVisibility = 'shown' | 'hidden'
export const secondarySidebarStore = createStore<SecondarySidebarVisibility>(
  () => (storage.get<unknown>(storage.KEYS.shellSidebarMode, 'shown') === 'hidden' ? 'hidden' : 'shown'),
  (value) => storage.set(storage.KEYS.shellSidebarMode, value),
)

function useStore<T>(store: { get(): T; subscribe(l: Listener): () => void }): T {
  return React.useSyncExternalStore(store.subscribe, store.get, store.get)
}

export function useRailPins(): string[] { return useStore(railPinsStore) }
export function usePills(): string[] { return useStore(pillsStore) }
export function useSecondarySidebarVisibility(): SecondarySidebarVisibility { return useStore(secondarySidebarStore) }

export function toggleRailPin(id: string): void {
  if (RAIL_FIXED_BOTTOM_IDS.has(id)) return
  const pins = railPinsStore.get()
  railPinsStore.set(pins.includes(id) ? pins.filter((pin) => pin !== id) : [...pins, id])
}

export function setPills(ids: readonly string[]): void {
  pillsStore.set([...new Set(ids)])
}

export function toggleSecondarySidebar(): void {
  secondarySidebarStore.set(secondarySidebarStore.get() === 'hidden' ? 'shown' : 'hidden')
}

// ---- unread (demo borrowing #8): one counter per screen, set by whoever knows it ----

let unread: Readonly<Record<string, number>> = {}
const unreadListeners = new Set<Listener>()
const unreadOwners = new Map<string, Map<symbol, number>>()

function recomputeUnread(screenId: string) {
  const owners = unreadOwners.get(screenId)
  const total = owners ? [...owners.values()].reduce((sum, count) => sum + count, 0) : 0
  if ((unread[screenId] ?? 0) === total) return
  const next = { ...unread }
  if (total > 0) next[screenId] = total
  else delete next[screenId]
  unread = next
  for (const listener of unreadListeners) listener()
}

export function setScreenUnread(token: symbol, screenId: string, count: number): void {
  let owners = unreadOwners.get(screenId)
  if (!owners) { owners = new Map(); unreadOwners.set(screenId, owners) }
  if (count > 0) owners.set(token, Math.floor(count))
  else owners.delete(token)
  recomputeUnread(screenId)
}

export function useUnreadCounts(): Readonly<Record<string, number>> {
  return React.useSyncExternalStore(
    (listener) => { unreadListeners.add(listener); return () => { unreadListeners.delete(listener) } },
    () => unread,
    () => unread,
  )
}

/**
 * «Seen» baselines (top-50 #8): opening a screen resets its badge. The badge
 * shows only what arrived since the screen was last active; the source count
 * itself stays owned by the screen. Baselines persist for the session only.
 */
let seen: Record<string, number> = {}
const seenListeners = new Set<Listener>()
export function markScreenSeen(screenId: string): void {
  const count = unread[screenId] ?? 0
  if ((seen[screenId] ?? 0) === count) return
  seen = { ...seen, [screenId]: count }
  for (const listener of seenListeners) listener()
}
export function visibleUnread(counts: Readonly<Record<string, number>>, baselines: Readonly<Record<string, number>>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [id, count] of Object.entries(counts)) {
    // A source count that dropped below the baseline (items read elsewhere) re-arms from the new value.
    const delta = count - Math.min(baselines[id] ?? 0, count)
    if (delta > 0) out[id] = delta
  }
  return out
}
function useSeen(): Readonly<Record<string, number>> {
  return React.useSyncExternalStore(
    (listener) => { seenListeners.add(listener); return () => { seenListeners.delete(listener) } },
    () => seen,
    () => seen,
  )
}
/** Badge counts for rail and pills: unread minus the seen baseline. */
export function useVisibleUnreadCounts(): Readonly<Record<string, number>> {
  const counts = useUnreadCounts()
  const baselines = useSeen()
  return React.useMemo(() => visibleUnread(counts, baselines), [counts, baselines])
}
/** Keep the active screens' badges at zero while they are open (counts may keep growing). */
export function useMarkScreensSeen(activeIds: readonly string[]): void {
  const counts = useUnreadCounts()
  const key = activeIds.join('|')
  React.useEffect(() => { for (const id of key.split('|')) if (id) markScreenSeen(id) }, [key, counts])
}

/** Publish an unread count for a screen while mounted (several sources add up). */
export function useScreenUnread(screenId: string, count: number): void {
  const tokenRef = React.useRef<symbol | null>(null)
  if (!tokenRef.current) tokenRef.current = Symbol('unread')
  const token = tokenRef.current
  React.useEffect(() => { setScreenUnread(token, screenId, count) }, [token, screenId, count])
  React.useEffect(() => () => setScreenUnread(token, screenId, 0), [token, screenId])
}

/** Test helper. */
export function resetShellPrefs(): void {
  railPinsStore.reload(); pillsStore.reload(); secondarySidebarStore.reload()
  unreadOwners.clear(); unread = {}; seen = {}
  for (const listener of seenListeners) listener()
  for (const listener of unreadListeners) listener()
}
