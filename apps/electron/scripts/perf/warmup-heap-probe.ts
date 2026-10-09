#!/usr/bin/env bun
/**
 * PERF-10 (#1577) — packaged warm-up probe: heap, idle CPU, long tasks.
 *
 * The unit tests and the model (`renderer/perf/surface-sim.ts`) verify the
 * warm-up contract structurally, but the `≤ 25 MB` acceptance needs a
 * **packaged** Electron run (`docs/perf/PERF-10-keepalive-surfaces.md`,
 * "Warm-up ≤ 25 MB — not verified here"). This probe takes that measurement and
 * is report-only: the CI job (`perf-budgets.yml`, `warmup-probe`) has
 * `continue-on-error: true` and only archives the JSON.
 *
 * 1. Launches the built app the way `startup-bench.ts` does — Playwright's
 *    Electron driver against `dist/main.cjs` with an isolated profile and
 *    `ROX_PERF=1`. That driver reaches the app over its DevTools protocol, so
 *    every renderer read below is a CDP `Runtime.evaluate` call on the same
 *    inspector session, and the heap uses the raw session
 *    (`HeapProfiler.collectGarbage` → `Runtime.getHeapUsage`). `electron`
 *    resolves from `apps/electron/node_modules`, `@playwright/test` from the
 *    repo root.
 * 2. Installs a `longtask` `PerformanceObserver` (`buffered: true`, so tasks
 *    recorded before the install are delivered too) and takes the baseline
 *    heap as soon as a window answers.
 * 3. Waits for `window.__roxWarmup()` (the `shell-warmup.ts` diagnostics hook)
 *    to report a terminal queue state, then reads the heap again, the queue
 *    timeline (`window.__roxPerf.dump()`) and the mounted keep-alive panes.
 * 4. Prints **one** JSON document to stdout and writes it to `--out <path>`.
 *    Exit 0 only when the measurement succeeded (`probeOk`); a missing build, a
 *    renderer that never answers, or a queue that never settles exits 1 with
 *    the reason on stderr.
 *
 * Boundaries kept explicit in `note`: the heap is the renderer's V8 JS heap
 * (`usedSize`) with a forced GC before each reading — DOM/C++ memory and the
 * main process are not included; `longTasks` covers the renderer of the
 * measured window from the observer install onwards.
 *
 *   bun run electron:build && bun run perf:warmup-probe -- --out warmup-probe.json
 *   (Linux: wrap in `xvfb-run -a`.)
 */
