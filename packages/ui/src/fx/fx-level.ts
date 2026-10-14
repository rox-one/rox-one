/**
 * «Анимации» preference for decorative effects (libraries.dev FX).
 *
 * full    — effects animate (still subject to reduced motion, hidden window,
 *           low-power profile and capability checks in FxGate)
 * reduced — effects render a static frame / fallback, never animate
 * off     — effects are not mounted; the plain fallback is shown
 *
 * Stored per device in localStorage and mirrored to `<html data-fx-level>`
 * so CSS can react too. Purely a renderer preference: no IPC, no sync.
 */
import { useSyncExternalStore } from 'react'

export type FxLevel = 'full' | 'reduced' | 'off'

export const FX_LEVELS: readonly FxLevel[] = ['full', 'reduced', 'off']
export const FX_LEVEL_STORAGE_KEY = 'rox.fx.level'
const CHANGE_EVENT = 'rox:fx-level-change'

export function isFxLevel(value: unknown): value is FxLevel {
  return value === 'full' || value === 'reduced' || value === 'off'
}

export function readFxLevel(): FxLevel {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(FX_LEVEL_STORAGE_KEY)
    return isFxLevel(raw) ? raw : 'full'
  } catch {
    return 'full'
  }
}

export function setFxLevel(level: FxLevel): void {
  try {
    localStorage.setItem(FX_LEVEL_STORAGE_KEY, level)
  } catch {
    // storage unavailable — still apply for this session via the event
  }
  if (typeof document !== 'undefined') document.documentElement.dataset.fxLevel = level
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGE_EVENT))
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const onStorage = (e: StorageEvent) => { if (e.key === FX_LEVEL_STORAGE_KEY) onChange() }
  window.addEventListener(CHANGE_EVENT, onChange)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange)
    window.removeEventListener('storage', onStorage)
  }
}

export function useFxLevel(): FxLevel {
  return useSyncExternalStore(subscribe, readFxLevel, () => 'full')
}
