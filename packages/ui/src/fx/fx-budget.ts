/**
 * Concurrency budget for live effects: at most 1 WebGL and 3 canvas effects
 * animate at once. Extra instances get the static fallback until a slot frees.
 */
export type FxKind = 'css' | 'canvas' | 'webgl'

export const FX_LIMITS: Record<FxKind, number> = { css: Infinity, canvas: 3, webgl: 1 }

const holders: Record<FxKind, Set<symbol>> = { css: new Set(), canvas: new Set(), webgl: new Set() }
const listeners = new Set<() => void>()

export function acquireFxSlot(kind: FxKind, id: symbol): boolean {
  const set = holders[kind]
  if (set.has(id)) return true
  if (set.size >= FX_LIMITS[kind]) return false
  set.add(id)
  return true
}

export function releaseFxSlot(kind: FxKind, id: symbol): void {
  if (holders[kind].delete(id)) listeners.forEach((l) => l())
}

export function onFxSlotFreed(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export function fxSlotsInUse(kind: FxKind): number {
  return holders[kind].size
}

/** Test hook. */
export function __resetFxSlots(): void {
  for (const k of Object.keys(holders) as FxKind[]) holders[k].clear()
}
