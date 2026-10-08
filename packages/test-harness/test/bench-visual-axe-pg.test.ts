/** W1-10 self-test: micro-benchmarks, visual plan, axe runner (postgres fixture: postgres.test.ts). */
import { describe, expect, test } from 'bun:test'
import { runMicroBenchmarks, MICRO_BENCH_BUDGETS, median, type MicroBenchResult } from '../src/bench.ts'
import { perfGate, gatesExitCode } from '../src/gates/run-all.ts'
import { planVisualSnapshots, SNAPSHOTS_PER_SCREEN, FIXED_CLOCK_MS } from '../src/visual.ts'
import { runAxeAudit } from '../src/axe.ts'

describe('micro-benchmarks', () => {
  test('each bench warms up and reports the median of its samples', () => {
    const results = runMicroBenchmarks({ warmup: 1, samples: 5 })
    expect(results.map((r) => r.name).sort()).toEqual(['list-view', 'resolve', 'work-map'])
    for (const r of results) {
      expect(r.samplesMs).toHaveLength(5)
      expect(r.measuredMs).toBe(median(r.samplesMs))
      expect(r.pass).toBe(r.measuredMs < r.budgetMs)
    }
    expect(MICRO_BENCH_BUDGETS.resolveBatch100Ms).toBe(40)
  })
  test('median is robust to one spike', () => {
    expect(median([1, 2, 500, 3, 2])).toBe(2)
    expect(median([1, 3])).toBe(2)
  })
  // Wall-clock assertions only when explicitly requested (shared runners spike).
  test.if(process.env.ROX_BENCH_STRICT === '1')('strict: medians stay within TECH-SPEC §7 budgets', () => {
    for (const r of runMicroBenchmarks()) expect(r.measuredMs).toBeLessThan(r.budgetMs)
  })
})

describe('perf gate', () => {
  const over: MicroBenchResult[] = [
    { name: 'resolve', measuredMs: 90, samplesMs: [90, 91, 89], budgetMs: 40, pass: false },
    { name: 'work-map', measuredMs: 1, samplesMs: [1, 1, 1], budgetMs: 300, pass: true },
  ]
  test('over budget is report-only on PRs (warn, exit 0)', () => {
    const res = perfGate(over, {})
    expect(res.status).toBe('warn')
    expect(res.summary).toContain('ROX_BENCH_STRICT=1')
    expect(gatesExitCode([res])).toBe(0)
  })
  test('ROX_BENCH_STRICT=1 makes it fatal', () => {
    const res = perfGate(over, { ROX_BENCH_STRICT: '1' })
    expect(res.status).toBe('fail')
    expect(gatesExitCode([res])).toBe(1)
  })
  test('within budget passes', () => {
    expect(perfGate([over[1]!], { ROX_BENCH_STRICT: '1' }).status).toBe('pass')
  })
})

describe('visual snapshot plan', () => {
  test('one screen expands to the full matrix with a fixed clock', () => {
    const plan = planVisualSnapshots(['inbox'])
    expect(plan.length).toBe(SNAPSHOTS_PER_SCREEN)
    expect(SNAPSHOTS_PER_SCREEN).toBe(2 * 2 * 2 * 2 * 7)
    const states = new Set(plan.map((p) => p.state))
    expect(states.has('hover')).toBe(true)
    expect(states.has('focus-visible')).toBe(true)
    expect(states.has('reduced-motion')).toBe(true)
    for (const p of plan) expect(p.clockMs).toBe(FIXED_CLOCK_MS)
    const profiles = new Set(plan.map((p) => p.profile))
    expect([...profiles].sort()).toEqual(['rox', 'se'])
  })
})

describe('axe runner', () => {
  test('clean HTML passes', async () => {
    const res = await runAxeAudit(`<html lang="en"><body><main><img src="a.png" alt="a"><button>Save</button></main></body></html>`)
    expect(res.pass).toBe(true)
    expect(res.violations).toEqual([])
  })
  test('img without alt and empty button fail', async () => {
    const res = await runAxeAudit(`<html><body><img src="a.png"><button></button></body></html>`)
    expect(res.pass).toBe(false)
    expect(res.violations.length).toBeGreaterThanOrEqual(2)
  })
})
