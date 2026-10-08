/** W1-10 self-test: micro-benchmarks, visual plan, axe runner, postgres fixture. */
import { describe, expect, test } from 'bun:test'
import { runMicroBenchmarks, MICRO_BENCH_BUDGETS } from '../src/bench.ts'
import { planVisualSnapshots, SNAPSHOTS_PER_SCREEN, FIXED_CLOCK_MS } from '../src/visual.ts'
import { runAxeAudit } from '../src/axe.ts'
import { resolvePostgresUrl, ensurePostgres } from '../src/postgres.ts'

describe('micro-benchmarks', () => {
  test('all benches run within TECH-SPEC §7 budgets', () => {
    const results = runMicroBenchmarks()
    expect(results.map((r) => r.name).sort()).toEqual(['list-view', 'resolve', 'work-map'])
    for (const r of results) {
      expect(r.measuredMs).toBeLessThan(r.budgetMs)
      expect(r.pass).toBe(true)
    }
    expect(MICRO_BENCH_BUDGETS.resolveBatch100Ms).toBe(40)
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

describe('postgres fixture', () => {
  test('ROX_TEST_PG_URL is honoured when set', () => {
    expect(resolvePostgresUrl({ ROX_TEST_PG_URL: 'postgres://x' } as NodeJS.ProcessEnv)).toBe('postgres://x')
    expect(resolvePostgresUrl({} as NodeJS.ProcessEnv)).toBeNull()
  })
  test('env URL yields a live fixture without docker', async () => {
    const fx = await ensurePostgres({ ROX_TEST_PG_URL: 'postgres://x' } as NodeJS.ProcessEnv)
    expect(fx.status).toBe('live')
    expect(fx.url).toBe('postgres://x')
  })
})
