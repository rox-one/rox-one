/**
 * Configurable status-bar composition (top-50 #7). Order is fixed; the user
 * picks which items show (Settings → Appearance → Status bar).
 */
import * as React from 'react'
import * as storage from '@/lib/local-storage'

export const STATUS_BAR_ITEMS = ['workspace', 'sync', 'agents', 'inbox', 'dictation', 'balance', 'version'] as const
export type StatusBarItem = typeof STATUS_BAR_ITEMS[number]
export const DEFAULT_STATUS_BAR_ITEMS: readonly StatusBarItem[] = STATUS_BAR_ITEMS

export function normalizeStatusBarItems(raw: unknown): StatusBarItem[] {
  if (!Array.isArray(raw)) return [...DEFAULT_STATUS_BAR_ITEMS]
  const chosen = new Set(raw.filter((id): id is StatusBarItem => (STATUS_BAR_ITEMS as readonly string[]).includes(id as string)))
  return STATUS_BAR_ITEMS.filter((id) => chosen.has(id))
}

let items: StatusBarItem[] = normalizeStatusBarItems(storage.get<unknown>(storage.KEYS.statusBarItems, null))
const listeners = new Set<() => void>()

export function setStatusBarItem(id: StatusBarItem, on: boolean): void {
  const set = new Set(items)
  if (on) set.add(id); else set.delete(id)
  items = STATUS_BAR_ITEMS.filter((item) => set.has(item))
  storage.set(storage.KEYS.statusBarItems, items)
  for (const l of listeners) l()
}

export function useStatusBarItems(): readonly StatusBarItem[] {
  return React.useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l) } },
    () => items,
    () => items,
  )
}
