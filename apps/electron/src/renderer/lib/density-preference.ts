/**
 * UI density (top-50 #40): compact (default) or comfortable. Applied as
 * `<html data-density>` so the token blocks in packages/ui (chrome.css,
 * density.css) swap values; never class names. Seeded before the first render
 * (main.tsx) so there is no layout jump.
 */
import * as React from 'react'
import * as storage from '@/lib/local-storage'

export type UiDensity = 'compact' | 'comfortable'
export const UI_DENSITIES: readonly UiDensity[] = ['compact', 'comfortable']

export function normalizeDensity(value: unknown): UiDensity {
  return value === 'comfortable' ? 'comfortable' : 'compact'
}

let density: UiDensity = normalizeDensity(storage.get<unknown>(storage.KEYS.uiDensity, 'compact'))
const listeners = new Set<() => void>()

export function applyDensity(value: UiDensity, root: HTMLElement | null = typeof document === 'undefined' ? null : document.documentElement): void {
  if (!root) return
  // Compact is the unconditional default in the token files: no attribute.
  if (value === 'comfortable') root.setAttribute('data-density', 'comfortable')
  else root.removeAttribute('data-density')
}

/** Call once before React renders. */
export function seedDensity(): void { applyDensity(density) }

export function setDensity(value: UiDensity): void {
  const next = normalizeDensity(value)
  if (next === density) return
  density = next
  storage.set(storage.KEYS.uiDensity, next)
  applyDensity(next)
  for (const listener of listeners) listener()
}

export function useDensity(): UiDensity {
  return React.useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l) } },
    () => density,
    () => density,
  )
}
