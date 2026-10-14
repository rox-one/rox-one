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
export const DEFAULT_PILLS: readonly string[] = ['home', 'feed', 'messenger', 'sessions', 'docs', 'browser']
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

// ---- narrow window (top50 #3): the second sidebar becomes an overlay ----
// Not persisted: on a narrow window the overlay starts closed and the saved
// wide-window preference is left untouched.
let narrowShell = false
let narrowOverlayOpen = false
const narrowListeners = new Set<Listener>()
function emitNarrow() { for (const listener of narrowListeners) listener() }
const subscribeNarrow = (listener: Listener) => { narrowListeners.add(listener); return () => { narrowListeners.delete(listener) } }

export function setNarrowShell(narrow: boolean): void {
  if (narrowShell === narrow && (narrow || !narrowOverlayOpen)) return
  narrowShell = narrow
  narrowOverlayOpen = false
  emitNarrow()
}
export function setNarrowSidebarOverlayOpen(open: boolean): void {
  if (narrowOverlayOpen === open) return
  narrowOverlayOpen = open
  emitNarrow()
}
export function isNarrowShell(): boolean { return narrowShell }
export function useNarrowSidebarOverlay(): { narrow: boolean; open: boolean } {
  const narrow = React.useSyncExternalStore(subscribeNarrow, () => narrowShell, () => false)
  const open = React.useSyncExternalStore(subscribeNarrow, () => narrowOverlayOpen, () => false)
  return { narrow, open }
}
/** What the user sees: on a narrow window the overlay state, otherwise the saved preference. */
export function useEffectiveSecondaryVisibility(): SecondarySidebarVisibility {
  const saved = useSecondarySidebarVisibility()
  const { narrow, open } = useNarrowSidebarOverlay()
  return narrow ? (open ? 'shown' : 'hidden') : saved
}

export function toggleSecondarySidebar(): void {
  if (narrowShell) {
    setNarrowSidebarOverlayOpen(!narrowOverlayOpen)
    return
  }
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
  unreadOwners.clear(); unread = {}
  for (const listener of unreadListeners) listener()
}
