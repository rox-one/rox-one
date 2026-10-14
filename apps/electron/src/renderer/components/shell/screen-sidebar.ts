/**
 * Screen sidebar config API (shell-layout, see /workspace/out/shell-api.md).
 *
 * A screen publishes WHAT its second sidebar shows (header, primary action,
 * titled groups of real items); the shell decides HOW (expanded / icons /
 * hidden). The store is a tiny external store so publishing never re-renders
 * the shell tree above the sidebar.
 */
import * as React from 'react'
import type { LucideIcon } from 'lucide-react'

export interface SidebarAction {
  id: string
  label: string
  icon?: LucideIcon
  onSelect(): void
  shortcut?: string
  destructive?: boolean
  disabled?: boolean
  dataTour?: string
}

export interface SidebarItem {
  id: string
  label: string
  icon?: LucideIcon
  avatarUrl?: string
  badge?: number | string
  secondary?: string
  active?: boolean
  onSelect(): void
  menu?: SidebarAction[]
  dataTour?: string
  /**
   * How `active` is exposed to assistive tech: 'current' (navigation, default →
   * aria-current="page"), 'pressed' (toggle/filter → aria-pressed) or
   * 'selected' (single choice among peers → aria-current="true").
   */
  ariaKind?: 'current' | 'pressed' | 'selected'
  /** Drop target (e.g. Tasks: drag a task onto a list). Keyboard users need an equivalent `menu` action. */
  drop?: SidebarItemDrop
}

export interface SidebarItemDrop {
  /** MIME-ish types from DataTransfer.types this row accepts (e.g. 'application/x-rox-task'). */
  accepts: readonly string[]
  onDrop(data: DataTransfer): void
  /** Announced on a successful drop (polite live region). */
  announce?: string
}

export type SidebarGroupState =
  | { kind: 'ready' }
  | { kind: 'loading' }
  | { kind: 'empty'; label: string; action?: SidebarAction }
  | { kind: 'error'; label: string; onRetry(): void; /** false when the panel already raises the alert (one role=alert per error). */ announce?: boolean }

export interface SidebarGroup {
  id: string
  title?: string
  items: SidebarItem[]
  state?: SidebarGroupState
  initialVisible?: number
  collapsible?: boolean
  actions?: SidebarAction[]
  /**
   * Custom content rendered under the title (e.g. Calendar mini-calendar), above
   * the items. Shown in expanded mode only; hidden while the group is collapsed.
   * A group with content but no items still renders.
   */
  content?: React.ReactNode
}

export interface ScreenSidebarConfig {
  screenId: string
  title: string
  headerActions?: SidebarAction[]
  primaryAction?: SidebarAction
  search?: { placeholder: string; value: string; onChange(value: string): void }
  groups: SidebarGroup[]
  footer?: React.ReactNode
}

export const DEFAULT_INITIAL_VISIBLE = 5

type Listener = () => void
/** Registrations in publish order (latest last); several screens may be mounted at once (panel strip). */
let registrations: ReadonlyArray<{ token: symbol; config: ScreenSidebarConfig }> = []
const listeners = new Set<Listener>()

function emit() { for (const listener of listeners) listener() }

/** Publish (or replace) the config for `token`; null removes only that token's registration. */
export function publishScreenSidebar(token: symbol, config: ScreenSidebarConfig | null): void {
  const index = registrations.findIndex((entry) => entry.token === token)
  if (config === null) {
    if (index < 0) return
    registrations = registrations.filter((entry) => entry.token !== token)
  } else if (index >= 0) {
    if (registrations[index].config === config) return
    const next = registrations.slice()
    next[index] = { token, config }
    registrations = next
  } else {
    registrations = [...registrations, { token, config }]
  }
  emit()
}

/** The latest registration for `screenId` (null when that screen published nothing). */
export function getScreenSidebar(screenId?: string | null): ScreenSidebarConfig | null {
  for (let i = registrations.length - 1; i >= 0; i--) {
    const { config } = registrations[i]
    if (screenId === undefined || config.screenId === screenId) return config
  }
  return null
}

export function listScreenSidebarIds(): string[] {
  return registrations.map((entry) => entry.config.screenId)
}

export function subscribeScreenSidebar(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Test helper. */
export function resetScreenSidebar(): void { registrations = []; emit() }

/**
 * Shell side: the config published for the focused screen. Configs for other
 * screen ids stay registered (their panels may be open) but are not shown.
 */
export function useCurrentScreenSidebar(screenId: string | null): ScreenSidebarConfig | null {
  const get = React.useCallback(() => (screenId ? getScreenSidebar(screenId) : null), [screenId])
  return React.useSyncExternalStore(subscribeScreenSidebar, get, get)
}

/**
 * Screen side: publish `config` while mounted. Pass a memoized value; it is
 * re-published whenever its identity changes and removed on unmount.
 * `knownScreenIds` (dev) warns when the id matches no registered screen.
 */
export function useScreenSidebar(config: ScreenSidebarConfig | null): void {
  const tokenRef = React.useRef<symbol | null>(null)
  if (!tokenRef.current) tokenRef.current = Symbol('screen-sidebar')
  const token = tokenRef.current
  React.useLayoutEffect(() => {
    if (config && import.meta.env?.DEV && knownScreenIds && !knownScreenIds.has(config.screenId)) {
      console.warn(`[screen-sidebar] "${config.screenId}" is not a registered screen id; the sidebar will never show it.`)
    }
    publishScreenSidebar(token, config)
  }, [token, config])
  React.useLayoutEffect(() => () => publishScreenSidebar(token, null), [token])
}

let knownScreenIds: ReadonlySet<string> | null = null
/** Shell registers the valid screen ids (primary-nav + experimental) for the dev mismatch warning. */
export function setKnownScreenIds(ids: Iterable<string>): void { knownScreenIds = new Set(ids) }

/** Split a group's items into the visible head and the "Show more" tail. */
export function splitVisible<T>(items: readonly T[], initialVisible: number | undefined, expanded: boolean): { visible: readonly T[]; hiddenCount: number } {
  // 0 / negative = no limit.
  const limit = initialVisible === undefined ? DEFAULT_INITIAL_VISIBLE : initialVisible
  if (limit <= 0) return { visible: items, hiddenCount: 0 }
  if (expanded || items.length <= limit) return { visible: items, hiddenCount: 0 }
  // Never hide the active row behind "Show more".
  const head = items.slice(0, limit)
  const activeIndex = items.findIndex((item) => (item as { active?: boolean }).active)
  if (activeIndex >= limit) head[limit - 1] = items[activeIndex]
  return { visible: head, hiddenCount: items.length - limit }
}

/** Re-exported so screens import the whole sidebar API from one module. */
export { useScreenUnread, useUnreadCounts } from './shell-prefs'
