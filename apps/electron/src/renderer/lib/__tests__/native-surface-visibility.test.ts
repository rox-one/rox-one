import { describe, expect, it } from 'bun:test'
import {
  createNativeSurfaceTracker,
  isNativeSurfaceVisible,
  isValidNativeBounds,
  resolveNativeSyncRect,
} from '../native-surface-visibility'

describe('native surface visibility (ZS-07)', () => {
  it('requires mounted, focused, valid bounds, and no suppression', () => {
    const suppression = new Set<'resize' | 'overlay'>()
    const base = {
      mounted: true,
      focused: true,
      removed: false,
      bounds: { x: 0, y: 0, width: 400, height: 300 },
      suppression,
      generation: 1,
      destroyed: false,
    }
    expect(isNativeSurfaceVisible(base)).toBe(true)
    expect(isNativeSurfaceVisible({ ...base, focused: false })).toBe(false)
    expect(isNativeSurfaceVisible({ ...base, removed: true })).toBe(false)
    expect(isNativeSurfaceVisible({ ...base, bounds: { x: 0, y: 0, width: 80, height: 40 } })).toBe(false)
    suppression.add('resize')
    expect(isNativeSurfaceVisible(base)).toBe(false)
  })

  it('does not let a stale generation un-hide a suppressed surface', () => {
    const tracker = createNativeSurfaceTracker()
    tracker.mount()
    tracker.setFocused(true)
    tracker.setBounds({ x: 10, y: 10, width: 400, height: 300 })
    const stale = tracker.snapshot.generation
    tracker.acquire('resize')
    expect(resolveNativeSyncRect(tracker.snapshot, stale).apply).toBe(false)
    const live = tracker.resolve(tracker.snapshot.generation)
    expect(live.apply).toBe(true)
    expect(live.rect).toBeNull()
    tracker.release('resize')
    const restored = tracker.resolve(tracker.snapshot.generation)
    expect(restored.rect).toEqual({ x: 10, y: 10, width: 400, height: 300 })
  })

  it('keeps overlay suppression after resize lease is released', () => {
    const tracker = createNativeSurfaceTracker()
    tracker.mount()
    tracker.setBounds({ x: 0, y: 0, width: 400, height: 300 })
    tracker.acquire('resize')
    tracker.acquire('overlay')
    tracker.release('resize')
    expect(tracker.resolve(tracker.snapshot.generation).rect).toBeNull()
    tracker.release('overlay')
    expect(tracker.resolve(tracker.snapshot.generation).rect?.width).toBe(400)
  })

  it('hides a destroyed instance and ignores stale generations', () => {
    const tracker = createNativeSurfaceTracker()
    tracker.mount()
    tracker.setBounds({ x: 0, y: 0, width: 400, height: 300 })
    const stale = tracker.snapshot.generation
    tracker.unmount()
    expect(isValidNativeBounds({ x: 0, y: 0, width: 400, height: 300 })).toBe(true)
    expect(tracker.resolve(stale).apply).toBe(false)
    expect(tracker.resolve(tracker.snapshot.generation).rect).toBeNull()
  })
})
