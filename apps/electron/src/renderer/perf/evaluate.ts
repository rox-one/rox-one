import { PERF_BUDGETS } from './budgets'
import type {
  BenchmarkSample,
  BudgetVerdict,
  IpcCounts,
  PerfMarkName,
  PercentileStats,
} from './types'
import { summarizeDurations } from './stats'

export function samplesFor(
  samples: BenchmarkSample[],
  name: PerfMarkName,
): BenchmarkSample[] {
  return samples.filter((sample) => sample.name === name)
}

export function evaluateBudget(
  name: PerfMarkName,
  samples: BenchmarkSample[],
): BudgetVerdict {
  const budget = PERF_BUDGETS[name]
  const stats = summarizeDurations(samples.map((sample) => sample.durationMs))
  const collectionReloads = samples.filter((sample) => sample.reloadedCollection).length
  const reasons: string[] = []

  if (samples.length === 0) {
    reasons.push('no samples')
  }
  if (stats.p95Ms > budget.p95Ms) {
    reasons.push(`p95 ${stats.p95Ms.toFixed(2)}ms > ${budget.p95Ms}ms`)
  }
  if (collectionReloads > budget.maxCollectionReloads) {
    reasons.push(`collection reloads ${collectionReloads} > ${budget.maxCollectionReloads}`)
  }

  if (budget.maxIpcPerInteraction) {
    for (const sample of samples) {
      for (const [channel, max] of Object.entries(budget.maxIpcPerInteraction)) {
        const actual = sample.ipc[channel] ?? 0
        if (actual > (max ?? 0)) {
          reasons.push(`${channel} ${actual} > ${max} on a ${name} sample`)
        }
      }
    }
  }

  return {
    name,
    passed: reasons.length === 0,
    gated: budget.ciGate,
    p95Ms: stats.p95Ms,
    budgetMs: budget.p95Ms,
    collectionReloads,
    reasons,
  }
}

export function evaluateAll(samples: BenchmarkSample[]): {
  stats: Partial<Record<PerfMarkName, PercentileStats>>
  verdicts: BudgetVerdict[]
} {
  const names = Object.keys(PERF_BUDGETS) as PerfMarkName[]
  const stats: Partial<Record<PerfMarkName, PercentileStats>> = {}
  const verdicts: BudgetVerdict[] = []
  for (const name of names) {
    const subset = samplesFor(samples, name)
    stats[name] = summarizeDurations(subset.map((sample) => sample.durationMs))
    verdicts.push(evaluateBudget(name, subset))
  }
  return { stats, verdicts }
}

export function mergeIpc(samples: BenchmarkSample[]): IpcCounts {
  const totals: IpcCounts = {}
  for (const sample of samples) {
    for (const [channel, count] of Object.entries(sample.ipc)) {
      totals[channel] = (totals[channel] ?? 0) + (count ?? 0)
    }
  }
  return totals
}

export function gatedFailures(verdicts: BudgetVerdict[]): BudgetVerdict[] {
  return verdicts.filter((verdict) => verdict.gated && !verdict.passed)
}
