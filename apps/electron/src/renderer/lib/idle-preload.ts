/**
 * WP7 — idle preload of code split out of index.html's startup closure.
 *
 * Modules moved behind `React.lazy` to shrink startup JS (label date editor,
 * the inline Rox CLI credential step, OnboardingDialog, the workspace creation
 * screen) and every non-rail route chunk are loaded here after first paint,
 * one per idle callback, so a later first open waits for nothing. The rail
 * route chunks stay with the PERF-10 warm-up step that calls this.
 *
 * Each loader is the same dynamic import its `React.lazy` uses, so the module
 * cache serves both. Failures are logged and forgotten (the lazy retry wins).
 */
import { ROUTE_PAGE_NAMES, RAIL_SURFACE_ROUTES, preloadRoute } from '@/components/app-shell/route-pages'
import { loadLabelDateEditor } from '@/components/ui/label-date-editor-loader'
import { loadCloudRunsChip } from '@/components/cloud-runs/cloud-runs-chip-loader'

type Loader = () => Promise<unknown>

/** Lazy shell pieces split out of the startup closure, hottest first. */
export const STARTUP_SPLIT_LOADERS: ReadonlyArray<readonly [string, Loader]> = [
  ['label-date-editor', loadLabelDateEditor],
  ['cloud-runs-chip', loadCloudRunsChip],
  ['onboarding-dialog', () => import('@/components/app-shell/OnboardingDialog')],
  ['rox-cli-credential-step', () => import('@/components/onboarding/RoxCliCredentialStep')],
  ['workspace-creation-screen', () => import('@/components/workspace/WorkspaceCreationScreen')],
  ['file-preview-host', () => import('@/FilePreviewHost')],
  ['motion', () => import('@/lib/deferred-motion').then((m) => m.loadMotion())],
]

export interface IdlePreloadOptions {
  requestIdle?: (callback: () => void) => unknown
  log?: (message: string, error: unknown) => void
  /** Stop scheduling further loaders once aborted (an in-flight import still settles). */
  signal?: AbortSignal
  /** True while the user is interacting; the slot is re-queued instead of importing. */
  isUserBusy?: () => boolean
  /** Upper bound on consecutive re-queues per loader so preload cannot starve forever. */
  maxDeferrals?: number
}

/** Input within this window counts as "user busy". */
export const USER_INPUT_QUIET_MS = 300

let started = false
let controller: AbortController | null = null
let lastInputAt = Number.NEGATIVE_INFINITY
let inputTrackingInstalled = false

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function installInputTracking(): void {
  if (inputTrackingInstalled || typeof window === 'undefined') return
  inputTrackingInstalled = true
  const mark = () => { lastInputAt = now() }
  for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const) {
    window.addEventListener(type, mark, { capture: true, passive: true })
  }
}

function defaultIsUserBusy(): boolean {
  return now() - lastInputAt < USER_INPUT_QUIET_MS
}

/** Every loader this module runs in the background, in order. */
export function idlePreloadLoaders(): Array<readonly [string, Loader]> {
  const rail = new Set<string>(RAIL_SURFACE_ROUTES)
  return [
    ...STARTUP_SPLIT_LOADERS,
    ...ROUTE_PAGE_NAMES.filter(name => !rail.has(name)).map(name => [`route:${name}`, () => preloadRoute(name)] as const),
  ]
}

/**
 * Run `loaders` one at a time, each in its own idle callback, waiting for the
 * previous import to settle. Resolves when all are done.
 */
export async function runIdlePreload(
  loaders: ReadonlyArray<readonly [string, Loader]>,
  {
    requestIdle = defaultRequestIdle,
    log = (m, e) => console.warn(m, e),
    signal,
    isUserBusy = defaultIsUserBusy,
    maxDeferrals = 20,
  }: IdlePreloadOptions = {},
): Promise<void> {
  for (const [name, load] of loaders) {
    if (signal?.aborted) return
    let deferrals = 0
    for (;;) {
      await new Promise<void>(resolve => { requestIdle(resolve) })
      if (signal?.aborted) return
      if (deferrals >= maxDeferrals || !isUserBusy()) break
      deferrals++
    }
    try {
      await load()
    } catch (error) {
      log(`[idle-preload] ${name} failed`, error)
    }
  }
}

/** Start the background preload once per renderer. */
export function startIdlePreload(options?: IdlePreloadOptions): Promise<void> {
  if (started) return Promise.resolve()
  started = true
  installInputTracking()
  const run = new AbortController()
  controller = run
  const signal = options?.signal
  if (signal) {
    if (signal.aborted) run.abort()
    else signal.addEventListener('abort', () => run.abort(), { once: true })
  }
  return runIdlePreload(idlePreloadLoaders(), { ...options, signal: run.signal })
}

/**
 * Stop the background preload (e.g. on low memory or window teardown). A later
 * `startIdlePreload()` starts a fresh run; already-loaded chunks stay cached.
 */
export function cancelIdlePreload(): void {
  controller?.abort()
  controller = null
  started = false
}

/** Test hook. */
export function resetIdlePreloadForTests(): void {
  controller?.abort()
  controller = null
  started = false
  lastInputAt = Number.NEGATIVE_INFINITY
}

function defaultRequestIdle(callback: () => void): unknown {
  if (typeof requestIdleCallback === 'function') return requestIdleCallback(() => callback(), { timeout: 2000 })
  return setTimeout(callback, 50)
}
