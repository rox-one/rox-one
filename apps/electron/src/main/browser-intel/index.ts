/**
 * Browser Intelligence runtime for the Electron main process.
 *
 * The pipeline is heavy (profile scanning, Hindsight, unfurl) and entirely
 * optional, so nothing here may block app startup: consent is read once, the
 * first run is scheduled on a timer, and every run is fire-and-forget with its
 * errors routed to the app logger.
 *
 * The unfurl stage runs in a Worker Thread (see ./worker.ts) because URL
 * decoding is CPU-bound; everything else runs in-process. Module-level state is
 * deliberate: this is the process singleton the IPC handlers read, and the
 * agent prompt provider registered with `setCognitiveProfileProvider` pulls the
 * cached block through it.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { setCognitiveProfileProvider } from '@rox/shared/agent/cognitive-profile'
import {
  IntelligenceStore,
  clearCognitiveProfileCache,
  defaultBrowserIntelState,
  readBrowserIntelState,
  readCognitiveProfileCache,
  recordBrowserIntelRun,
  resolveBrowserIntelPaths,
  runIntelligencePipeline,
  setBrowserIntelConsent,
  startUnfurlWorker,
} from '@rox/browser-intel'
import type {
  BrowserIntelPaths,
  BrowserIntelState,
  IntelligenceStats,
  PipelineDeps,
  PipelineProgress,
  ProfileSlotRecord,
  UnfurlBatchOutcome,
  UnfurlWorkerOptions,
} from '@rox/browser-intel'

/** Bundled next to `dist/main.cjs` by `build:main-worker`. */
export const BROWSER_INTEL_WORKER_BASENAME = 'browser-intel-worker.cjs'

/** Mirror of `browser-cookie-auto-import.ts`: first run well after the UI is up. */
const STARTUP_DELAY_MS = 30_000
const INTERVAL_MS = 6 * 60 * 60_000

/** Node/Electron timers; `.unref()` keeps the loop from being held open. */
type TimerHandle = NodeJS.Timeout

export type BrowserIntelEvent =
  | { type: 'progress'; progress: PipelineProgress }
  | { type: 'state'; state: BrowserIntelState }

type BrowserIntelEventListener = (event: BrowserIntelEvent) => void

let paths: BrowserIntelPaths | null = null
let running = false
let abortController: AbortController | null = null
let startupTimer: TimerHandle | null = null
let intervalTimer: TimerHandle | null = null
/** Deferred-first-run delay; shortened by `__setStartupDelayForTests`. */
let startupDelayMs = STARTUP_DELAY_MS
/** Test seam: built worker bundle path; `null` uses the dist sibling. */
let workerEntryOverride: string | null = null
const listeners = new Set<BrowserIntelEventListener>()

/**
 * Test seam: replaces the heavy pipeline stages so a run can be driven without
 * touching real browsers. `null` restores the production stages.
 */
let testDeps: PipelineDeps | null = null

export function __setPipelineDepsForTests(deps: PipelineDeps | null): void {
  testDeps = deps
}

/** Test seam: shortens the deferred first run (`null` restores the default). */
export function __setStartupDelayForTests(ms: number | null): void {
  startupDelayMs = ms ?? STARTUP_DELAY_MS
}

/** Test seam: overrides the built worker bundle path (`null` restores the dist sibling). */
export function __setUnfurlWorkerEntryForTests(entryPath: string | null): void {
  workerEntryOverride = entryPath
}

function ensurePaths(): BrowserIntelPaths {
  paths ??= resolveBrowserIntelPaths()
  return paths
}

/**
 * Route diagnostics to the app logger through a runtime-selected module: the
 * runtime is imported by tests where `electron-log` has no Electron to bind to,
 * so a static import would break module loading outside the app.
 */
async function logToApp(level: 'warn' | 'error', message: string, detail?: unknown): Promise<void> {
  try {
    const mod = await import('../logger')
    mod.mainLog[level](`[browser-intel] ${message}`, detail)
  } catch {
    // No Electron logger (tests, plain node): the diagnostic is dropped.
  }
}

function logWarn(message: string, detail?: unknown): void {
  void logToApp('warn', message, detail)
}

function logError(message: string, detail?: unknown): void {
  void logToApp('error', message, detail)
}

function emit(event: BrowserIntelEvent): void {
  for (const listener of listeners) {
    try {
      listener(event)
    } catch (error) {
      logWarn('event listener threw', error)
    }
  }
}

