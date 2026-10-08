import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import {
  getStartupTimeline, hasStartupMark, markStartup, markStartupOnce, recordRendererMark,
  reportStartupTimelineWhenSettled, resetStartupMarksForTests, whenStartupMark,
} from '../startup-marks'
import {
  formatStartupTimeline, isStartupPerfEnabled, isValidRendererMarkName, STARTUP_MARKS, startupBudgetFor,
} from '../../shared/startup-perf'

afterEach(() => resetStartupMarksForTests())

describe('startup perf contract (PERF-01)', () => {
  it('validates renderer mark names strictly', () => {
    expect(isValidRendererMarkName('renderer:fmp')).toBe(true)
    expect(isValidRendererMarkName('nav:session:end')).toBe(true)
    expect(isValidRendererMarkName('main:app-ready')).toBe(false)
    expect(isValidRendererMarkName('renderer:' + 'x'.repeat(80))).toBe(false)
    expect(isValidRendererMarkName('renderer:<script>')).toBe(false)
    expect(isValidRendererMarkName(42)).toBe(false)
  })
  it('budgets follow the audit and relax on CI', () => {
    expect(startupBudgetFor('windowCreatedMs', 'darwin')).toBe(300)
    expect(startupBudgetFor('windowCreatedMs', 'win32')).toBe(500)
    expect(startupBudgetFor('firstMeaningfulPaintMs', 'darwin')).toBe(800)
    expect(startupBudgetFor('firstMeaningfulPaintMs', 'win32')).toBe(1500)
    expect(startupBudgetFor('firstMeaningfulPaintMs', 'freebsd', true)).toBe(6000)
    expect(isStartupPerfEnabled({ ROX_PERF: '1' })).toBe(true)
    expect(isStartupPerfEnabled({})).toBe(false)
  })
  it('formats a compact, ordered timeline without nav marks', () => {
    const line = formatStartupTimeline({ timeOriginEpochMs: 0, platform: 'darwin', marks: [
      { name: 'renderer:fmp', atMs: 900.4, source: 'renderer' },
      { name: 'main:entry', atMs: 12.2, source: 'main' },
      { name: 'nav:session:start', atMs: 950, source: 'renderer' },
      { name: 'main:window-created', atMs: 250, source: 'main' },
    ], eventLoopDelay: { p50: 1, p99: 22.4, max: 80 } })
    expect(line).toBe('entry=12 window-created=250 fmp=900 loop-p99=22 loop-max=80')
  })
})

describe('main startup marks', () => {
  it('records marks once, resolves waiters, maps renderer epoch times onto the main clock', async () => {
    let resolved = false
    const waiting = whenStartupMark(STARTUP_MARKS.rendererFirstPaint).then(() => { resolved = true })
    markStartupOnce(STARTUP_MARKS.windowCreated)
    markStartupOnce(STARTUP_MARKS.windowCreated)
    expect(getStartupTimeline().marks.filter(m => m.name === STARTUP_MARKS.windowCreated)).toHaveLength(1)
    expect(resolved).toBe(false)
    const epoch = performance.timeOrigin + performance.now()
    recordRendererMark(STARTUP_MARKS.rendererFirstPaint, epoch)
    await waiting
    expect(resolved).toBe(true)
    const paint = getStartupTimeline().marks.find(m => m.name === STARTUP_MARKS.rendererFirstPaint)!
    expect(paint.source).toBe('renderer')
    expect(Math.abs(paint.atMs - (epoch - performance.timeOrigin))).toBeLessThan(1)
    recordRendererMark('renderer:bogus', Number.NaN)
    recordRendererMark('renderer:bogus', 0)
    expect(hasStartupMark('renderer:bogus')).toBe(false)
    await whenStartupMark(STARTUP_MARKS.windowCreated) // already recorded → immediate
  })

  it('reports one line and writes ROX_PERF_OUT after FMP; silent without ROX_PERF', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rox-perf-'))
    try {
      const out = join(dir, 'timeline.json')
      const lines: string[] = []
      reportStartupTimelineWhenSettled(line => lines.push(line), { env: {} })
      reportStartupTimelineWhenSettled(line => lines.push(line), { env: { ROX_PERF: '1', ROX_PERF_OUT: out } })
      markStartup(STARTUP_MARKS.appReady)
      recordRendererMark(STARTUP_MARKS.rendererFirstMeaningfulPaint, performance.timeOrigin + performance.now())
      await new Promise(resolve => setTimeout(resolve, 80))
      expect(lines).toHaveLength(1)
      expect(lines[0]).toMatch(/^\[perf\] startup \(fmp\) .*app-ready=\d+.*fmp=\d+/)
      const json = JSON.parse(readFileSync(out, 'utf8'))
      expect(json.marks.some((m: { name: string }) => m.name === 'renderer:fmp')).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