import { _electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { RendererPerfDump } from '../../src/renderer/lib/startup-perf'
import { WARMUP_CPU_BUDGET_MS, type WarmupStatus } from '../../src/renderer/lib/warmup'

declare global {
  interface Performance {
    /** Chromium-only, absent from `lib.dom`: coarse JS heap info (precise with `--enable-precise-memory-info`). */
    memory?: { usedJSHeapSize?: number; totalJSHeapSize?: number; jsHeapSizeLimit?: number }
  }
  interface Window {
    /** `shell-warmup.ts` diagnostics hook (PERF-10); null until a queue exists. */
    __roxWarmup?: () => WarmupStatus | null
    /** State of the observer this probe installs. */
    __roxWarmupProbe?: WarmupProbeGlobal
    /** `startup-perf.ts` dump hook (PERF-01). */
    __roxPerf?: { dump?: () => RendererPerfDump }
  }
}

/** `Warm-up ≤ 25 MB` (docs/perf/PERF-10-keepalive-surfaces.md). */
export const WARMUP_HEAP_BUDGET_MB = 25
/** `no long task > 50 ms` — the acceptance bound the 4 ms idle slices exist for. */
export const WARMUP_LONG_TASK_MS = 50
/** A renderer without the diagnostics hook after this long is a stale build. */
const HOOK_GRACE_MS = 30_000
const BYTES_PER_MB = 1024 * 1024

interface ProbeArgs { main: string; out: string | null; timeoutMs: number; attempts: number; profile: string | null }

export type HeapSource = 'cdp' | 'performance.memory'

interface HeapReading { usedBytes: number; totalBytes: number }

interface HeapSample { reading: HeapReading | null; source: HeapSource | null }

/** The renderer global the long-task observer fills (see `installLongTaskObserver`). */
interface WarmupProbeGlobal {
  tasks: LongTaskEntry[]
  observedFromMs: number | null
  installs: number
  supported: boolean
}

export interface LongTaskEntry { startMs: number; durationMs: number }

export interface LongTaskSummary {
  count: number
  over50Ms: number
  longestMs: number
  observedFromMs: number | null
  /** > 1 means the document was re-created (or the observer re-installed): entries may be incomplete. */
  installs: number
}

/** Everything one renderer read returns; one round-trip per poll per window. */
interface RendererSnapshot {
  /** `window.__roxWarmup` exists in this build (false = stale build). */
  hookPresent: boolean
  warmup: WarmupStatus | null
  timeline: RendererPerfDump | null
  longTasks: WarmupProbeGlobal | null
  retainedSurfaces: number | null
}

export interface ProbeJson {
  launched: boolean
  cpuMs: number | null
  longestSliceMs: number | null
  heapDeltaMb: number | null
  retainedSurfaces: number | null
  longTasks: LongTaskSummary | null
  probeOk: boolean
  note: string
  platform: string
  heapSource: HeapSource | null
  heapBaselineMb: number | null
  heapFinalMb: number | null
  heapBaselineAtMs: number | null
  attempt: number
  warmup: WarmupStatus | null
  timeline: RendererPerfDump | null
}

export interface NoteInput {
  warmup: WarmupStatus | null
  hookPresent: boolean
  heapDeltaMb: number | null
  heapSource: HeapSource | null
  heapBaselineMb: number | null
  heapBaselineAtMs: number | null
  longTasks: LongTaskSummary | null
  retainedSurfaces: number | null
  waitMs: number
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/** Renderer JS-heap growth, in MB, rounded to 0.1. Null when either reading is missing. */
export function heapDeltaMb(baselineBytes: number | null, finalBytes: number | null): number | null {
  if (baselineBytes === null || finalBytes === null) return null
  if (!Number.isFinite(baselineBytes) || !Number.isFinite(finalBytes)) return null
  return round1((finalBytes - baselineBytes) / BYTES_PER_MB)
}

/** Fold the observer's raw entries into the criterion's shape; null when `longtask` is unsupported. */
export function summarizeLongTasks(input: {
  tasks: readonly LongTaskEntry[]
  observedFromMs: number | null
  installs: number
  supported: boolean
}): LongTaskSummary | null {
  if (!input.supported) return null
  let longest = 0
  let over = 0
  for (const task of input.tasks) {
    longest = Math.max(longest, task.durationMs)
    if (task.durationMs > WARMUP_LONG_TASK_MS) over += 1
  }
  return {
    count: input.tasks.length,
    over50Ms: over,
    longestMs: round1(longest),
    observedFromMs: input.observedFromMs === null ? null : Math.round(input.observedFromMs),
    installs: input.installs,
  }
}

/** One line with every acceptance number and the boundary it was measured under. */
export function buildNote(input: NoteInput): string {
  const parts: string[] = []
  const status = input.warmup
  if (!status) {
    parts.push(input.hookPresent
      ? 'warm-up queue never installed (window.__roxWarmup() stayed null)'
      : 'built renderer has no window.__roxWarmup — rebuild with `bun run electron:build`')
  } else {
    const total = status.completed.length + status.failed.length + status.pending.length
    parts.push(`queue ${status.completed.length}/${total} steps`
      + `${status.failed.length > 0 ? ` (failed: ${status.failed.join(',')})` : ''}`
      + `${status.cancelledBy ? `, cancelled by ${status.cancelledBy}` : ''}${status.running ? ', still running' : ''}`)
    parts.push(`cpu ${Math.round(status.spentMs)} ms of ${WARMUP_CPU_BUDGET_MS} ms`)
    parts.push(`longest slice ${round1(status.longestSliceMs)} ms of ${WARMUP_LONG_TASK_MS} ms`)
  }
  parts.push(input.heapDeltaMb === null
    ? `heap delta unavailable (${input.heapSource ?? 'no CDP session and no performance.memory'})`
    : `heap ${input.heapDeltaMb >= 0 ? '+' : ''}${input.heapDeltaMb} MB of ${WARMUP_HEAP_BUDGET_MB} MB`
      + ` (baseline ${input.heapBaselineMb} MB at ${input.heapBaselineAtMs} ms, `
      + `${input.heapSource === 'cdp' ? 'V8 usedSize after forced GC' : 'performance.memory, not GC-forced'};`
      + ' DOM and main-process memory not counted)')
  parts.push(input.longTasks === null
    ? 'long tasks not observed (PerformanceObserver longtask unavailable)'
    : `${input.longTasks.over50Ms} long task(s) > ${WARMUP_LONG_TASK_MS} ms (${input.longTasks.count} observed,`
      + ` longest ${input.longTasks.longestMs} ms from ${input.longTasks.observedFromMs} ms`
      + `${input.longTasks.installs > 1 ? `, ${input.longTasks.installs} observer installs — entries may be partial` : ''})`)
  parts.push(input.retainedSurfaces === null
    ? 'retained surfaces not read'
    : `${input.retainedSurfaces} retained surface pane(s) mounted`)
  parts.push(`waited ${Math.round(input.waitMs)} ms`)
  return parts.join('; ')
}

function parseArgs(argv: string[]): ProbeArgs {
  const value = (flag: string) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] ?? null : null }
  const repo = resolve(import.meta.dir, '../../../..')
  return {
    main: resolve(value('--main') ?? join(repo, 'apps/electron/dist/main.cjs')),
    out: value('--out'),
    timeoutMs: Math.max(1_000, Number(value('--timeout') ?? 90_000)),
    attempts: Math.max(1, Number(value('--attempts') ?? 2)),
    profile: value('--profile'),
  }
}