function readState(): BrowserIntelState {
  try {
    return readBrowserIntelState(ensurePaths().configDir)
  } catch (error) {
    logWarn('failed to read the persisted state', error)
    return defaultBrowserIntelState()
  }
}

/**
 * Spawn the unfurl Worker Thread, forward its progress and resolve with the
 * final outcome. The Worker is always terminated, even when it fails.
 *
 * The pipeline hands an in-process runner its open store as part of `options`;
 * that live `DatabaseSync` handle must never reach `workerData` (structured
 * clone throws `DataCloneError`), so only {@link startUnfurlWorker}'s
 * whitelisted knobs survive the trip below.
 */
async function runUnfurlViaWorker(options: UnfurlWorkerOptions & { dbPath: string }): Promise<UnfurlBatchOutcome> {
  const { dbPath, ...workerOptions } = options
  const entryPath = workerEntryOverride ?? join(__dirname, BROWSER_INTEL_WORKER_BASENAME)
  const signal = options.signal ?? abortController?.signal

  const { promise, resolve, reject } = Promise.withResolvers<UnfurlBatchOutcome>()
  const worker = startUnfurlWorker({
    entryPath,
    dbPath,
    options: {
      ...workerOptions,
      signal,
      onProgress: options.onProgress,
      onDone: (outcome) => resolve(outcome),
      onError: (message) => reject(new Error(message || 'unfurl worker failed')),
    },
  })
  worker.once('error', (error) => reject(error))
  worker.once('exit', (code) => {
    // A clean exit only happens after `done`; every earlier exit is a failure.
    if (code !== 0) reject(new Error(`unfurl worker exited with code ${code}`))
  })

  try {
    return await promise
  } finally {
    try {
      await worker.terminate()
    } catch (error) {
      logWarn('failed to terminate the unfurl worker', error)
    }
  }
}

/**
 * Read an optional snapshot through a short-lived read-only store.
 *
 * The database may not exist yet (feature off, no run ever completed), so an
 * absent file and any open error both yield the caller's fallback instead of
 * throwing into an IPC handler.
 */
function readSnapshot<T>(read: (store: IntelligenceStore, dbPath: string) => T, fallback: T): T {
  const resolved = ensurePaths()
  if (!existsSync(resolved.dbPath)) return fallback
  let store: IntelligenceStore | null = null
  try {
    store = new IntelligenceStore(resolved.dbPath, { readOnly: true, skipSchema: true })
    return read(store, resolved.dbPath)
  } catch (error) {
    logWarn('read-only snapshot failed', error)
    return fallback
  } finally {
    try {
      store?.close()
    } catch (error) {
      logWarn('failed to close the snapshot store', error)
    }
  }
}

/**
 * Arm the deferred first run and the recurring interval, once each.
 *
 * Called at startup when consent is already persisted, and again when the user
 * opts in during onboarding — opting in must index in this session, not after
 * the next launch. The startup timer clears itself once it fires so a later
 * opt-in can arm a fresh near-term run.
 */
function scheduleBrowserIntelRun(): void {
  if (!startupTimer) {
    const tick = (): void => {
      startupTimer = null
      try {
        startBrowserIntelRun()
      } catch (error) {
        logError('scheduled run failed to start', error)
      }
    }
    startupTimer = setTimeout(tick, startupDelayMs)
    startupTimer.unref()
  }
  if (!intervalTimer) {
    const tick = (): void => {
      try {
        startBrowserIntelRun()
      } catch (error) {
        logError('scheduled run failed to start', error)
      }
    }
    intervalTimer = setInterval(tick, INTERVAL_MS)
    intervalTimer.unref()
  }
}

/**
 * Register the runtime once at app startup.
 *
 * Resolves the filesystem layout, wires the cognitive-profile provider into the
 * agent prompt, and — only with persisted consent — schedules the first run and
 * the recurring one. Never throws: a failure here must not stop the app.
 */
