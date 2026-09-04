import { describe, expect, it } from 'bun:test'
import { profileBundleInventory, profileMinifyHang } from '../bundle-profile'
import { gatedFailures } from '../evaluate'
import { formatPerfReport } from '../report'
import { runPerfHarness } from '../runner'
import { PERF_MARK_NAMES } from '../types'

describe('perf harness runner', () => {
  it('records every instrumented surface and passes CI gates', () => {
    const report = runPerfHarness({ sessionCount: 2000, switchIterations: 40 })
    const names = new Set(report.verdicts.map((verdict) => verdict.name))
    for (const name of PERF_MARK_NAMES) {
      expect(names.has(name)).toBe(true)
      expect((report.stats[name]?.count ?? 0) > 0).toBe(true)
    }
    expect(report.fixture.sessionCount).toBe(2000)
    expect(report.fixture.vaultNoteCount).toBe(5000)
    expect(report.longTasks).toBeGreaterThan(0)
    expect(report.reactCommits).toBeGreaterThan(0)
    expect(report.payloadSamples).toBeGreaterThan(0)
    expect(report.bundleProfileMs).toBeNull()
    expect(gatedFailures(report.verdicts)).toEqual([])
  })

  it('keeps bundle/minify profiling off the runtime mark clock', () => {
    const runtime = runPerfHarness({ sessionCount: 500, switchIterations: 8 })
    const bundle = profileBundleInventory(['a.ts', 'b.tsx', 'c.png'])
    const minify = profileMinifyHang(1_000, 1)
    expect(runtime.bundleProfileMs).toBeNull()
    expect(bundle.fileCount).toBe(2)
    expect(minify.phase).toBe('minify')
    expect(runtime.verdicts.every((verdict) => verdict.name !== 'cold_ready' || verdict.p95Ms >= 0)).toBe(true)
  })

  it('renders a human-readable report with CI gate status', () => {
    const text = formatPerfReport(runPerfHarness({ sessionCount: 500, switchIterations: 8 }))
    expect(text).toContain('# Rox renderer performance report')
    expect(text).toContain('cached_session_switch')
    expect(text).toContain('All declared CI budgets passed.')
    expect(text).toContain('sessions.get')
  })
})
