/**
 * EffectivenessScorer unit tests (PRD §18/§19): monotonicity per component,
 * the frozen report shape, baseline delta, clamping of over-counted inputs,
 * and the no-throw contract for malformed input.
 */
import { describe, expect, it } from 'bun:test'
import type { EffectivenessComponents, TaskOutcome, TaskOutcomeStatus } from '@rox/shared/memory/learning'
import { computeEffectiveness } from '@rox/shared/memory/learning'
import { scoreEffectiveness } from '../EffectivenessScorer'

const TS = '2026-10-08T00:00:00.000Z'

function makeOutcome(status: TaskOutcomeStatus, index: number): TaskOutcome {
  return {
    id: `out_${index}`,
    sessionId: `sess_${index}`,
    taskFingerprint: 'fp_task',
    status,
    userCorrections: 0,
    memoryUsed: [],
    skillsUsed: [],
    errors: [],
    ts: TS,
  }
}

function outcomesOf(...statuses: TaskOutcomeStatus[]): TaskOutcome[] {
  return statuses.map((status, index) => makeOutcome(status, index))
}

const BASELINE: EffectivenessComponents = {
  successRate: 0.4,
  correctionRate: 0.3,
  conflictRate: 0.2,
  reuseRate: 0.1,
  confidence: 0.5,
}

describe('scoreEffectiveness — report shape', () => {
  it('returns the frozen report fields with components that reproduce effectiveness', () => {
    const report = scoreEffectiveness(
      { outcomes: outcomesOf('success', 'success', 'failure'), usageCount: 4, corrections: 1, conflicts: 0 },
      { targetType: 'skill', targetId: 'skill:bun-install' },
    )

    expect(report.targetType).toBe('skill')
    expect(report.targetId).toBe('skill:bun-install')
    expect(report.sampleSize).toBe(3)
    expect(report.computedAt).toBe(new Date(Date.parse(report.computedAt)).toISOString())
    expect(Object.keys(report.components).sort()).toEqual([
      'confidence',
      'conflictRate',
      'correctionRate',
      'reuseRate',
      'successRate',
    ])
    expect(report.effectiveness).toBeCloseTo(computeEffectiveness(report.components), 10)
    expect(report.delta).toBeUndefined()
  })

  it('defaults the target identity and reports zero samples for empty outcomes', () => {
    const report = scoreEffectiveness({ outcomes: [], usageCount: 0, corrections: 0, conflicts: 0 })

    expect(report.targetType).toBe('lesson')
    expect(report.targetId).toBe('')
    expect(report.sampleSize).toBe(0)
    expect(report.components.successRate).toBe(0)
    expect(report.components.reuseRate).toBe(0)
    expect(report.effectiveness).toBeCloseTo(computeEffectiveness(report.components), 10)
  })

  it('is deterministic for identical input', () => {
    const input = { outcomes: outcomesOf('success', 'partial'), usageCount: 6, corrections: 1, conflicts: 1 }
    const first = scoreEffectiveness(input)
    const second = scoreEffectiveness(input)

    expect(second.components).toEqual(first.components)
    expect(second.effectiveness).toBe(first.effectiveness)
  })
})

