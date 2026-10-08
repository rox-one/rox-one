/**
 * Unfurl Worker Thread.
 *
 * Unfurling is CPU-bound and can run for minutes against a large history, so it
 * runs off the Electron main thread. This module is both halves of that worker:
 *
 *  - `runUnfurlBatches` is the loop (claim a chunk of `pending` URLs, decode
 *    each, persist, throttle, repeat) and is directly callable in-process (the
 *    pipeline uses it that way);
 *  - `startUnfurlWorker` / `handleUnfurlWorkerMessage` are the `worker_threads`
 *    glue: the host spawns the worker, the worker-side entry (built by the
 *    Electron packaging) calls the handler with `parentPort.postMessage`.
 *
 * Exactly one `IntelligenceStore` (one SQLite connection) is used per worker so
 * writes never contend with themselves; the chunk size and inter-batch delay
 * are the throttling budget (requirement D: 100 URLs / 150 ms).
 */

import { Worker } from 'node:worker_threads'

import { IntelligenceStore } from '../db/repositories.ts'
import { unfurlUrl } from './unfurlCore.ts'
import type { UnfurlBatchOutcome, UnfurlProgress, UnfurlWorkerMessage, UnfurlWorkerOptions } from '../types.ts'

export { unfurlUrl } from './unfurlCore.ts'

/** Rows claimed per batch (requirement D). */
export const DEFAULT_UNFURL_BATCH_SIZE = 100
/**
 * Minimum milliseconds held between batches (requirement D's fixed floor).
 * The adaptive throttle below never sleeps for less than this.
 */
export const DEFAULT_UNFURL_BATCH_DELAY_MS = 150
/** Default CPU budget: the unfurl loop may use 15% of one core, averaged. */
export const DEFAULT_UNFURL_TARGET_CPU_SHARE = 0.15
/** Upper bound on an adaptive inter-batch sleep, so one huge batch cannot stall the run. */
export const DEFAULT_UNFURL_MAX_BATCH_DELAY_MS = 5000

/** Argument passed on the CLI/Electron side to mark the unfurl worker entry. */
export const UNFURL_WORKER_ENTRY_ARG = 'browser-intel-unfurl-worker'

/** CPU-time meter; `process.cpuUsage()` shape (microseconds). */
export interface CpuUsage {
  user: number
  system: number
}

/**
 * `UnfurlProgress` plus the effective inter-batch throttle.
 *
 * `UnfurlProgress` (the frozen shared contract) has no `throttleMs` field, so it
 * is added on this wider shape rather than editing `types.ts`; consumers that
 * read the callback loosely still see it.
 */
export interface UnfurlProgressDetail extends UnfurlProgress {
  /** Milliseconds actually slept before the next batch (floor or adaptive). */
  throttleMs: number
}

/** Injectable delay; resolves early when the caller aborts. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  const { promise, resolve } = Promise.withResolvers<void>()
  if (signal?.aborted) {
    resolve()
    return promise
  }
  const onAbort = (): void => {
    clearTimeout(timer)
    resolve()
  }
  const timer = setTimeout(() => {
    signal?.removeEventListener('abort', onAbort)
    resolve()
  }, ms)
  signal?.addEventListener('abort', onAbort, { once: true })
  return promise
}

/**
 * Resolve the target CPU share, or `null` to disable adaptation.
 *
 * Convention: `0` (or any non-finite value, or a value outside `(0, 1)`)
 * disables the adaptive throttle and restores the fixed delay; anything else is
 * the fraction of one core the loop may use, averaged.
 */
function normalizeTargetCpuShare(value: number | undefined): number | null {
  const share = value ?? DEFAULT_UNFURL_TARGET_CPU_SHARE
  if (!Number.isFinite(share) || share <= 0 || share >= 1) return null
  return share
}

/**
 * Inter-batch sleep for a measured batch cost.
 *
 * CPU-time is counted as a fraction of wall time, so holding a share `s` needs
 * a total period of `cpuMs / s`; the sleep is the period minus the CPU already
 * spent, i.e. `cpuMs * (1 / s - 1)`. The result is floored at `floorMs`
 * (requirement D's 150 ms) and capped at `ceilingMs`.
 */
