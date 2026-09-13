/**
 * Pointer/keyboard resize session (ZS-05). Preview is rAF-coalesced.
 * Durable writes happen only on commit. Cancel restores the snapshot.
 */

import { beginPanelResizeActivity, endPanelResizeActivity } from './resize-activity'
import { solveSplit, type SplitResult } from './resize-math'

export interface ResizeBounds {
  leftId: string
  rightId: string
  total: number
  sizeA: number
  minA: number
  maxA: number
  minB: number
  maxB: number
}

export interface ResizeControllerHandlers {
  onPreview: (sizeA: number, sizeB: number) => void
  onCommit: (sizeA: number, sizeB: number) => void
  onCancel: (sizeA: number, sizeB: number) => void
  now?: () => number
  requestFrame?: (cb: () => void) => number
  cancelFrame?: (id: number) => void
}

export interface ResizeController {
  readonly active: boolean
  readonly snapshot: ResizeBounds | null
  readonly previewCount: number
  readonly commitCount: number
  readonly cancelCount: number
  start(bounds: ResizeBounds): boolean
  moveTo(sizeA: number): void
  moveBy(delta: number, immediate?: boolean): void
  commit(): void
  cancel(): void
  neighborChanged(leftId: string, rightId: string): void
  dispose(): void
}

export function createResizeController(handlers: ResizeControllerHandlers): ResizeController {
  const requestFrame = handlers.requestFrame
    ?? (typeof requestAnimationFrame === 'function'
      ? (cb: () => void) => requestAnimationFrame(() => cb())
      : (cb: () => void) => setTimeout(cb, 0) as unknown as number)
  const cancelFrame = handlers.cancelFrame
    ?? (typeof cancelAnimationFrame === 'function'
      ? (id: number) => cancelAnimationFrame(id)
      : (id: number) => clearTimeout(id))

  let snapshot: ResizeBounds | null = null
  let currentA = 0
  let currentB = 0
  let ended: 'commit' | 'cancel' | null = null
  let previewCount = 0
  let commitCount = 0
  let cancelCount = 0
  let frame = 0
  let pending: { a: number; b: number } | null = null
  let activityHeld = false

  function holdActivity(): void {
    if (activityHeld) return
    beginPanelResizeActivity()
    activityHeld = true
  }

  function releaseActivity(): void {
    if (!activityHeld) return
    endPanelResizeActivity()
    activityHeld = false
  }

  function flushPreview(): void {
    frame = 0
    if (!pending || ended) return
    previewCount += 1
    handlers.onPreview(pending.a, pending.b)
    pending = null
  }

  function apply(result: SplitResult, immediate: boolean): void {
    if (!result.feasible) return
    currentA = result.sizeA
    currentB = result.sizeB
    pending = { a: result.sizeA, b: result.sizeB }
    if (immediate) {
      if (frame) cancelFrame(frame)
      flushPreview()
      return
    }
    if (!frame) frame = requestFrame(flushPreview)
  }

  const controller: ResizeController = {
    get active() { return snapshot !== null && ended === null },
    get snapshot() { return snapshot },
    get previewCount() { return previewCount },
    get commitCount() { return commitCount },
    get cancelCount() { return cancelCount },
    start(bounds) {
      const first = solveSplit({
        total: bounds.total,
        sizeA: bounds.sizeA,
        minA: bounds.minA,
        maxA: bounds.maxA,
        minB: bounds.minB,
        maxB: bounds.maxB,
        delta: 0,
      })
      if (!first.feasible) return false
      snapshot = bounds
      ended = null
      holdActivity()
      apply(first, true)
      return true
    },
    moveTo(sizeA) {
      if (!snapshot || ended) return
      apply(solveSplit({
        total: snapshot.total,
        sizeA: snapshot.sizeA,
        minA: snapshot.minA,
        maxA: snapshot.maxA,
        minB: snapshot.minB,
        maxB: snapshot.maxB,
        delta: sizeA - snapshot.sizeA,
      }), false)
    },
    moveBy(delta, immediate = false) {
      if (!snapshot || ended) return
      apply(solveSplit({
        total: snapshot.total,
        sizeA: currentA,
        minA: snapshot.minA,
        maxA: snapshot.maxA,
        minB: snapshot.minB,
        maxB: snapshot.maxB,
        delta,
      }), immediate)
    },
    commit() {
      if (!snapshot || ended) return
      ended = 'commit'
      if (frame) { cancelFrame(frame); flushPreview() }
      commitCount += 1
      handlers.onCommit(currentA, currentB)
      snapshot = null
      releaseActivity()
    },
    cancel() {
      if (!snapshot || ended) return
      const restoreA = snapshot.sizeA
      const restoreB = snapshot.sizeB
      ended = 'cancel'
      if (frame) { cancelFrame(frame); frame = 0; pending = null }
      cancelCount += 1
      handlers.onCancel(restoreA, restoreB)
      snapshot = null
      releaseActivity()
    },
    neighborChanged(leftId, rightId) {
      if (!snapshot || ended) return
      if (leftId !== snapshot.leftId || rightId !== snapshot.rightId) controller.cancel()
    },
    dispose() {
      controller.cancel()
    },
  }

  return controller
}
