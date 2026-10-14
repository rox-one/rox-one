/**
 * Configurable status-bar composition (top-50 #7). Order is fixed; the user
 * picks which items show (Settings → Appearance → Status bar).
 */
import * as React from 'react'
import * as storage from '@/lib/local-storage'

export const STATUS_BAR_ITEMS = ['workspace', 'sync', 'sessions', 'agents', 'tasks', 'inbox', 'dictation', 'model', 'balance', 'notifications', 'version'] as const
export type StatusBarItem = typeof STATUS_BAR_ITEMS[number]
export const DEFAULT_STATUS_BAR_ITEMS: readonly StatusBarItem[] = STATUS_BAR_ITEMS

/** Items added after the first stored format (a plain array); they default on for lists saved before they existed. */
const ITEMS_ADDED_V2: readonly StatusBarItem[] = ['sessions', 'tasks', 'model', 'notifications']

type StoredItems = { v: 2; items: unknown }

export function normalizeStatusBarItems(raw: unknown): StatusBarItem[] {
  const isV2 = typeof raw === 'object' && raw !== null && !Array.isArray(raw) && (raw as StoredItems).v === 2
  const list = isV2 ? (raw as StoredItems).items : raw
  if (!Array.isArray(list)) return [...DEFAULT_STATUS_BAR_ITEMS]
  const chosen = new Set(list.filter((id): id is StatusBarItem => (STATUS_BAR_ITEMS as readonly string[]).includes(id as string)))
  if (!isV2) for (const id of ITEMS_ADDED_V2) chosen.add(id)
  return STATUS_BAR_ITEMS.filter((id) => chosen.has(id))
}

let items: StatusBarItem[] = normalizeStatusBarItems(storage.get<unknown>(storage.KEYS.statusBarItems, null))
const listeners = new Set<() => void>()

export function setStatusBarItem(id: StatusBarItem, on: boolean): void {
  const set = new Set(items)
  if (on) set.add(id); else set.delete(id)
  items = STATUS_BAR_ITEMS.filter((item) => set.has(item))
  storage.set<StoredItems>(storage.KEYS.statusBarItems, { v: 2, items })
  for (const l of listeners) l()
}

export function useStatusBarItems(): readonly StatusBarItem[] {
  return React.useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l) } },
    () => items,
    () => items,
  )
}
