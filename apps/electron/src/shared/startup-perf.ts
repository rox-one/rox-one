/**
 * Startup / navigation perf contract shared by main, preload, renderer and the
 * Electron startup bench (PERF-01). Pure data + helpers, no runtime deps.
 */

/** IPC channel the preload uses to forward renderer marks to main (fire-and-forget). */
export const STARTUP_PERF_MARK_CHANNEL = '__perf:mark'

/** Well-known marks. All times are milliseconds since the main process started. */
export const STARTUP_MARKS = {
  /** First line of the main bundle evaluated (module load + require cost before it). */
  mainEntry: 'main:entry',
  /** Every main-bundle module evaluated; login-shell env kicked off / applied from cache (macOS). */
  shellEnv: 'main:shell-env',
  /** `app.whenReady()` resolved. */
  appReady: 'main:app-ready',
  /** Windows toolchain bootstrap read (start/end). */
  winBootstrapStart: 'main:win-bootstrap:start',
  winBootstrapEnd: 'main:win-bootstrap:end',
  /** Embedded server listening and handlers registered. */
  serverReady: 'main:server-ready',
  /** First BrowserWindow constructed. */
  windowCreated: 'main:window-created',
  /** Preload received the WS port (first `__get-ws-port`). */
  wsPortHanded: 'main:ws-port-handed',
  /** Bundled skills background sync (PERF-02). */
  skillsSyncStart: 'main:skills-sync:start',
  skillsSyncEnd: 'main:skills-sync:end',
  /** The bundled-skills merge ran inline on the main thread (worker unavailable/failed). */
  skillsSyncInline: 'main:skills-sync:inline',
  /** Renderer bundle started executing. */
  rendererScriptStart: 'renderer:script-start',
  /** First frame after the first React commit. */
  rendererFirstPaint: 'renderer:first-paint',
  /** First frame with the session list visible (splash gate satisfied). */
  rendererFirstMeaningfulPaint: 'renderer:fmp',
} as const

export type StartupMarkName = (typeof STARTUP_MARKS)[keyof typeof STARTUP_MARKS]

/** Renderer-originated marks main accepts over IPC (bounded, no free text). */
export const RENDERER_MARK_PATTERN = /^(renderer|nav):[a-z0-9][a-z0-9:._-]{0,63}$/i

export function isValidRendererMarkName(name: unknown): name is string {
  return typeof name === 'string' && RENDERER_MARK_PATTERN.test(name)
}

/** Perf instrumentation output is enabled with ROX_PERF=1 (logging + nav forwarding). */
export function isStartupPerfEnabled(env: Record<string, string | undefined> = typeof process !== 'undefined' ? process.env : {}): boolean {
  return env.ROX_PERF === '1' || env.ROX_PERF === 'true'
}

export interface StartupMarkRecord {
  name: string
  /** Milliseconds since main-process start (performance.timeOrigin of main). */
  atMs: number
  source: 'main' | 'renderer'
}

export interface StartupTimeline {
  /** Epoch ms of main-process start. */
  timeOriginEpochMs: number
  platform: string
  marks: StartupMarkRecord[]
  /** Main event-loop delay while booting (ms), when ROX_PERF is on. */
  eventLoopDelay?: { p50: number; p99: number; max: number } | null
}

/**
 * Startup budgets from PERF-AUDIT §3.1 (reference hardware). `ciMultiplier`
 * relaxes them for shared CI runners / xvfb; the bench is report-only until
 * P2 (shell-first boot) lands.
 */
export const STARTUP_BUDGETS = {
  windowCreatedMs: { darwin: 300, win32: 500, linux: 500 },
  firstMeaningfulPaintMs: { darwin: 800, win32: 1500, linux: 1500 },
  ciMultiplier: 4,
} as const

export function startupBudgetFor(metric: 'windowCreatedMs' | 'firstMeaningfulPaintMs', platform: string, ci = false): number {
  const table = STARTUP_BUDGETS[metric] as Record<string, number>
  const base = table[platform] ?? table.linux!
  return ci ? base * STARTUP_BUDGETS.ciMultiplier : base
}

/** Compact one-line timeline, e.g. `entry=42 app-ready=180 window-created=640 fmp=1210`. */
export function formatStartupTimeline(timeline: StartupTimeline): string {
  const seen = new Set<string>()
  const parts: string[] = []
  for (const mark of [...timeline.marks].sort((a, b) => a.atMs - b.atMs)) {
    if (mark.name.startsWith('nav:') || seen.has(mark.name)) continue
    seen.add(mark.name)
    parts.push(`${mark.name.replace(/^(main|renderer):/, '')}=${Math.round(mark.atMs)}`)
  }
  const loop = timeline.eventLoopDelay
  if (loop) parts.push(`loop-p99=${loop.p99.toFixed(0)} loop-max=${loop.max.toFixed(0)}`)
  return parts.join(' ')
}
