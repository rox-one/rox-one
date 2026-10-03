import * as storage from '@/lib/local-storage'

/** Dismissing setup guidance never disables memory or measured reminders. */
export interface SidebarGuidanceStore {
  get<T>(key: storage.StorageKey, fallback: T, suffix?: string): T
  set<T>(key: storage.StorageKey, value: T, suffix?: string): void
}

export function isSidebarGuidanceDismissed(
  workspaceId: string | null | undefined,
  store: SidebarGuidanceStore = storage,
): boolean {
  return store.get<unknown>(storage.KEYS.sidebarDismissedGuidance, false, workspaceId || '_default') === true
}

export function dismissSidebarGuidance(
  workspaceId: string | null | undefined,
  store: SidebarGuidanceStore = storage,
): void {
  store.set(storage.KEYS.sidebarDismissedGuidance, true, workspaceId || '_default')
}
