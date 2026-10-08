/** W1-10 self-test: micro-benchmarks, visual plan, axe runner (postgres fixture: postgres.test.ts). */
import { describe, expect, test } from 'bun:test'
import { benchRunsFromEnv, runMicroBenchmarks, MICRO_BENCH_BUDGETS, median, type MicroBenchResult } from '../src/bench.ts'
import { perfGate, gatesExitCode } from '../src/gates/run-all.ts'
import { planVisualSnapshots, SNAPSHOTS_PER_SCREEN, FIXED_CLOCK_MS } from '../src/visual.ts'
import { runAxeAudit } from '../src/axe.ts'

describe('micro-benchmarks', () => {
  test('each bench warms up and reports the median of its samples', () => {
    const results = runMicroBenchmarks({ warmup: 1, samples: 5 })
    expect(results.map((r) => r.name).sort()).toEqual(['list-view', 'resolve', 'work-map'])
    for (const r of results) {
      expect(r.samplesMs).toHaveLength(5)
      expect(r.runMediansMs).toHaveLength(1)
      expect(r.measuredMs).toBe(median(r.samplesMs))
      expect(r.pass).toBe(r.measuredMs < r.budgetMs)
    }
    expect(MICRO_BENCH_BUDGETS.resolveBatch100Ms).toBe(40)
  })
  test('runs > 1 reports the median of the run medians', () => {
    const results = runMicroBenchmarks({ warmup: 0, samples: 3, runs: 3 })
    for (const r of results) {
      expect(r.samplesMs).toHaveLength(9)
      expect(r.runMediansMs).toHaveLength(3)
      for (let i = 0; i < 3; i += 1) expect(r.runMediansMs[i]).toBe(median(r.samplesMs.slice(i * 3, i * 3 + 3)))
      expect(r.measuredMs).toBe(median(r.runMediansMs))
    }
  })
  test('benches are labelled: resolve times real @rox/core code, work-map / list-view are synthetic until product code exists', () => {
    const kinds = Object.fromEntries(runMicroBenchmarks({ warmup: 0, samples: 1 }).map((r) => [r.name, r.kind]))
    expect(kinds).toEqual({ resolve: 'real', 'work-map': 'synthetic', 'list-view': 'synthetic' })
  })
  test('an injected real implementation is timed and flips the label to real', () => {
    let calls = 0
    const results = runMicroBenchmarks({ warmup: 2, samples: 3, runs: 2, implementations: { 'work-map': () => { calls += 1 } } })
    expect(results.find((r) => r.name === 'work-map')?.kind).toBe('real')
    expect(calls).toBe(2 * (2 + 3))
  })
  test('ROX_BENCH_RUNS: default 1, positive integers only', () => {
    expect(benchRunsFromEnv({})).toBe(1)
    expect(benchRunsFromEnv({ ROX_BENCH_RUNS: '3' })).toBe(3)
    expect(() => benchRunsFromEnv({ ROX_BENCH_RUNS: '0' })).toThrow('positive integer')
    expect(() => benchRunsFromEnv({ ROX_BENCH_RUNS: 'three' })).toThrow('positive integer')
  })
  test('median is robust to one spike', () => {
    expect(median([1, 2, 500, 3, 2])).toBe(2)
    expect(median([1, 3])).toBe(2)
  })
  // Wall-clock assertions only when explicitly requested (shared runners spike).
  test.if(process.env.ROX_BENCH_STRICT === '1')('strict: medians stay within TECH-SPEC §7 budgets', () => {
    for (const r of runMicroBenchmarks({ runs: benchRunsFromEnv() })) expect(r.measuredMs).toBeLessThan(r.budgetMs)
  })
})

describe('perf gate', () => {
  const over: MicroBenchResult[] = [
    { name: 'resolve', kind: 'real', measuredMs: 90, runMediansMs: [90, 91, 89], samplesMs: [90, 91, 89], budgetMs: 40, pass: false },
    { name: 'work-map', kind: 'synthetic', measuredMs: 1, runMediansMs: [1, 1, 1], samplesMs: [1, 1, 1], budgetMs: 300, pass: true },
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
    expect(res.violations).toEqual(['resolve [real]: median 90.00ms exceeds 40ms'])
    expect(gatesExitCode([res])).toBe(1)
  })
  test('within budget passes', () => {
    expect(perfGate([over[1]!], { ROX_BENCH_STRICT: '1' }).status).toBe('pass')
  })
  test('the summary labels synthetic benches and states the run basis', () => {
    const res = perfGate(over, {})
    expect(res.summary).toContain('resolve[real]=90.00ms/<40ms')
    expect(res.summary).toContain('work-map[synthetic]=1.00ms/<300ms')
    expect(res.summary).toContain('median of 3 run medians (1 samples/run)')
    expect(res.summary).toContain('synthetic (no product code yet): work-map')
    expect(perfGate([], {}).status).toBe('fail')
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