function computeThrottleMs(batchCpuMs: number, floorMs: number, ceilingMs: number, targetShare: number | null): number {
  if (targetShare === null) return Math.min(floorMs, ceilingMs)
  const adaptive = Math.max(0, batchCpuMs) * (1 / targetShare - 1)
  return Math.min(Math.max(floorMs, adaptive), ceilingMs)
}

export interface UnfurlRunOptions extends UnfurlWorkerOptions {
  /** Absolute path to the intelligence database. */
  dbPath: string
  /** Pre-opened store; when omitted the loop opens (and closes) its own. */
  store?: IntelligenceStore
  /** Fraction of one core the loop may average; `0` disables adaptation (default 0.15). */
  targetCpuShare?: number
  /** Hard cap on the adaptive sleep (default 5000 ms). */
  maxBatchDelayMs?: number
  /** Test seam: replaces the inter-batch/per-URL delay implementation. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  /** Test seam: replaces `process.cpuUsage`. */
  cpuUsage?: () => CpuUsage
}

/**
 * Decode every pending URL in chunks until none remain (or a cap/abort stops
 * the loop).
 *
 * A per-URL failure never stops the batch: `unfurlUrl` records decode errors on
 * its result (persisted by `saveUnfurl`), and a thrown error is parked with
 * `failUnfurl` so the attempt budget eventually moves the row to `error`.
 */
export async function runUnfurlBatches(options: UnfurlRunOptions): Promise<UnfurlBatchOutcome> {
  const batchSize = Math.max(1, Math.floor(options.batchSize ?? DEFAULT_UNFURL_BATCH_SIZE))
  const minBatchDelayMs = Math.max(0, options.batchDelayMs ?? DEFAULT_UNFURL_BATCH_DELAY_MS)
  const maxBatchDelayMs = Math.max(minBatchDelayMs, options.maxBatchDelayMs ?? DEFAULT_UNFURL_MAX_BATCH_DELAY_MS)
  const perUrlDelayMs = Math.max(0, options.perUrlDelayMs ?? 0)
  const maxBatches = options.maxBatches ?? Number.POSITIVE_INFINITY
  const targetCpuShare = normalizeTargetCpuShare(options.targetCpuShare)
  const signal = options.signal
  const sleepFn = options.sleep ?? sleep
  const cpuUsage = options.cpuUsage ?? (() => process.cpuUsage())
  const ownsStore = options.store === undefined
  // Serialized DB access: one connection, owned by (or injected into) this call.
  const store = options.store ?? new IntelligenceStore(options.dbPath)

  let batches = 0
  let processed = 0
  let failed = 0
  let cpuMsTotal = 0

  try {
    while (batches < maxBatches) {
      if (signal?.aborted) break
      const rows = store.claimPendingUrls(batchSize)
      if (rows.length === 0) break

      // Armed immediately before the batch so the delta is this batch's CPU.
      // `process.cpuUsage()` also counts the host process's other threads, so
      // the measurement is deliberately conservative: an inflated number only
      // lengthens the sleep, never shortens it.
      const cpuBefore = cpuUsage()
      const batchStartedAt = Date.now()

      for (const row of rows) {
        if (signal?.aborted) break
        try {
          const result = unfurlUrl(row.url, row.id)
          store.saveUnfurl(result)
          if (result.error) failed += 1
          cpuMsTotal += result.cpuMs
        } catch (error) {
          failed += 1
          try {
            store.failUnfurl(row.id, error instanceof Error ? error.message : String(error))
          } catch {
            // A failure to record the failure must not kill the batch.
          }
        }
        processed += 1
        if (perUrlDelayMs > 0) await sleepFn(perUrlDelayMs, signal)
      }

      const cpuAfter = cpuUsage()
      const batchCpuMs = Math.max(0, (cpuAfter.user - cpuBefore.user + (cpuAfter.system - cpuBefore.system)) / 1000)
      batches += 1
      const throttleMs = computeThrottleMs(batchCpuMs, minBatchDelayMs, maxBatchDelayMs, targetCpuShare)
      const progress: UnfurlProgressDetail = {
        batches,
        processed,
        failed,
        pendingRemaining: store.countPendingUrls(),
        lastBatchMs: Date.now() - batchStartedAt,
        cpuMsTotal,
        throttleMs,
      }
      options.onProgress?.(progress)

      if (signal?.aborted) break
      await sleepFn(throttleMs, signal)
    }

    return { batches, processed, failed, pendingRemaining: store.countPendingUrls(), cpuMsTotal }
  } finally {
    if (ownsStore) store.close()
  }
}

