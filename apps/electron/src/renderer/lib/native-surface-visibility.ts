/**
 * Native embedded surface visibility (ZS-07).
 *
 * The native WebContentsView is shown only when every predicate holds:
 * mounted && focused && !removed && validBounds && !suppressed.
 * Suppression is a lease set so resize and overlay cannot clear each other.
 * A stale rAF must not un-hide while any lease is held or the generation moved.
 */

export const NATIVE_BOUNDS_MIN_WIDTH = 120
export const NATIVE_BOUNDS_MIN_HEIGHT = 80

export type NativeSuppressionReason = 'resize' | 'overlay'

export interface NativeBoundsRect {
  x: number
  y: number
  width: number
  height: number
}

export interface NativeSurfaceSnapshot {
  mounted: boolean
  focused: boolean
  removed: boolean
  bounds: NativeBoundsRect | null
  suppression: ReadonlySet<NativeSuppressionReason>
  generation: number
  destroyed: boolean
}

export function isValidNativeBounds(rect: NativeBoundsRect | null): rect is NativeBoundsRect {
  if (!rect) return false
  return [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
    && rect.width >= NATIVE_BOUNDS_MIN_WIDTH
    && rect.height >= NATIVE_BOUNDS_MIN_HEIGHT
}

export function isNativeSurfaceVisible(snapshot: NativeSurfaceSnapshot): boolean {
  return snapshot.mounted
    && snapshot.focused
    && !snapshot.removed
    && !snapshot.destroyed
    && isValidNativeBounds(snapshot.bounds)
    && snapshot.suppression.size === 0
}

export function shouldApplyNativeBounds(
  snapshot: NativeSurfaceSnapshot,
  incomingGeneration: number,
): boolean {
  if (incomingGeneration !== snapshot.generation) return false
  return true
}

export function resolveNativeSyncRect(
  snapshot: NativeSurfaceSnapshot,
  incomingGeneration: number,
): { apply: boolean; rect: NativeBoundsRect | null } {
  if (!shouldApplyNativeBounds(snapshot, incomingGeneration)) {
    return { apply: false, rect: null }
  }
  if (!isNativeSurfaceVisible(snapshot)) {
    return { apply: true, rect: null }
  }
  return { apply: true, rect: snapshot.bounds }
}

export function createNativeSurfaceTracker() {
  const suppression = new Set<NativeSuppressionReason>()
  const snapshot: NativeSurfaceSnapshot = {
    mounted: false,
    focused: true,
    removed: false,
    bounds: null,
    suppression,
    generation: 0,
    destroyed: false,
  }

  function bump(): number {
    snapshot.generation += 1
    return snapshot.generation
  }

  return {
    snapshot,
    bump,
    mount() {
      snapshot.mounted = true
      snapshot.destroyed = false
      return bump()
    },
    unmount() {
      snapshot.mounted = false
      snapshot.destroyed = true
      return bump()
    },
    setFocused(focused: boolean) {
      snapshot.focused = focused
      return bump()
    },
    setRemoved(removed: boolean) {
      snapshot.removed = removed
      return bump()
    },
    setBounds(bounds: NativeBoundsRect | null) {
      snapshot.bounds = bounds
      return snapshot.generation
    },
    acquire(reason: NativeSuppressionReason) {
      suppression.add(reason)
      return bump()
    },
    release(reason: NativeSuppressionReason) {
      suppression.delete(reason)
      return bump()
    },
    resolve(incomingGeneration: number): { apply: boolean; rect: NativeBoundsRect | null } {
      return resolveNativeSyncRect(snapshot, incomingGeneration)
    },
  }
}