/**
 * Isolated profile, same shape as `startup-bench.ts` (which keeps its own copy;
 * that bench is intentionally left untouched here). A reused `--profile` is what
 * makes the second attempt a warm launch with a real workspace.
 */
function isolatedEnv(profile: string): Record<string, string> {
  for (const child of ['home', 'config', 'userData', 'tmp', 'appData', 'localAppData']) mkdirSync(join(profile, child), { recursive: true })
  const env: Record<string, string> = {}
  for (const name of ['PATH', 'SystemRoot', 'WINDIR', 'DISPLAY', 'XAUTHORITY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'SHELL']) {
    const value = process.env[name]
    if (value) env[name] = value
  }
  return Object.assign(env, {
    HOME: join(profile, 'home'), USERPROFILE: join(profile, 'home'),
    ROX_CONFIG_DIR: join(profile, 'config'), CRAFT_CONFIG_DIR: join(profile, 'config'),
    ROX_USER_DATA_DIR: join(profile, 'userData'), CRAFT_USER_DATA_DIR: join(profile, 'userData'),
    TMPDIR: join(profile, 'tmp'), TMP: join(profile, 'tmp'), TEMP: join(profile, 'tmp'),
    APPDATA: join(profile, 'appData'), LOCALAPPDATA: join(profile, 'localAppData'),
    CRAFT_INSTANCE_NUMBER: `warmup-probe-${process.pid}`,
    ROX_DEV_DISABLE_PROTOCOL_REGISTRATION: '1',
    ROX_SKIP_PROTOCOL_REGISTRATION: '1',
    ROX_PERF: '1',
    ROX_PERF_OUT: join(profile, 'warmup-probe-startup.json'),
    NODE_ENV: 'production',
  })
}

/**
 * Runs in the renderer, so it must stay self-contained (Playwright serializes
 * the function). Registered as an init script too, so a re-created document
 * installs the observer again.
 */
function installLongTaskObserver(): { supported: boolean; observedFromMs: number | null; installs: number } {
  const state: WarmupProbeGlobal = window.__roxWarmupProbe ?? { tasks: [], observedFromMs: null, installs: 0, supported: false }
  window.__roxWarmupProbe = state
  if (state.supported) return { supported: true, observedFromMs: state.observedFromMs, installs: state.installs }
  if (typeof PerformanceObserver !== 'function') return { supported: false, observedFromMs: null, installs: state.installs }
  try {
    const observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        if (entry.entryType !== 'longtask') continue
        state.tasks.push({ startMs: entry.startTime, durationMs: entry.duration })
      }
    })
    // `buffered: true` also delivers long tasks recorded before this install.
    observer.observe({ type: 'longtask', buffered: true })
  } catch {
    return { supported: false, observedFromMs: null, installs: state.installs }
  }
  state.supported = true
  state.installs += 1
  state.observedFromMs = performance.now()
  return { supported: true, observedFromMs: state.observedFromMs, installs: state.installs }
}

/** One renderer read: warm-up status, timeline, long tasks and mounted keep-alive panes. */
function readRendererSnapshot(page: Page): Promise<RendererSnapshot> {
  return page.evaluate(() => {
    const warmupHook = window.__roxWarmup
    const dumpHook = window.__roxPerf
    return {
      hookPresent: typeof warmupHook === 'function',
      warmup: typeof warmupHook === 'function' ? warmupHook() : null,
      timeline: typeof dumpHook?.dump === 'function' ? dumpHook.dump() : null,
      longTasks: window.__roxWarmupProbe ?? null,
      retainedSurfaces: typeof document === 'undefined' ? null : document.querySelectorAll('[data-surface-retained="true"]').length,
    }
  })
}

