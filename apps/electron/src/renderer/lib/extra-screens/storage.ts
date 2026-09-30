/**
 * Per-workspace JSON storage for the extra screens (MVP: localStorage, like
 * personal tasks). Keys: `rox.<namespace>.v1:<workspaceId>`. Corrupt payloads
 * fall back to the empty value instead of crashing the screen.
 */
export const EXTRA_SCREEN_STORAGE_EVENT = 'rox.extra-screens.storage-changed'

export function workspaceStorageKey(namespace: string, workspaceId: string | null | undefined): string {
  return `rox.${namespace}.v1:${workspaceId ?? 'default'}`
}

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null
  } catch {
    return null
  }
}

export interface WorkspaceJsonSnapshot<T> {
  value: T
  raw: string | null
  available: boolean
  valid: boolean
}

export function readWorkspaceJsonSnapshot<T>(
  namespace: string,
  workspaceId: string | null | undefined,
  normalize: (raw: unknown) => T,
): WorkspaceJsonSnapshot<T> {
  const store = storage()
  if (!store) return { value: normalize(undefined), raw: null, available: false, valid: false }
  const raw = store.getItem(workspaceStorageKey(namespace, workspaceId))
  if (raw === null) return { value: normalize(undefined), raw, available: true, valid: true }
  try {
    return { value: normalize(JSON.parse(raw)), raw, available: true, valid: true }
  } catch {
    return { value: normalize(undefined), raw, available: true, valid: false }
  }
}

export function loadWorkspaceJson<T>(
  namespace: string,
  workspaceId: string | null | undefined,
  normalize: (raw: unknown) => T,
): T {
  return readWorkspaceJsonSnapshot(namespace, workspaceId, normalize).value
}

function announceWorkspaceJsonChange(key: string): void {
  try {
    window.dispatchEvent(new CustomEvent(EXTRA_SCREEN_STORAGE_EVENT, { detail: { key } }))
  } catch {
    // non-DOM test environment
  }
}

export function saveWorkspaceJson(namespace: string, workspaceId: string | null | undefined, value: unknown): boolean {
  const store = storage()
  if (!store) return false
  const key = workspaceStorageKey(namespace, workspaceId)
  store.setItem(key, JSON.stringify(value))
  announceWorkspaceJsonChange(key)
  return true
}

/** Save only if the persisted bytes are still the snapshot the editor opened. */
export function saveWorkspaceJsonIfUnchanged(
  namespace: string,
  workspaceId: string | null | undefined,
  expectedRaw: string | null,
  value: unknown,
): boolean {
  const store = storage()
  if (!store) return false
  const key = workspaceStorageKey(namespace, workspaceId)
  if (store.getItem(key) !== expectedRaw) return false
  store.setItem(key, JSON.stringify(value))
  announceWorkspaceJsonChange(key)
  return true
}

export function subscribeWorkspaceJson(
  namespace: string,
  workspaceId: string | null | undefined,
  onChange: () => void,
): () => void {
  if (typeof window === 'undefined') return () => {}
  const key = workspaceStorageKey(namespace, workspaceId)
  const onCustom = (event: Event) => {
    if ((event as CustomEvent<{ key?: string }>).detail?.key === key) onChange()
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key === key) onChange()
  }
  window.addEventListener(EXTRA_SCREEN_STORAGE_EVENT, onCustom)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(EXTRA_SCREEN_STORAGE_EVENT, onCustom)
    window.removeEventListener('storage', onStorage)
  }
}

export function newLocalId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8)
  return `${prefix}-${Date.now().toString(36)}-${rand}`
}
