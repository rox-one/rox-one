import { DOM_PERF_BUDGETS, DOM_PERF_MARK_NAMES, type DomPerfMarkName } from './dom-budgets'
import { summarizeDurations } from './stats'
import type { PercentileStats } from './types'

/**
 * Verdict for a DOM mark. Mirrors `BudgetVerdict` from the Bun harness but is
 * typed to `DomPerfMarkName` so the two gate families stay independent.
 */
export interface DomBudgetVerdict {
  name: DomPerfMarkName
  passed: boolean
  gated: boolean
  p95Ms: number
  budgetMs: number
  sampleCount: number
  reasons: string[]
}

export interface DomStatsReport {
  stats: Partial<Record<DomPerfMarkName, PercentileStats>>
  verdicts: DomBudgetVerdict[]
}

export function evaluateDomBudget(
  name: DomPerfMarkName,
  durations: number[],
): DomBudgetVerdict {
  const budget = DOM_PERF_BUDGETS[name]
  const stats = summarizeDurations(durations)
  const reasons: string[] = []

  if (stats.count === 0) {
    reasons.push('no samples')
  } else if (stats.p95Ms > budget.p95Ms) {
    reasons.push(`p95 ${stats.p95Ms.toFixed(2)}ms > ${budget.p95Ms}ms`)
  }

  return {
    name,
    passed: reasons.length === 0,
    gated: budget.ciGate,
    p95Ms: stats.p95Ms,
    budgetMs: budget.p95Ms,
    sampleCount: stats.count,
    reasons,
  }
}

export function evaluateDomAll(
  samples: Partial<Record<DomPerfMarkName, number[]>>,
): DomStatsReport {
  const stats: Partial<Record<DomPerfMarkName, PercentileStats>> = {}
  const verdicts: DomBudgetVerdict[] = []
  for (const name of DOM_PERF_MARK_NAMES) {
    const durations = samples[name] ?? []
    stats[name] = summarizeDurations(durations)
    verdicts.push(evaluateDomBudget(name, durations))
  }
  return { stats, verdicts }
}

export function domGatedFailures(verdicts: DomBudgetVerdict[]): DomBudgetVerdict[] {
  return verdicts.filter((verdict) => verdict.gated && !verdict.passed)
}

export function formatDomReport(report: DomStatsReport): string {
  const lines = [
    '# Rox renderer DOM performance report (Chromium)',
    '',
    '| Mark | n | p50 | p95 | budget | gate | result |',
    '|---|---:|---:|---:|---:|---|---|',
  ]
  for (const verdict of report.verdicts) {
    const stats = report.stats[verdict.name]
    lines.push(
      `| ${verdict.name} | ${verdict.sampleCount} | ${(stats?.p50Ms ?? 0).toFixed(2)}ms | ${verdict.p95Ms.toFixed(2)}ms | ${verdict.budgetMs}ms | ${verdict.gated ? 'CI' : 'info'} | ${verdict.passed ? 'pass' : 'FAIL'} |`,
    )
  }
  const failures = domGatedFailures(report.verdicts)
  lines.push('', '## CI gates', '')
  if (failures.length === 0) {
    lines.push('All declared DOM CI budgets passed.')
  } else {
    for (const failure of failures) {
      lines.push(`- FAIL ${failure.name}: ${failure.reasons.join('; ')}`)
    }
  }
  lines.push('')
  return lines.join('\n')
}