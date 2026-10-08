/**
 * Main-process startup timeline (PERF-01).
 *
 * Imported first by main/index.ts so `main:entry` lands before any heavy
 * module evaluates. Marks are `performance.mark`s (visible in `--inspect`
 * profiles) plus a small ring buffer that the bench reads via
 * `globalThis.__roxStartupPerf` and that is logged as one line with ROX_PERF=1.
 */
import { monitorEventLoopDelay, performance, type IntervalHistogram } from 'node:perf_hooks'
import { writeFileSync } from 'node:fs'
import {
  formatStartupTimeline,
  isStartupPerfEnabled,
  STARTUP_MARKS,
  type StartupMarkRecord,
  type StartupTimeline,
} from '../shared/startup-perf'

const MAX_MARKS = 256
const marks: StartupMarkRecord[] = []
const waiters = new Map<string, Array<() => void>>()
const perfEnabled = isStartupPerfEnabled()
let loopHistogram: IntervalHistogram | null = null

function push(record: StartupMarkRecord): void {
  marks.push(record)
  if (marks.length > MAX_MARKS) marks.splice(0, marks.length - MAX_MARKS)
  const pending = waiters.get(record.name)
  if (pending) {
    waiters.delete(record.name)
    for (const resolve of pending) resolve()
  }
}

/** Record a main-process mark (ms since process start). */
export function markStartup(name: string): void {
  try { performance.mark(name) } catch { /* User Timing optional */ }
  push({ name, atMs: performance.now(), source: 'main' })
}

/** Record a mark only the first time it happens. */
export function markStartupOnce(name: string): void {
  if (!hasStartupMark(name)) markStartup(name)
}

export function hasStartupMark(name: string): boolean {
  return marks.some(mark => mark.name === name)
}

/** Resolves when `name` is (or already was) recorded. */
export function whenStartupMark(name: string): Promise<void> {
  if (hasStartupMark(name)) return Promise.resolve()
  return new Promise((resolve) => {
    const list = waiters.get(name) ?? []
    list.push(resolve)
    waiters.set(name, list)
  })
}

/**
 * Record a renderer mark forwarded over IPC. `epochMs` is the renderer's
 * `performance.timeOrigin + performance.now()`; both processes share the wall
 * clock, so it maps onto the main timeline without a handshake.
 */
export function recordRendererMark(name: string, epochMs: number): void {
  if (!Number.isFinite(epochMs)) return
  const atMs = epochMs - performance.timeOrigin
  if (atMs < 0 || atMs > 24 * 60 * 60 * 1000) return
  push({ name, atMs, source: 'renderer' })
}

export function getStartupTimeline(): StartupTimeline {
  let eventLoopDelay: StartupTimeline['eventLoopDelay'] = null
  if (loopHistogram && loopHistogram.count > 0) {
    eventLoopDelay = {
      p50: loopHistogram.percentile(50) / 1e6,
      p99: loopHistogram.percentile(99) / 1e6,
      max: loopHistogram.max / 1e6,
    }
  }
  return {
    timeOriginEpochMs: performance.timeOrigin,
    platform: process.platform,
    marks: marks.map(mark => ({ ...mark })),
    eventLoopDelay,
  }
}

export function isMainPerfEnabled(): boolean {
  return perfEnabled
}

/**
 * With ROX_PERF=1: once the renderer reports first meaningful paint (or after
 * `timeoutMs`), log one compact timeline line and, when ROX_PERF_OUT is set,
 * write the full timeline JSON there (the startup bench reads it). No-op when
 * perf output is disabled.
 */
export function reportStartupTimelineWhenSettled(
  log: (line: string) => void,
  options: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): void {
  const env = options.env ?? process.env
  if (!isStartupPerfEnabled(env)) return
  let done = false
  const report = (reason: 'fmp' | 'timeout') => {
    if (done) return
    done = true
    const timeline = getStartupTimeline()
    log(`[perf] startup (${reason}) ${formatStartupTimeline(timeline)}`)
    const out = env.ROX_PERF_OUT?.trim()
    if (out) {
      try { writeFileSync(out, `${JSON.stringify(timeline, null, 2)}\n`, 'utf-8') }
      catch (error) { log(`[perf] failed to write ROX_PERF_OUT: ${error instanceof Error ? error.message : String(error)}`) }
    }
  }
  const timer = setTimeout(() => report('timeout'), options.timeoutMs ?? 30_000)
  timer.unref?.()
  void whenStartupMark(STARTUP_MARKS.rendererFirstMeaningfulPaint).then(() => {
    clearTimeout(timer)
    // One more turn so late marks in the same batch (e.g. skills sync start) land.
    setTimeout(() => report('fmp'), 50).unref?.()
  })
}

/** Test hook. */
export function resetStartupMarksForTests(): void {
  marks.length = 0
  waiters.clear()
}

// Bench/diagnostics hook: Playwright reads this via electronApp.evaluate().
;(globalThis as { __roxStartupPerf?: { timeline: () => StartupTimeline } }).__roxStartupPerf = {
  timeline: getStartupTimeline,
}

markStartup(STARTUP_MARKS.mainEntry)

if (perfEnabled) {
  try {
    loopHistogram = monitorEventLoopDelay({ resolution: 10 })
    loopHistogram.enable()
  } catch {
    loopHistogram = null
  }
}
