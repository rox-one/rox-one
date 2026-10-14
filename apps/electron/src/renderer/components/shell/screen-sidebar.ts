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
}

export type SidebarGroupState =
  | { kind: 'ready' }
  | { kind: 'loading' }
  | { kind: 'empty'; label: string; action?: SidebarAction }
  | { kind: 'error'; label: string; onRetry(): void }

export interface SidebarGroup {
  id: string
  title?: string
  items: SidebarItem[]
  state?: SidebarGroupState
  initialVisible?: number
  collapsible?: boolean
  actions?: SidebarAction[]
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
let current: ScreenSidebarConfig | null = null
let owner: symbol | null = null
const listeners = new Set<Listener>()

function emit() { for (const listener of listeners) listener() }

/** Publish a config for `token`. Last publisher wins; clearing is owner-checked. */
export function publishScreenSidebar(token: symbol, config: ScreenSidebarConfig | null): void {
  if (config === null) {
    if (owner !== token) return
    owner = null
    current = null
  } else {
    owner = token
    current = config
  }
  emit()
}

export function getScreenSidebar(): ScreenSidebarConfig | null { return current }

export function subscribeScreenSidebar(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Test helper. */
export function resetScreenSidebar(): void { current = null; owner = null; emit() }

/** Shell side: the currently published config. */
export function useCurrentScreenSidebar(): ScreenSidebarConfig | null {
  return React.useSyncExternalStore(subscribeScreenSidebar, getScreenSidebar, getScreenSidebar)
}

/**
 * Screen side: publish `config` while mounted. Pass a memoized value; it is
 * re-published whenever its identity changes and cleared on unmount.
 */
export function useScreenSidebar(config: ScreenSidebarConfig | null): void {
  const tokenRef = React.useRef<symbol | null>(null)
  if (!tokenRef.current) tokenRef.current = Symbol('screen-sidebar')
  const token = tokenRef.current
  React.useLayoutEffect(() => {
    publishScreenSidebar(token, config)
  }, [token, config])
  React.useLayoutEffect(() => () => publishScreenSidebar(token, null), [token])
}

/** Split a group's items into the visible head and the "Show more" tail. */
export function splitVisible<T>(items: readonly T[], initialVisible: number | undefined, expanded: boolean): { visible: readonly T[]; hiddenCount: number } {
  const limit = Math.max(1, initialVisible ?? DEFAULT_INITIAL_VISIBLE)
  if (expanded || items.length <= limit) return { visible: items, hiddenCount: 0 }
  // Never hide the active row behind "Show more".
  const head = items.slice(0, limit)
  const activeIndex = items.findIndex((item) => (item as { active?: boolean }).active)
  if (activeIndex >= limit) head[limit - 1] = items[activeIndex]
  return { visible: head, hiddenCount: items.length - limit }
}
