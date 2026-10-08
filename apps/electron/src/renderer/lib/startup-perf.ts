/**
 * Renderer startup + navigation marks (PERF-01).
 *
 * - `renderer:script-start` when this module evaluates (import it first in main.tsx),
 * - `renderer:first-paint` one frame after the first React commit,
 * - `renderer:fmp` one frame after the session list is ready (splash gate),
 * - route switches: `startRouteSwitch()` in navigate → `endRouteSwitch()` once
 *   MainContentPanel committed the new route and a frame was produced.
 *
 * Startup marks are always forwarded to main (3 tiny IPC messages per launch)
 * so the main timeline is complete; per-navigation marks are forwarded only
 * with ROX_PERF=1. `window.__roxPerf.dump()` exposes everything for the bench
 * and DevTools. Route names are reduced to the navigator kind — never ids.
 *
 * User Timing entries (`performance.mark/measure`) are created only when perf
 * is enabled (ROX_PERF=1): the browser's performance buffer is unbounded, so
 * recording one entry per navigation in a long-lived window would grow it
 * forever. The internal rings above are bounded (200) and always on.
 */
import { STARTUP_MARKS, isValidRendererMarkName } from '../../shared/startup-perf'

interface StartupPerfBridge {
  enabled?: boolean
  mark?: (name: string, epochMs: number) => void
}

interface RendererMarkRecord { name: string; atMs: number }
interface RouteSwitchRecord { surface: string; durationMs: number; atMs: number }

const MAX_RECORDS = 200
const marks: RendererMarkRecord[] = []
const routeSwitches: RouteSwitchRecord[] = []
let pendingRoute: { target: string; startedAt: number; token: number } | null = null
let routeToken = 0

function bridge(): StartupPerfBridge | undefined {
  return typeof window === 'undefined' ? undefined : (window as unknown as { roxStartupPerf?: StartupPerfBridge }).roxStartupPerf
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function epochNow(): number {
  return typeof performance !== 'undefined' && Number.isFinite(performance.timeOrigin)
    ? performance.timeOrigin + performance.now()
    : Date.now()
}

/** Run `fn` after the next frame has been produced (rAF → macrotask). */
function afterNextPaint(fn: () => void): void {
  if (typeof requestAnimationFrame !== 'function') {
    setTimeout(fn, 0)
    return
  }
  requestAnimationFrame(() => setTimeout(fn, 0))
}

function push<T>(list: T[], item: T): void {
  list.push(item)
  if (list.length > MAX_RECORDS) list.splice(0, list.length - MAX_RECORDS)
}

export function isRendererStartupPerfEnabled(): boolean {
  return bridge()?.enabled === true
}

/** Run a User Timing call only when perf is enabled (keeps the browser buffer empty otherwise). */
function userTiming(fn: () => void): void {
  if (!isRendererStartupPerfEnabled() || typeof performance === 'undefined') return
  try { fn() } catch { /* User Timing optional */ }
}

/** Record a renderer mark and (optionally) forward it to the main timeline. */
export function markRenderer(name: string, forward = true): void {
  if (!isValidRendererMarkName(name)) return
  userTiming(() => performance.mark(name))
  push(marks, { name, atMs: now() })
  if (forward) {
    try { bridge()?.mark?.(name, epochNow()) } catch { /* bridge optional (tests, web) */ }
  }
}

export function markRendererOnce(name: string): void {
  if (!marks.some(mark => mark.name === name)) markRenderer(name)
}

/** Call right after the first `root.render(...)`. */
export function markFirstPaintAfterCommit(): void {
  afterNextPaint(() => markRendererOnce(STARTUP_MARKS.rendererFirstPaint))
}

/** Call when the session list is ready and the main UI is rendered. Idempotent. */
export function markFirstMeaningfulPaint(): void {
  if (marks.some(mark => mark.name === STARTUP_MARKS.rendererFirstMeaningfulPaint)) return
  afterNextPaint(() => markRendererOnce(STARTUP_MARKS.rendererFirstMeaningfulPaint))
}

function surfaceName(value: string): string {
  const head = value.split(/[/?#]/, 1)[0] ?? ''
  const cleaned = head.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 32)
  return cleaned || 'unknown'
}

/** Navigation intent (call at the top of navigate()). */
export function startRouteSwitch(route: string): void {
  const target = surfaceName(route)
  pendingRoute = { target, startedAt: now(), token: ++routeToken }
  userTiming(() => performance.mark(`nav:start:${target}`))
}

/** The new route committed (call from the main content panel effect). */
export function endRouteSwitch(navigator: string): void {
  const pending = pendingRoute
  if (!pending) return
  pendingRoute = null
  const surface = surfaceName(navigator)
  afterNextPaint(() => {
    const durationMs = now() - pending.startedAt
    push(routeSwitches, { surface, durationMs, atMs: now() })
    userTiming(() => {
      performance.mark(`nav:painted:${surface}`)
      performance.measure(`nav:${surface}`, { start: pending.startedAt, duration: durationMs })
    })
    if (isRendererStartupPerfEnabled()) markRenderer(`nav:${surface}:painted`)
  })
}

export interface RendererPerfDump {
  timeOriginEpochMs: number
  marks: RendererMarkRecord[]
  routeSwitches: RouteSwitchRecord[]
}

export function dumpRendererPerf(): RendererPerfDump {
  return {
    timeOriginEpochMs: typeof performance !== 'undefined' ? performance.timeOrigin : 0,
    marks: marks.map(mark => ({ ...mark })),
    routeSwitches: routeSwitches.map(entry => ({ ...entry })),
  }
}

/** Test hook. */
export function resetRendererStartupPerfForTests(): void {
  marks.length = 0
  routeSwitches.length = 0
  pendingRoute = null
}

if (typeof window !== 'undefined') {
  const target = window as unknown as { __roxPerf?: { dump: () => RendererPerfDump } }
  target.__roxPerf = { ...(target.__roxPerf ?? {}), dump: dumpRendererPerf }
}

markRenderer(STARTUP_MARKS.rendererScriptStart)
