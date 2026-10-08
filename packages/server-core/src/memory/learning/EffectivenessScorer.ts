/**
 * PRD §18/§19 — effectiveness scoring.
 *
 * Component scores stay separated (successRate, correctionRate, conflictRate,
 * reuseRate, confidence); the single effectiveness number is produced by
 * `computeEffectiveness` from `@rox/shared/memory/learning` so the formula has
 * exactly one home. The report shape is the frozen `EffectivenessReport`;
 * supplying `opts.baseline` additionally records `delta` (current effectiveness
 * minus baseline effectiveness) for counterfactual comparison (PRD §19/§40).
 */
import type { EffectivenessComponents, TaskOutcome } from '@rox/shared/memory/learning'
import { clamp01, computeEffectiveness } from '@rox/shared/memory/learning'
import type { EffectivenessReport } from './learning-types'

export interface EffectivenessInput {
  outcomes: TaskOutcome[]
  usageCount: number
  corrections: number
  conflicts: number
}

export interface EffectivenessScorerOptions {
  /** Prior components to compare against; adds `delta` to the report. */
  baseline?: EffectivenessComponents
  /** Target identity for the report — callers scoring a real target pass it. */
  targetType?: EffectivenessReport['targetType']
  targetId?: string
}

/** `EffectivenessReport` plus the baseline delta when a baseline was supplied. */
export interface ScoredEffectiveness extends EffectivenessReport {
  /** effectiveness − computeEffectiveness(baseline); absent without a baseline. */
  delta?: number
}

/** success 1 / partial .5 / failure 0 / aborted 0 (PRD §18). */
const OUTCOME_WEIGHT: Record<TaskOutcome['status'], number> = {
  success: 1,
  partial: 0.5,
  failure: 0,
  aborted: 0,
}

export function scoreEffectiveness(
  input: EffectivenessInput,
  opts: EffectivenessScorerOptions = {},
): ScoredEffectiveness {
  const outcomes = Array.isArray(input.outcomes) ? input.outcomes : []
  const sample = outcomes.length
  const usageCount = Number.isFinite(input.usageCount) ? Math.max(0, input.usageCount) : 0
  const corrections = Number.isFinite(input.corrections) ? Math.max(0, input.corrections) : 0
  const conflicts = Number.isFinite(input.conflicts) ? Math.max(0, input.conflicts) : 0

  const successRate = sample === 0
    ? 0
    : outcomes.reduce((sum, outcome) => sum + (OUTCOME_WEIGHT[outcome.status] ?? 0), 0) / sample
  const correctionRate = clamp01(corrections / (sample || 1))
  const conflictRate = clamp01(conflicts / (usageCount || 1))
  const reuseRate = clamp01(usageCount / 10)
  const confidence = clamp01(0.5 + 0.5 * successRate - 0.5 * correctionRate)

  const components: EffectivenessComponents = {
    successRate: clamp01(successRate),
    correctionRate,
    conflictRate,
    reuseRate,
    confidence,
  }
  const effectiveness = computeEffectiveness(components)

  const report: ScoredEffectiveness = {
    targetType: opts.targetType ?? 'lesson',
    targetId: opts.targetId ?? '',
    components,
    effectiveness,
    sampleSize: sample,
    computedAt: new Date().toISOString(),
  }
  if (opts.baseline) report.delta = effectiveness - computeEffectiveness(opts.baseline)
  return report
}