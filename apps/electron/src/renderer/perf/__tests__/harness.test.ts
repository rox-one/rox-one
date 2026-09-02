import { describe, expect, it } from 'bun:test'
import { runBenchmark, runBenchmarkAndFormat } from '../harness'
import { percentile } from '../budgets'

describe('Issue 03 benchmark harness', () => {
  it('meets the cached session switch budget on 2000 warm sessions', async () => {
    const report = await runBenchmark({ iterations: 40, includeBundle: true })
    const switchSamples = report.runs
      .find((run) => run.fixture === 'sessions-2000')
      ?.samples.filter((s) => s.kind === 'cached-session-switch') ?? []

    expect(switchSamples).toHaveLength(40)
    const p95 = percentile(switchSamples.map((s) => s.durationMs), 95)
    expect(p95).toBeLessThan(120)
    expect(switchSamples.every((s) => !s.collectionReload)).toBe(true)
    expect(switchSamples.every((s) => (s.ipc['sessions:get']?.count ?? 0) === 0)).toBe(true)
    expect(switchSamples.every((s) => s.nPlusOne.length === 0)).toBe(true)
    expect(report.passed).toBe(true)
  })

  it('records cold-ready, surface marks, vault, and a separate bundle track', async () => {
    const { report, text } = await runBenchmarkAndFormat({ iterations: 8, includeBundle: true })
    const kinds = new Set(report.runs.flatMap((run) => run.samples.map((s) => s.kind)))
    expect(kinds.has('cold-ready')).toBe(true)
    expect(kinds.has('view-switch')).toBe(true)
    expect(kinds.has('notes-open')).toBe(true)
    expect(kinds.has('browser-chrome')).toBe(true)
    expect(kinds.has('dropdown-open')).toBe(true)
    expect(kinds.has('canvas-layout')).toBe(true)
    expect(text).toContain('ROX performance report')
    expect(text).toContain('PASS')
    expect(text).toContain('Bundle/minify (separate track)')
    expect(text).toContain('cached-session-switch')
    const bundleRun = report.runs.find((run) => run.fixture === 'sessions-2000')
    expect(bundleRun?.bundle.hung).toBe(false)
  })

  it('opens a 1,000-item premium menu within the dropdown-open budget', async () => {
    const report = await runBenchmark({ iterations: 12, includeBundle: false })
    const samples = report.runs
      .find((run) => run.fixture === 'sessions-2000')
      ?.samples.filter((s) => s.kind === 'dropdown-open') ?? []

    expect(samples).toHaveLength(1)
    expect(samples[0]!.durationMs).toBeLessThan(80)
    expect(report.violations.filter((v) => v.rule.startsWith('dropdown-open'))).toEqual([])
  })
})
