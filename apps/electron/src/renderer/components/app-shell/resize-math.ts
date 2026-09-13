/**
 * Zen Shell split solver (ZS-05).
 *
 * For total T, A is clamped to [max(minA, T-maxB), min(maxA, T-minB)].
 * If that range is empty the split is infeasible — never a negative width.
 */

export interface SplitInput {
  total: number
  sizeA: number
  minA: number
  maxA: number
  minB: number
  maxB: number
  delta?: number
}

export interface SplitResult {
  feasible: boolean
  sizeA: number
  sizeB: number
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

  const nextA = Math.min(upper, Math.max(lower, sizeA + (input.delta ?? 0)))
  return { feasible: true, sizeA: nextA, sizeB: total - nextA }
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