describe('scoreEffectiveness — monotonicity', () => {
  it('rises with the success rate', () => {
    const weak = scoreEffectiveness({ outcomes: outcomesOf('failure', 'failure', 'failure', 'success'), usageCount: 2, corrections: 0, conflicts: 0 })
    const strong = scoreEffectiveness({ outcomes: outcomesOf('success', 'success', 'success', 'success'), usageCount: 2, corrections: 0, conflicts: 0 })

    expect(strong.effectiveness).toBeGreaterThan(weak.effectiveness)
    expect(strong.components.successRate).toBe(1)
    expect(weak.components.successRate).toBe(0.25)
  })

  it('counts partial outcomes as half a success', () => {
    const partial = scoreEffectiveness({ outcomes: outcomesOf('partial', 'partial'), usageCount: 0, corrections: 0, conflicts: 0 })
    const full = scoreEffectiveness({ outcomes: outcomesOf('success', 'success'), usageCount: 0, corrections: 0, conflicts: 0 })
    const none = scoreEffectiveness({ outcomes: outcomesOf('aborted', 'aborted'), usageCount: 0, corrections: 0, conflicts: 0 })

    expect(partial.components.successRate).toBe(0.5)
    expect(full.effectiveness).toBeGreaterThan(partial.effectiveness)
    expect(partial.effectiveness).toBeGreaterThan(none.effectiveness)
  })

  it('falls with corrections and conflicts, rising with reuse', () => {
    const base = { outcomes: outcomesOf('success', 'success', 'success', 'success'), usageCount: 5 }
    const clean = scoreEffectiveness({ ...base, corrections: 0, conflicts: 0 })
    const corrected = scoreEffectiveness({ ...base, corrections: 2, conflicts: 0 })
    const conflicted = scoreEffectiveness({ ...base, corrections: 0, conflicts: 2 })
    const reused = scoreEffectiveness({ ...base, corrections: 0, conflicts: 0, usageCount: 10 })

    expect(corrected.effectiveness).toBeLessThan(clean.effectiveness)
    expect(conflicted.effectiveness).toBeLessThan(clean.effectiveness)
    expect(reused.effectiveness).toBeGreaterThan(clean.effectiveness)
    expect(corrected.components.correctionRate).toBeCloseTo(0.5, 10)
    expect(reused.components.reuseRate).toBe(1)
  })
})

describe('scoreEffectiveness — baseline delta', () => {
  it('reports a positive delta when effectiveness improved over the baseline', () => {
    const report = scoreEffectiveness(
      { outcomes: outcomesOf('success', 'success', 'success', 'success'), usageCount: 10, corrections: 0, conflicts: 0 },
      { baseline: BASELINE },
    )

    expect(report.delta).toBeCloseTo(report.effectiveness - computeEffectiveness(BASELINE), 10)
    expect(report.delta).toBeGreaterThan(0)
  })

  it('reports a negative delta when effectiveness regressed below the baseline', () => {
    const report = scoreEffectiveness(
      { outcomes: outcomesOf('failure', 'failure'), usageCount: 0, corrections: 2, conflicts: 3 },
      { baseline: { ...BASELINE, successRate: 0.9, correctionRate: 0, conflictRate: 0, reuseRate: 1, confidence: 0.9 } },
    )

    expect(report.delta).toBeLessThan(0)
  })

  it('omits delta entirely without a baseline', () => {
    const report = scoreEffectiveness({ outcomes: outcomesOf('success'), usageCount: 1, corrections: 0, conflicts: 0 })

    expect('delta' in report).toBe(false)
  })
})

describe('scoreEffectiveness — clamping and no-throw contract', () => {
  it('clamps over-counted rates into [0,1]', () => {
    const report = scoreEffectiveness({ outcomes: outcomesOf('failure'), usageCount: 2, corrections: 9, conflicts: 5 })

    expect(report.components.correctionRate).toBe(1)
    expect(report.components.conflictRate).toBe(1)
    expect(report.components.reuseRate).toBeLessThanOrEqual(1)
  })

  it('treats non-finite counters as zero and never throws', () => {
    const report = scoreEffectiveness({
      outcomes: undefined as unknown as TaskOutcome[],
      usageCount: Number.NaN,
      corrections: Number.POSITIVE_INFINITY,
      conflicts: -3,
    })

    expect(report.sampleSize).toBe(0)
    expect(report.components.successRate).toBe(0)
    expect(report.components.correctionRate).toBe(0)
    expect(report.components.conflictRate).toBe(0)
    expect(report.effectiveness).toBeGreaterThanOrEqual(0)
  })

  it('survives outcomes with unknown status values', () => {
    const corrupt = [
      { ...makeOutcome('success', 0), status: 'weird' },
      { ...makeOutcome('success', 1), status: undefined },
    ] as unknown as TaskOutcome[]
    const report = scoreEffectiveness({ outcomes: corrupt, usageCount: 1, corrections: 0, conflicts: 0 })

    expect(report.sampleSize).toBe(2)
    expect(report.components.successRate).toBe(0)
  })
})