function readHeapUsage(value: unknown): HeapReading | null {
  if (typeof value !== 'object' || value === null || !('usedSize' in value)) return null
  const used = value.usedSize
  if (typeof used !== 'number' || !Number.isFinite(used)) return null
  const total = 'totalSize' in value && typeof value.totalSize === 'number' && Number.isFinite(value.totalSize) ? value.totalSize : used
  return { usedBytes: used, totalBytes: total }
}

/**
 * Heap after a forced GC through the renderer's inspector session; when Electron
 * has no CDP session for the page, the renderer's own `performance.memory`.
 */
async function sampleHeap(page: Page): Promise<HeapSample> {
  const context = page.context()
  if ('newCDPSession' in context) {
    try {
      const session = await context.newCDPSession(page)
      await session.send('HeapProfiler.collectGarbage')
      const reading = readHeapUsage(await session.send('Runtime.getHeapUsage'))
      if (reading) return { reading, source: 'cdp' }
    } catch {
      // No inspector session for this target: fall through to performance.memory.
    }
  }
  try {
    const usedBytes = await page.evaluate(() => {
      const used = performance.memory?.usedJSHeapSize
      return typeof used === 'number' && Number.isFinite(used) ? used : null
    })
    if (usedBytes !== null) return { reading: { usedBytes, totalBytes: usedBytes }, source: 'performance.memory' }
  } catch {
    // Window gone: report the missing reading honestly.
  }
  return { reading: null, source: null }
}

interface Baseline { reading: HeapReading | null; source: HeapSource | null; atMs: number }

/**
 * A probe that could not finish: the JSON still carries everything observed
 * (partial queue/cpu/long-task readings) with `probeOk: false` and the reason in
 * `note`. `heapDeltaMb` stays null — a mid-flight delta is not the criterion.
 */
function partialProbe(note: string, attempt: number, launched: boolean, warmup: WarmupStatus | null, snapshot: RendererSnapshot | null): ProbeJson {
  const observed = snapshot?.longTasks
  return {
    launched,
    cpuMs: warmup ? round1(warmup.spentMs) : null,
    longestSliceMs: warmup ? round1(warmup.longestSliceMs) : null,
    heapDeltaMb: null,
    retainedSurfaces: snapshot?.retainedSurfaces ?? null,
    longTasks: observed
      ? summarizeLongTasks({ tasks: observed.tasks, observedFromMs: observed.observedFromMs, installs: observed.installs, supported: observed.supported })
      : null,
    probeOk: false,
    note,
    platform: process.platform,
    heapSource: null,
    heapBaselineMb: null,
    heapFinalMb: null,
    heapBaselineAtMs: null,
    attempt,
    warmup,
    timeline: snapshot?.timeline ?? null,
  }
}

