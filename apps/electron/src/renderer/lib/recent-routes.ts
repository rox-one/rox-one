/**
 * Recently visited routes for the ⌘K palette «Recent» section (top-50 #6).
 * Most recent first, de-duplicated, capped, persisted.
 */
import * as React from 'react'
import { useAtomValue } from 'jotai'
import { focusedPanelRouteAtom } from '@/atoms/panel-stack'
import * as storage from '@/lib/local-storage'

export const RECENT_ROUTES_MAX = 8
type Listener = () => void

function read(): string[] {
  const raw = storage.get<unknown>(storage.KEYS.recentRoutes, [])
  return Array.isArray(raw) ? raw.filter((r): r is string => typeof r === 'string' && r.length > 0).slice(0, RECENT_ROUTES_MAX) : []
}

let recent: string[] = read()
const listeners = new Set<Listener>()

/** Pure helper: push `route` to the front, dedupe, cap. */
export function pushRecent(list: readonly string[], route: string, max = RECENT_ROUTES_MAX): string[] {
  return [route, ...list.filter((r) => r !== route)].slice(0, max)
}

export function recordRecentRoute(route: string): void {
  if (!route || recent[0] === route) return
  recent = pushRecent(recent, route)
  storage.set(storage.KEYS.recentRoutes, recent)
  for (const listener of listeners) listener()
}

export function getRecentRoutes(): readonly string[] { return recent }
export function __resetRecentRoutes(): void { recent = []; for (const l of listeners) l() }

export function useRecentRoutes(): readonly string[] {
  return React.useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l) } },
    () => recent,
    () => recent,
  )
}

/** Record the focused panel's route whenever it changes. Mount once. */
export function useRecordRecentRoutes(): void {
  const route = useAtomValue(focusedPanelRouteAtom)
  React.useEffect(() => { if (route) recordRecentRoute(String(route)) }, [route])
}
