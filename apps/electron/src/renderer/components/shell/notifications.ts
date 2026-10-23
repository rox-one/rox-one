/**
 * Notification center (top50 #9): one in-app log of what happened while you
 * were elsewhere. Fed by real events — agent turns finishing / failing /
 * waiting for approval (App event processor), automation runs (automation
 * history), and the rox.one balance running low — and persisted locally so
 * the bell survives a reload.
 *
 * API mirrors the demo model: push / unread / markRead / markAllRead / clear.
 */
import * as React from 'react'
import * as storage from '@/lib/local-storage'

export type NotificationKind = 'agent' | 'approval' | 'error' | 'automation' | 'balance'

/**
 * Panel view filter. Lives with the model (not in `NotificationPanel.tsx`) so
 * the eager bell can own the state without a runtime edge to the lazy panel.
 */
export type NotificationFilter = 'all' | 'unread'

export interface ShellNotification {
  id: string
  kind: NotificationKind
  title: string
  body?: string
  at: number
  read: boolean
  /** Owning workspace; omitted for account-wide events (balance). */
  workspaceId?: string
  /** Where a click goes (a ViewRoute string). */
  route?: string
  /** Collapses repeats: a newer push with the same key replaces the older one. */
  dedupeKey?: string
}

/** `read: true` records it without counting as unread (e.g. the session is on screen). */
export type NotificationInput = Omit<ShellNotification, 'id' | 'read' | 'at'> & { at?: number; read?: boolean }

export const MAX_NOTIFICATIONS = 200
const KINDS: ReadonlySet<string> = new Set(['agent', 'approval', 'error', 'automation', 'balance'])

type Listener = () => void
const listeners = new Set<Listener>()
let items: readonly ShellNotification[] | null = null
let seq = 0

export function sanitizeNotifications(raw: unknown): ShellNotification[] {
  if (!Array.isArray(raw)) return []
  const out: ShellNotification[] = []
  for (const value of raw) {
    if (!value || typeof value !== 'object') continue
    const v = value as Record<string, unknown>
    if (typeof v.id !== 'string' || typeof v.title !== 'string' || typeof v.at !== 'number' || !KINDS.has(v.kind as string)) continue
    out.push({
      id: v.id,
      kind: v.kind as NotificationKind,
      title: v.title,
      body: typeof v.body === 'string' ? v.body : undefined,
      at: v.at,
      read: v.read === true,
      workspaceId: typeof v.workspaceId === 'string' ? v.workspaceId : undefined,
      route: typeof v.route === 'string' ? v.route : undefined,
      dedupeKey: typeof v.dedupeKey === 'string' ? v.dedupeKey : undefined,
    })
  }
  return out.sort((a, b) => b.at - a.at).slice(0, MAX_NOTIFICATIONS)
}

function read(): readonly ShellNotification[] {
  if (!items) items = sanitizeNotifications(storage.get<unknown>(storage.KEYS.shellNotifications, []))
  return items
}

/** Mutations start from storage, so another window's latest writes are never dropped. */
function fresh(): readonly ShellNotification[] {
  items = null
  return read()
}

function emit(): void {
  for (const listener of listeners) listener()
}

function write(next: readonly ShellNotification[]): void {
  items = next
  storage.set(storage.KEYS.shellNotifications, next)
  emit()
}

// Cross-window sync: every Rox window shares this localStorage; the `storage`
// event fires in the *other* windows, which drop their cache and re-render.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    // `key === null` is a storage.clear() elsewhere.
    if (event.key !== null && event.key !== storage.getKeyString(storage.KEYS.shellNotifications)) return
    items = null
    emit()
  })
}

export function getNotifications(): readonly ShellNotification[] { return read() }

export function pushNotification(input: NotificationInput): ShellNotification {
  const at = input.at ?? Date.now()
  seq += 1
  const entry: ShellNotification = { ...input, at, id: `n-${at.toString(36)}-${seq}`, read: input.read === true }
  const list = fresh()
  const rest = input.dedupeKey ? list.filter((n) => n.dedupeKey !== input.dedupeKey) : list
  write([entry, ...rest].slice(0, MAX_NOTIFICATIONS))
  return entry
}

export function markNotificationRead(id: string): void {
  const list = fresh()
  if (!list.some((n) => n.id === id && !n.read)) return
  write(list.map((n) => (n.id === id ? { ...n, read: true } : n)))
}

/** Marks everything visible in `scope` (a workspace) read; account-wide items included. */
export function markAllNotificationsRead(workspaceId?: string | null): void {
  const list = fresh()
  if (!list.some((n) => !n.read && inScope(n, workspaceId))) return
  write(list.map((n) => (inScope(n, workspaceId) ? { ...n, read: true } : n)))
}

/**
 * The thing a notification asked for was handled elsewhere (e.g. the
 * permission was answered): mark it read and swap the body to say so.
 */
export function resolveNotification(dedupeKey: string, body: string): void {
  const list = fresh()
  if (!list.some((n) => n.dedupeKey === dedupeKey && (!n.read || n.body !== body))) return
  write(list.map((n) => (n.dedupeKey === dedupeKey ? { ...n, read: true, body } : n)))
}

export function removeNotification(id: string): void {
  const list = fresh()
  if (!list.some((n) => n.id === id)) return
  write(list.filter((n) => n.id !== id))
}

export function clearNotifications(workspaceId?: string | null): void {
  const list = fresh()
  const next = list.filter((n) => !inScope(n, workspaceId))
  if (next.length !== list.length) write(next)
}

export function inScope(n: ShellNotification, workspaceId?: string | null): boolean {
  return !workspaceId || !n.workspaceId || n.workspaceId === workspaceId
}

export function subscribeNotifications(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useNotificationList(workspaceId?: string | null): { items: ShellNotification[]; unread: number } {
  const all = React.useSyncExternalStore(subscribeNotifications, read, read)
  return React.useMemo(() => {
    const scoped = all.filter((n) => inScope(n, workspaceId))
    return { items: scoped, unread: scoped.filter((n) => !n.read).length }
  }, [all, workspaceId])
}

/** Test hook. */
export function resetNotificationsCache(): void { items = null }