async function launchAttempt(args: ProbeArgs, profile: string, attemptNumber: number): Promise<ProbeJson> {
  const launchArgs = process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu', args.main] : [args.main]
  const started = performance.now()
  const baselines = new Map<Page, Baseline>()
  const observerRegistered = new Set<Page>()
  let app: ElectronApplication | null = null
  try {
    // Hoisted workspace: `electron` resolves from the repo root, like `startup-bench.ts`.
    const executablePath: string = createRequire(import.meta.url)('electron')
    app = await _electron.launch({ executablePath, args: launchArgs, cwd: dirname(dirname(args.main)), env: isolatedEnv(profile), timeout: args.timeoutMs })
    await app.firstWindow({ timeout: args.timeoutMs })
    const deadline = Date.now() + args.timeoutMs
    const hookDeadline = Date.now() + HOOK_GRACE_MS
    let hookSeen = false
    let lastStatus: WarmupStatus | null = null
    let lastSnapshot: RendererSnapshot | null = null
    let measured: Page | null = null
    let status: WarmupStatus | null = null
    let terminal: RendererSnapshot | null = null
    while (Date.now() < deadline) {
      for (const page of app.windows()) {
        if (page.isClosed()) continue
        try {
          if (!observerRegistered.has(page)) {
            await page.addInitScript(installLongTaskObserver)
            observerRegistered.add(page)
          }
          let snapshot = await readRendererSnapshot(page)
          if (snapshot.longTasks === null) {
            await page.evaluate(installLongTaskObserver)
            snapshot = await readRendererSnapshot(page)
          }
          if (!baselines.has(page)) {
            const sample = await sampleHeap(page)
            baselines.set(page, { reading: sample.reading, source: sample.source, atMs: Math.round(performance.now() - started) })
          }
          if (snapshot.hookPresent) hookSeen = true
          if (snapshot.warmup) { lastStatus = snapshot.warmup; lastSnapshot = snapshot }
          if (snapshot.warmup && !snapshot.warmup.running) { measured = page; status = snapshot.warmup; terminal = snapshot }
        } catch {
          // Navigation or a closed window: the next poll reads the surviving one.
        }
      }
      if (measured) break
      // A renderer that never exposes the hook is a stale build: no point in
      // waiting out the full timeout for a queue that cannot be reported.
      if (!hookSeen && Date.now() > hookDeadline) break
      await new Promise<void>(resolveSleep => setTimeout(resolveSleep, 250))
    }
    const waitMs = performance.now() - started
    if (!measured || !status || !terminal) {
      return partialProbe(buildNote({
        warmup: lastStatus, hookPresent: hookSeen, heapDeltaMb: null, heapSource: null, heapBaselineMb: null,
        heapBaselineAtMs: null, longTasks: null, retainedSurfaces: null, waitMs,
      }), attemptNumber, true, lastStatus, lastSnapshot)
    }
    const baseline = baselines.get(measured) ?? null
    const finalSample = await sampleHeap(measured)
    const longTasks = terminal.longTasks
      ? summarizeLongTasks({ tasks: terminal.longTasks.tasks, observedFromMs: terminal.longTasks.observedFromMs, installs: terminal.longTasks.installs, supported: terminal.longTasks.supported })
      : null
    const delta = heapDeltaMb(baseline?.reading?.usedBytes ?? null, finalSample.reading?.usedBytes ?? null)
    const heapSource = delta === null ? null : (baseline?.source ?? finalSample.source)
    const heapBaselineMb = baseline?.reading ? round1(baseline.reading.usedBytes / BYTES_PER_MB) : null
    return {
      launched: true,
      cpuMs: round1(status.spentMs),
      longestSliceMs: round1(status.longestSliceMs),
      heapDeltaMb: delta,
      retainedSurfaces: terminal.retainedSurfaces,
      longTasks,
      probeOk: delta !== null,
      note: buildNote({
        warmup: status, hookPresent: true, heapDeltaMb: delta, heapSource, heapBaselineMb,
        heapBaselineAtMs: baseline ? baseline.atMs : null, longTasks, retainedSurfaces: terminal.retainedSurfaces, waitMs,
      }),
      platform: process.platform,
      heapSource,
      heapBaselineMb,
      heapFinalMb: finalSample.reading ? round1(finalSample.reading.usedBytes / BYTES_PER_MB) : null,
      heapBaselineAtMs: baseline ? baseline.atMs : null,
      attempt: attemptNumber,
      warmup: status,
      timeline: terminal.timeline,
    }
  } catch (error) {
    return partialProbe(error instanceof Error ? error.message : String(error), attemptNumber, app !== null, null, null)
  } finally {
    await app?.close().catch(() => undefined)
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (!existsSync(args.main)) {
    console.error(`[perf:warmup-probe] built entry not found: ${args.main}\nRun \`bun run electron:build\` first — the probe measures the packaged app, not the dev server.`)
    process.exit(1)
  }
  const profile = args.profile ?? mkdtempSync(join(tmpdir(), 'rox-warmup-probe-'))
  let result = partialProbe('the probe produced no attempt', 0, false, null, null)
  try {
    for (let attempt = 1; attempt <= args.attempts; attempt++) {
      result = await launchAttempt(args, profile, attempt)
      if (result.probeOk) break
      console.error(`[perf:warmup-probe] attempt ${attempt}: ${result.note}`)
      if (attempt < args.attempts) console.error('[perf:warmup-probe] retrying on the same profile (a first-run profile has no workspace to warm)')
    }
  } finally {
    if (!args.profile) rmSync(profile, { recursive: true, force: true })
  }
  console.log(JSON.stringify(result))
  if (args.out) writeFileSync(args.out, `${JSON.stringify(result, null, 2)}\n`)
  if (!result.probeOk) {
    console.error(`[perf:warmup-probe] measurement incomplete: ${result.note}`)
    process.exit(1)
  }
}

if (import.meta.main) await main()