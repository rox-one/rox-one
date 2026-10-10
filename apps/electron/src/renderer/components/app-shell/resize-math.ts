/**
 * Zen Shell split solver (ZS-05).
 *
 * For total T, A is clamped to [max(minA, T-maxB), min(maxA, T-minB)].
 * If that range is empty the split is infeasible — never a negative width.
 *
 * G4 «Студия» magnetic seams: a split may also carry targets at 25 / 50 / 75 %
 * of the pair. When the raw position lands within the snap threshold of a
 * feasible target it resolves to exactly that target (`snapped: true` plus
 * `snapPercent`); otherwise the clamped position is returned unchanged.
 * Pure math — no DOM.
 */

import { CHROME_TOKENS } from '../../platform/chrome-tokens'

/** Magnetic split targets, as a percentage of the pair. */
export type SnapPercent = 25 | 50 | 75

/** Shipped magnetic targets, ascending (ties keep the lower target). */
export const SNAP_PERCENTS: readonly SnapPercent[] = [25, 50, 75]

/** Snap distance from the token layer (`--panel-snap-threshold`). */
export const PANEL_SNAP_THRESHOLD = CHROME_TOKENS.panelSnapThreshold

export interface SplitSnap {
  /** Targets to snap to; defaults to 25 / 50 / 75 %. */
  percents?: readonly SnapPercent[]
  /** Snap distance in px; defaults to `--panel-snap-threshold`. */
  threshold?: number
}

export interface SplitInput {
  total: number
  sizeA: number
  minA: number
  maxA: number
  minB: number
  maxB: number
  delta?: number
  /** Magnetic targets; absent means the seam only clamps (flag OFF). */
  snap?: SplitSnap
}

export interface SplitResult {
  feasible: boolean
  sizeA: number
  sizeB: number
  /** True when the raw position resolved onto a magnetic target. */
  snapped?: boolean
  /** Which target the seam landed on (only when `snapped`). */
  snapPercent?: SnapPercent
}

export const KEYBOARD_RESIZE_STEP = 8
export const KEYBOARD_RESIZE_LARGE_STEP = 32

export function solveSplit(input: SplitInput): SplitResult {
  const { total, sizeA, minA, minB } = input
  const delta = input.delta ?? 0
  if (![total, sizeA, minA, minB, delta].every(Number.isFinite) || total <= 0) {
    return { feasible: false, sizeA: 0, sizeB: 0 }
  }
  const maxA = Number.isFinite(input.maxA) ? input.maxA : Number.POSITIVE_INFINITY
  const maxB = Number.isFinite(input.maxB) ? input.maxB : Number.POSITIVE_INFINITY

  const lower = Math.max(minA, total - maxB)
  const upper = Math.min(maxA, total - minB)
  if (lower > upper) {
    return { feasible: false, sizeA, sizeB: total - sizeA }
  }

  const raw = sizeA + delta
  const nextA = Math.min(upper, Math.max(lower, raw))

  const snap = input.snap
  if (snap) {
    const threshold = Number.isFinite(snap.threshold) ? (snap.threshold as number) : PANEL_SNAP_THRESHOLD
    const percents = snap.percents ?? SNAP_PERCENTS
    let bestTarget: number | null = null
    let bestPercent: SnapPercent | null = null
    let bestDistance = Number.POSITIVE_INFINITY
    for (const percent of percents) {
      const target = (total * percent) / 100
      // A target outside the feasible range would starve a neighbour.
      if (target < lower || target > upper) continue
      const distance = Math.abs(raw - target)
      if (distance > threshold || distance >= bestDistance) continue
      bestDistance = distance
      bestTarget = target
      bestPercent = percent
    }
    if (bestTarget !== null && bestPercent !== null) {
      return { feasible: true, sizeA: bestTarget, sizeB: total - bestTarget, snapped: true, snapPercent: bestPercent }
    }
  }

  return { feasible: true, sizeA: nextA, sizeB: total - nextA, snapped: false }
}

export function equalSplit(total: number, minA: number, maxA: number, minB: number, maxB: number): SplitResult {
  return solveSplit({
    total,
    sizeA: total / 2,
    minA,
    maxA,
    minB,
    maxB,
    delta: 0,
  })
}