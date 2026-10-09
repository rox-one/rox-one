import { describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startupBudgetFor } from '../../../src/shared/startup-perf'
import { COLD_FMP_BUDGET_MS, isolatedEnv, median, metricsFromTimeline, missingMetrics } from '../startup-bench'

describe('startup bench metrics', () => {
  it('extracts window/FMP marks and falls back to the first settled screen', () => {
    const timeline = { timeOriginEpochMs: 0, platform: 'linux', marks: [
      { name: 'main:entry', atMs: 10.4, source: 'main' as const },
      { name: 'main:window-created', atMs: 420.6, source: 'main' as const },
      { name: 'renderer:first-paint', atMs: 900, source: 'renderer' as const },
      { name: 'renderer:interactive:onboarding', atMs: 1100, source: 'renderer' as const },
      { name: 'nav:session:start', atMs: 1200, source: 'renderer' as const },
    ] }
    const metrics = metricsFromTimeline(timeline)
    expect(metrics.windowCreatedMs).toBe(421)
    expect(metrics.fmpMs).toBe(1100)
    expect(metrics.fmpSource).toBe('renderer:interactive:onboarding')
    expect(metrics.marks['nav:session:start']).toBeUndefined()
    const withFmp = metricsFromTimeline({ ...timeline, marks: [...timeline.marks, { name: 'renderer:fmp', atMs: 1300, source: 'renderer' as const }] })
    expect(withFmp.fmpMs).toBe(1300); expect(withFmp.fmpSource).toBe('renderer:fmp')
    expect(metrics.skillsInlineMs).toBeUndefined()
    const inline = metricsFromTimeline({ ...timeline, marks: [...timeline.marks, { name: 'main:skills-sync:inline', atMs: 2400.2, source: 'main' as const }] })
    expect(inline.skillsInlineMs).toBe(2400)
  })
  it('computes medians', () => {
    expect(median([])).toBeUndefined()
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 2, 3])).toBe(2.5)
  })
})

describe('startup bench isolation env', () => {
  it('keeps the real HOME so safeStorage/keychain stays reachable, while isolating the app dirs', () => {
    const profile = mkdtempSync(join(tmpdir(), 'bench-test-'))
    try {
      const env = isolatedEnv(profile, join(profile, 'out.json'))
      expect(env.HOME).toBe(process.env.HOME)
      expect(env.USERPROFILE).toBe(process.env.USERPROFILE ?? process.env.HOME)
      expect(env.ROX_CONFIG_DIR).toBe(join(profile, 'config'))
      expect(env.CRAFT_CONFIG_DIR).toBe(join(profile, 'config'))
      expect(env.ROX_USER_DATA_DIR).toBe(join(profile, 'userData'))
      expect(env.CRAFT_USER_DATA_DIR).toBe(join(profile, 'userData'))
    } finally {
      rmSync(profile, { recursive: true, force: true })
    }
  })
})

describe('startup bench cold budget', () => {
  it('is a generous ceiling strictly above the CI warm FMP budget', () => {
    expect(typeof COLD_FMP_BUDGET_MS).toBe('number')
    expect(COLD_FMP_BUDGET_MS).toBeGreaterThan(startupBudgetFor('firstMeaningfulPaintMs', 'darwin', true))
  })
})

describe('startup bench NO DATA detection', () => {
  it('reports only metrics with an undefined median', () => {
    expect(missingMetrics([{ metric: 'a', median: 1 }, { metric: 'b', median: undefined }])).toEqual(['b'])
    expect(missingMetrics([{ metric: 'a', median: 0 }])).toEqual([])
  })
})
