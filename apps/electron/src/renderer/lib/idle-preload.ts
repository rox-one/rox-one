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
]

export interface IdlePreloadOptions {
  requestIdle?: (callback: () => void) => unknown
  log?: (message: string, error: unknown) => void
}

let started = false

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
  { requestIdle = defaultRequestIdle, log = (m, e) => console.warn(m, e) }: IdlePreloadOptions = {},
): Promise<void> {
  for (const [name, load] of loaders) {
    await new Promise<void>(resolve => { requestIdle(resolve) })
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
  return runIdlePreload(idlePreloadLoaders(), options)
}

/** Test hook. */
export function resetIdlePreloadForTests(): void {
  started = false
}

function defaultRequestIdle(callback: () => void): unknown {
  if (typeof requestIdleCallback === 'function') return requestIdleCallback(() => callback(), { timeout: 2000 })
  return setTimeout(callback, 50)
}
