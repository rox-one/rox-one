/**
 * Zen Shell layout persistence (ZS-06).
 *
 * Adapter over existing localStorage keys — not a second layout store.
 * Live resize stays in window memory. Only commit() writes. Legacy keys are
 * migrated and dual-written; they are never deleted.
 */

import * as storage from './local-storage'

export const SHELL_LAYOUT_SCHEMA_VERSION = 1 as const
export const SHELL_LAYOUT_KEYBOARD_DEBOUNCE_MS = 250

export const SIDEBAR_WIDTH_MIN = 180
export const SIDEBAR_WIDTH_MAX = 360
export const SIDEBAR_WIDTH_DEFAULT = 220
export const NAVIGATOR_WIDTH_MIN = 240
export const NAVIGATOR_WIDTH_MAX = 480
export const NAVIGATOR_WIDTH_DEFAULT = 300

export interface ShellLayoutPreferencesV1 {
  schemaVersion: 1
  workspaceId: string
  sidebarWidth: number
  navigatorWidth: number
  collapsedSectionIds: string[]
}

export interface ShellLayoutStore {
  get<T>(key: storage.StorageKey, fallback: T, suffix?: string): T
  set<T>(key: storage.StorageKey, value: T, suffix?: string): void
}

const defaultStore: ShellLayoutStore = {
  get: storage.get,
  set: storage.set,
}

export function clampSidebarWidth(value: number): number {
  if (!Number.isFinite(value)) return SIDEBAR_WIDTH_DEFAULT
  return Math.min(Math.max(Math.round(value), SIDEBAR_WIDTH_MIN), SIDEBAR_WIDTH_MAX)
}

export function clampNavigatorWidth(value: number): number {
  if (!Number.isFinite(value)) return NAVIGATOR_WIDTH_DEFAULT
  return Math.min(Math.max(Math.round(value), NAVIGATOR_WIDTH_MIN), NAVIGATOR_WIDTH_MAX)
}

function sanitizeCollapsed(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0))]
}

export function parseShellLayout(raw: unknown, workspaceId: string): ShellLayoutPreferencesV1 | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  if (obj.schemaVersion !== SHELL_LAYOUT_SCHEMA_VERSION) return null
  if (typeof obj.workspaceId !== 'string' || !obj.workspaceId) return null
  if (obj.workspaceId !== workspaceId) return null
  return {
    schemaVersion: 1,
    workspaceId,
    sidebarWidth: clampSidebarWidth(typeof obj.sidebarWidth === 'number' ? obj.sidebarWidth : SIDEBAR_WIDTH_DEFAULT),
    navigatorWidth: clampNavigatorWidth(typeof obj.navigatorWidth === 'number' ? obj.navigatorWidth : NAVIGATOR_WIDTH_DEFAULT),
    collapsedSectionIds: sanitizeCollapsed(obj.collapsedSectionIds),
  }
}

/**
 * Read workspace snapshot, falling back to legacy keys without deleting them.
 */
export function loadShellLayout(
  workspaceId: string | null | undefined,
  store: ShellLayoutStore = defaultStore,
): ShellLayoutPreferencesV1 {
  const id = workspaceId && workspaceId.trim() ? workspaceId : '_default'
  const snapshot = store.get<ShellLayoutPreferencesV1 | null>(storage.KEYS.shellLayout, null, id)
  const parsed = parseShellLayout(snapshot, id)
  if (parsed) return parsed

  const sidebarWidth = clampSidebarWidth(store.get(storage.KEYS.sidebarWidth, SIDEBAR_WIDTH_DEFAULT))
  const navigatorWidth = clampNavigatorWidth(store.get(storage.KEYS.sessionListWidth, NAVIGATOR_WIDTH_DEFAULT))
  const collapsedSectionIds = sanitizeCollapsed(
    store.get<string[] | null>(storage.KEYS.collapsedSidebarItems, null, id)
    ?? store.get<string[] | null>(storage.KEYS.collapsedSidebarItems, null),
  )
  return {
    schemaVersion: 1,
    workspaceId: id,
    sidebarWidth,
    navigatorWidth,
    collapsedSectionIds,
  }
}

export function commitShellLayout(
  patch: Partial<Pick<ShellLayoutPreferencesV1, 'sidebarWidth' | 'navigatorWidth' | 'collapsedSectionIds'>> & {
    workspaceId: string
  },
  store: ShellLayoutStore = defaultStore,
): ShellLayoutPreferencesV1 {
  const current = loadShellLayout(patch.workspaceId, store)
  const next: ShellLayoutPreferencesV1 = {
    schemaVersion: 1,
    workspaceId: current.workspaceId,
    sidebarWidth: patch.sidebarWidth !== undefined ? clampSidebarWidth(patch.sidebarWidth) : current.sidebarWidth,
    navigatorWidth: patch.navigatorWidth !== undefined ? clampNavigatorWidth(patch.navigatorWidth) : current.navigatorWidth,
    collapsedSectionIds: patch.collapsedSectionIds !== undefined
      ? sanitizeCollapsed(patch.collapsedSectionIds)
      : current.collapsedSectionIds,
  }
  store.set(storage.KEYS.shellLayout, next, next.workspaceId)
  // Dual-write legacy keys. Never delete them.
  store.set(storage.KEYS.sidebarWidth, next.sidebarWidth)
  store.set(storage.KEYS.sessionListWidth, next.navigatorWidth)
  store.set(storage.KEYS.collapsedSidebarItems, next.collapsedSectionIds, next.workspaceId)
  return next
}

/** Derived clamp for a tight window. Must not be written as the preferred width. */
export function effectiveSidebarWidth(preferred: number, available: number): number {
  const room = Math.max(SIDEBAR_WIDTH_MIN, available)
  return Math.min(clampSidebarWidth(preferred), room)
}

export function createLayoutCommitDebouncer(
  commit: () => void,
  delayMs: number = SHELL_LAYOUT_KEYBOARD_DEBOUNCE_MS,
): { schedule: () => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null
  return {
    schedule() {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        commit()
      }, delayMs)
    },
    cancel() {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    },
  }
}