export interface UnfurlWorkerHostOptions extends UnfurlWorkerOptions {
  /** Called when the worker reports the final outcome. */
  onDone?: (outcome: UnfurlBatchOutcome) => void
  /** Called when the worker reports a fatal error. */
  onError?: (message: string) => void
}

/**
 * Build the `workerData` payload for the unfurl Worker Thread.
 *
 * Only structured-cloneable knobs may cross the thread boundary. Callbacks and
 * `signal` are not cloneable, and a bag a caller prepared for an in-process run
 * can also carry live runtime state (an open `IntelligenceStore` wrapping a
 * `DatabaseSync` handle); `new Worker` throws `DataCloneError` for such values
 * synchronously, so the payload is whitelisted here rather than spread from
 * the caller's bag.
 */
export function unfurlWorkerData(
  dbPath: string,
  options: UnfurlWorkerHostOptions = {},
): { dbPath: string; options: UnfurlWorkerOptions } {
  const forwarded: UnfurlWorkerOptions = {}
  if (options.batchSize !== undefined) forwarded.batchSize = options.batchSize
  if (options.batchDelayMs !== undefined) forwarded.batchDelayMs = options.batchDelayMs
  if (options.perUrlDelayMs !== undefined) forwarded.perUrlDelayMs = options.perUrlDelayMs
  if (options.maxBatches !== undefined) forwarded.maxBatches = options.maxBatches
  return { dbPath, options: forwarded }
}

/**
 * Spawn the unfurl Worker Thread.
 *
 * Only {@link unfurlWorkerData}'s whitelisted knobs travel in `workerData`; the
 * callbacks and `signal` stay on this thread. The returned `Worker` is the raw
 * `worker_threads` object — the caller owns its lifecycle (`terminate`, `exit`).
 */
export function startUnfurlWorker(input: {
  entryPath: string
  dbPath: string
  options?: UnfurlWorkerHostOptions
}): Worker {
  const options = input.options ?? {}
  const { onProgress, signal, onDone, onError } = options
  const worker = new Worker(input.entryPath, { workerData: unfurlWorkerData(input.dbPath, options) })

  const forward = (message: UnfurlWorkerMessage): void => {
    if (message.type === 'progress') onProgress?.(message.progress)
    else if (message.type === 'done') onDone?.(message.outcome)
    else if (message.type === 'error') onError?.(message.message)
  }
  worker.on('message', (message: UnfurlWorkerMessage) => forward(message))

  if (signal) {
    const abort = (): void => worker.postMessage({ type: 'abort' } satisfies UnfurlWorkerMessage)
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
  }
  return worker
}

/** In-flight run on this thread, so an `abort` message can reach it. */
let activeController: AbortController | null = null

/**
 * Worker-side protocol handler.
 *
 * The Electron entry calls this with `parentPort.postMessage` for `post` and a
 * reader of `workerData.dbPath`. `start` runs the whole loop (resolving when it
 * finishes, after posting `done`/`error`); `abort` cancels any in-flight run.
 * The caller owns the `parentPort.on('message', …)` loop.
 */
export async function handleUnfurlWorkerMessage(
  message: UnfurlWorkerMessage,
  deps: {
    post: (message: UnfurlWorkerMessage) => void
    dbPathFromWorkerData: () => string | undefined
  },
): Promise<void> {
  if (message.type === 'abort') {
    activeController?.abort()
    return
  }
  if (message.type !== 'start') return

  const dbPath = message.dbPath || deps.dbPathFromWorkerData()
  if (!dbPath) {
    deps.post({ type: 'error', message: 'unfurl worker was started without a dbPath' })
    return
  }

  const options = message.options ?? {}
  const controller = new AbortController()
  activeController = controller
  const store = new IntelligenceStore(dbPath)

  try {
    const outcome = await runUnfurlBatches({
      ...options,
      dbPath,
      store,
      signal: options.signal ?? controller.signal,
      onProgress: (progress) => {
        options.onProgress?.(progress)
        deps.post({ type: 'progress', progress })
      },
    })
    deps.post({ type: 'done', outcome })
  } catch (error) {
    deps.post({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  } finally {
    if (activeController === controller) activeController = null
    store.close()
  }
}