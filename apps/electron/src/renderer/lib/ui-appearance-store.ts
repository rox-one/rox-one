/**
 * DISPATCH A6/B10 — shared «Интерфейс» appearance state.
 *
 * A tiny external store (useSyncExternalStore) instead of a Jotai atom so both
 * the plain-React ThemeProvider (accent) and the shell/settings components read
 * one snapshot without a provider dependency. The main process owns the value;
 * this module only mirrors it and broadcasts local writes back.
 */
import type { ElectronAPI, SystemAccentSnapshot } from '../../shared/types'
import { useSyncExternalStore } from 'react'

export interface UiAppearanceState {
  /** A6 — show the compact bottom status bar (default: visible). */
  statusBarVisible: boolean
  /** B10 — accent source (default: brand). */
  accentSource: 'brand' | 'system'
  /** B10 — last system accent snapshot (null before first read). */
  accent: SystemAccentSnapshot | null
}

const DEFAULT_STATE: UiAppearanceState = { statusBarVisible: true, accentSource: 'brand', accent: null }

let state: UiAppearanceState = DEFAULT_STATE
const listeners = new Set<() => void>()

export function getUiAppearance(): UiAppearanceState {
  return state
}

export function subscribeUiAppearance(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function publish(patch: Partial<UiAppearanceState>): void {
  const next = { ...state, ...patch }
  if (next.statusBarVisible === state.statusBarVisible
    && next.accentSource === state.accentSource
    && next.accent === state.accent) return
  state = next
  for (const listener of listeners) listener()
}

function applySnapshot(snapshot: { statusBarVisible?: boolean; accentSource?: 'brand' | 'system'; accent?: SystemAccentSnapshot | null }): void {
  publish({
    ...(typeof snapshot.statusBarVisible === 'boolean' ? { statusBarVisible: snapshot.statusBarVisible } : {}),
    ...(snapshot.accentSource === 'brand' || snapshot.accentSource === 'system' ? { accentSource: snapshot.accentSource } : {}),
    ...(snapshot.accent !== undefined ? { accent: snapshot.accent } : {}),
  })
}

let attached = false
let detach: (() => void) | null = null

/** Read once and subscribe to the accent push. Idempotent per renderer. */
export function attachUiAppearanceBridge(api: ElectronAPI | undefined = typeof window !== 'undefined' ? window.electronAPI : undefined): void {
  if (attached || !api?.getUiPreferences) return
  attached = true
  let cancelled = false
  void api.getUiPreferences().then(snapshot => {
    if (!cancelled) applySnapshot(snapshot)
  }).catch(() => { /* defaults stand */ })
  const off = api.onAccentChanged?.(accent => applySnapshot({ accent }))
  detach = () => { cancelled = true; off?.(); attached = false; detach = null }
}

/** Test seam. */
export function resetUiAppearanceBridge(): void {
  detach?.()
  state = DEFAULT_STATE
  for (const listener of listeners) listener()
}

/** Persist a patch through the main process; publish only after it is saved. */
export async function saveUiAppearancePatch(
  patch: { statusBarVisible?: boolean; accentSource?: 'brand' | 'system' },
  api: ElectronAPI | undefined = typeof window !== 'undefined' ? window.electronAPI : undefined,
): Promise<boolean> {
  if (!api?.setUiPreferences) return false
  try {
    const snapshot = await api.setUiPreferences(patch)
    applySnapshot(snapshot)
    return true
  } catch {
    return false
  }
}

/** React binding for the shared snapshot. */
export function useUiAppearance(): UiAppearanceState {
  return useSyncExternalStore(subscribeUiAppearance, getUiAppearance, getUiAppearance)
}