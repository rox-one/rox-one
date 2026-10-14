/**
 * Lite / reduced-data mode (top-50 #49). On when the user turns it on, or
 * automatically when the OS asks for reduced data (Save-Data or
 * prefers-reduced-data). Sets `<html data-lite>`: CSS drops decorative
 * animation and blur; the panel strip pauses off-screen heavy panels sooner.
 */
import * as React from 'react'
import * as storage from '@/lib/local-storage'

export type LitePreference = 'auto' | 'on' | 'off'
export function normalizeLite(value: unknown): LitePreference {
  return value === 'on' || value === 'off' ? value : 'auto'
}

export function systemWantsReducedData(win: (Window & typeof globalThis) | undefined = typeof window === 'undefined' ? undefined : window): boolean {
  if (!win) return false
  const connection = (win.navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  if (connection?.saveData) return true
  try { return win.matchMedia?.('(prefers-reduced-data: reduce)').matches ?? false } catch { return false }
}

export function resolveLite(pref: LitePreference, systemReduced: boolean): boolean {
  return pref === 'on' || (pref === 'auto' && systemReduced)
}

let pref: LitePreference = normalizeLite(storage.get<unknown>(storage.KEYS.liteMode, 'auto'))
let active = false
const listeners = new Set<() => void>()

function apply(): void {
  active = resolveLite(pref, systemWantsReducedData())
  if (typeof document !== 'undefined') {
    if (active) document.documentElement.setAttribute('data-lite', '')
    else document.documentElement.removeAttribute('data-lite')
  }
  for (const l of listeners) l()
}

let watching = false
/** In 'auto', follow OS reduced-data / Save-Data changes after boot. */
function watchSystem(): void {
  if (watching || typeof window === 'undefined') return
  watching = true
  try { window.matchMedia?.('(prefers-reduced-data: reduce)').addEventListener?.('change', apply) } catch { /* unsupported query */ }
  const connection = (navigator as Navigator & { connection?: EventTarget }).connection
  connection?.addEventListener?.('change', apply)
}

export function seedLiteMode(): void { apply(); watchSystem() }
export function setLitePreference(next: LitePreference): void {
  pref = normalizeLite(next)
  storage.set(storage.KEYS.liteMode, pref)
  apply()
}
export function isLiteActive(): boolean { return active }

function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l) } }
export function useLitePreference(): LitePreference { return React.useSyncExternalStore(subscribe, () => pref, () => pref) }
export function useLiteActive(): boolean { return React.useSyncExternalStore(subscribe, () => active, () => active) }