export function initBrowserIntelRuntime(): void {
  try {
    const resolved = ensurePaths()
    setCognitiveProfileProvider(() => readCognitiveProfileCache(resolved) || null)

    // The schema ships next to the bundle (dist/resources/browser-intel, see
    // scripts/copy-assets.ts) but the DB loader's frozen candidate list does not
    // include that directory. The loader does honour ROX_BROWSER_INTEL_SCHEMA,
    // so export it (once) before any store is opened — the unfurl worker
    // inherits the variable when it is spawned.
    if (!process.env.ROX_BROWSER_INTEL_SCHEMA) {
      const schemaPath = join(__dirname, 'resources', 'browser-intel', 'schema.sql')
      if (existsSync(schemaPath)) process.env.ROX_BROWSER_INTEL_SCHEMA = schemaPath
    }

    if (startupTimer || intervalTimer) return
    if (!readState().consent) return

    scheduleBrowserIntelRun()
  } catch (error) {
    logError('initialization failed', error)
  }
}

export function getBrowserIntelStateSnapshot(): BrowserIntelState {
  return readState()
}

/**
 * Persist consent and reflect it in the running system.
 *
 * On revoke the cached profile block is removed immediately so the next agent
 * spawn loses the profile, and any in-flight run is aborted.
 */
export async function setBrowserIntelConsentAndSync(consent: boolean): Promise<BrowserIntelState> {
  const resolved = ensurePaths()
  const state = setBrowserIntelConsent(consent, resolved.configDir)
  if (!consent) {
    try {
      clearCognitiveProfileCache(resolved)
    } catch (error) {
      logWarn('failed to clear the cognitive-profile cache', error)
    }
    cancelBrowserIntelRun()
  } else {
    // Opting in during onboarding must start indexing in this session; the
    // deferred timer keeps the first run off the onboarding's critical path.
    scheduleBrowserIntelRun()
  }
  emit({ type: 'state', state })
  return state
}

export function getBrowserIntelStatsSnapshot(): IntelligenceStats {
  return readSnapshot((store) => store.readStats(), {
    profiles: 0,
    profilesByVendor: [],
    urls: 0,
    urlsPending: 0,
    urlsUnfurled: 0,
    urlsFailed: 0,
    visits: 0,
    bookmarks: 0,
    searches: 0,
    firstVisitAt: null,
    lastVisitAt: null,
    unfurlDetails: 0,
    slots: 0,
    dbBytes: null,
    lastIngestAt: null,
    lastUnfurlAt: null,
  })
}

export function getBrowserIntelSlotsSnapshot(): ProfileSlotRecord[] {
  return readSnapshot((store) => store.readSlots(), [])
}

/**
 * Start a run in the background.
 *
 * Returns `{ started: false }` when consent is off or another run is live; the
 * pipeline itself is fire-and-forget and reports through events.
 */
export function startBrowserIntelRun(): { started: boolean } {
  if (running) return { started: false }
  const resolved = ensurePaths()
  if (!readState().consent) return { started: false }

  running = true
  const controller = new AbortController()
  abortController = controller
  const deps = testDeps ?? {}

  const onProgress = (progress: PipelineProgress): void => emit({ type: 'progress', progress })

  void (async () => {
    try {
      const result = await runIntelligencePipeline(
        {
          consent: true,
          signal: controller.signal,
          runUnfurl: deps.runUnfurl ?? runUnfurlViaWorker,
          onProgress,
        },
        deps,
      )
      recordBrowserIntelRun(
        {
          profiles: result.profiles.length,
          visits: result.ingested.reduce((total, ingest) => total + ingest.visits, 0),
          urls: result.ingested.reduce((total, ingest) => total + ingest.urlsEnqueued, 0),
          slots: result.synthesis?.slots.length ?? 0,
          errors: result.errors.length,
        },
        resolved.configDir,
      )
    } catch (error) {
      logError('run failed', error)
    } finally {
      running = false
      abortController = null
      emit({ type: 'state', state: readState() })
    }
  })()

  return { started: true }
}

export function cancelBrowserIntelRun(): { cancelled: boolean } {
  if (!running || !abortController) return { cancelled: false }
  abortController.abort()
  return { cancelled: true }
}

/** Subscribe to progress/state events; the returned function unsubscribes. */
export function onBrowserIntelEvent(listener: BrowserIntelEventListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Tear down timers, listeners and the test seam (tests, app shutdown). */
export function disposeBrowserIntelRuntime(): void {
  if (startupTimer) {
    clearTimeout(startupTimer)
    startupTimer = null
  }
  if (intervalTimer) {
    clearInterval(intervalTimer)
    intervalTimer = null
  }
  cancelBrowserIntelRun()
  listeners.clear()
  setCognitiveProfileProvider(null)
  paths = null
  testDeps = null
  startupDelayMs = STARTUP_DELAY_MS
  workerEntryOverride = null
  running = false
  abortController = null
}