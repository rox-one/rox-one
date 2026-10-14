/**
 * Per-screen inspector state (top50 #1/#2): every screen (strip screen key,
 * e.g. `sessions`, `docs`) remembers its own inspector visibility, chrome
 * collapse, section, width and pin. A pinned inspector is never closed by
 * automatic scenarios (session-surface entry, empty-Files collapse, squeeze);
 * only an explicit user action closes it.
 *
 * Stored synchronously in localStorage (`shell-inspector-v1`) and applied in a
 * layout effect on screen change, so the restored state is painted on the
 * first frame of the new screen — no jump.
 */
import * as storage from '@/lib/local-storage'

export interface ScreenInspectorState {
  visible?: boolean
  chromeCollapsed?: boolean
  section?: string
  width?: number
  pinned?: boolean
}

export type ScreenInspectorMap = Record<string, ScreenInspectorState>

export const INSPECTOR_PREF_MIN_WIDTH = 240
export const INSPECTOR_PREF_MAX_WIDTH = 1400

export function clampInspectorPrefWidth(width: number): number {
  return Math.round(Math.min(INSPECTOR_PREF_MAX_WIDTH, Math.max(INSPECTOR_PREF_MIN_WIDTH, width)))
}

export function sanitizeInspectorMap(raw: unknown): ScreenInspectorMap {
  const out: ScreenInspectorMap = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!key || !value || typeof value !== 'object' || Array.isArray(value)) continue
    const v = value as Record<string, unknown>
    const entry: ScreenInspectorState = {}
    if (typeof v.visible === 'boolean') entry.visible = v.visible
    if (typeof v.chromeCollapsed === 'boolean') entry.chromeCollapsed = v.chromeCollapsed
    if (typeof v.section === 'string' && v.section) entry.section = v.section
    if (typeof v.width === 'number' && Number.isFinite(v.width)) entry.width = clampInspectorPrefWidth(v.width)
    if (v.pinned === true) entry.pinned = true
    out[key] = entry
  }
  return out
}

let cache: ScreenInspectorMap | null = null
const listeners = new Set<() => void>()

export function readInspectorMap(): ScreenInspectorMap {
  if (!cache) cache = sanitizeInspectorMap(storage.get<unknown>(storage.KEYS.shellInspector, {}))
  return cache
}

export function getScreenInspector(screenKey: string): ScreenInspectorState | undefined {
  return readInspectorMap()[screenKey]
}

/** Merge a patch into one screen's record; returns true when something changed. */
export function patchScreenInspector(screenKey: string, patch: ScreenInspectorState): boolean {
  const map = readInspectorMap()
  const prev = map[screenKey] ?? {}
  const next: ScreenInspectorState = { ...prev, ...patch }
  if (next.width !== undefined) next.width = clampInspectorPrefWidth(next.width)
  if (!next.pinned) delete next.pinned
  const same = (Object.keys({ ...prev, ...next }) as (keyof ScreenInspectorState)[]).every((k) => prev[k] === next[k])
  if (same) return false
  cache = { ...map, [screenKey]: next }
  storage.set(storage.KEYS.shellInspector, cache)
  for (const listener of listeners) listener()
  return true
}

export function subscribeInspectorPrefs(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Test hook: drop the in-memory cache so the next read hits storage. */
export function resetInspectorPrefsCache(): void {
  cache = null
}
