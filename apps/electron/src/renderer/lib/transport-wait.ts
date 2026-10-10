import i18n from 'i18next'
import type { ElectronAPI, TransportConnectionState } from '../../shared/types'

export const DEFAULT_TIMEOUT_MS = 12_000

function formatTransportFailure(state: TransportConnectionState): string {
  if (state.lastError?.message) return state.lastError.message
  if (state.lastClose?.code != null) {
    const reason = state.lastClose.reason
      ? i18n.t('transport.wsClosedReason', { reason: state.lastClose.reason })
      : ''
    return i18n.t('transport.wsClosedWithCode', { code: state.lastClose.code, reason })
  }
  return i18n.t('workspace.connectionFailed')
}

export async function waitForTransportConnected(
  api: Pick<ElectronAPI, 'getTransportConnectionState' | 'onTransportConnectionStateChanged'>,
  options?: { timeoutMs?: number },
): Promise<TransportConnectionState> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const current = await api.getTransportConnectionState()
  if (current.status === 'connected') {
    return current
  }

  return await new Promise<TransportConnectionState>((resolve, reject) => {
    let settled = false
    let unsubscribe: (() => void) | null = null
    let timeout: ReturnType<typeof setTimeout> | null = null

    const finish = (fn: (value: any) => void, value: any) => {
      if (settled) return
      settled = true
      if (unsubscribe) unsubscribe()
      if (timeout) clearTimeout(timeout)
      fn(value)
    }

    timeout = setTimeout(() => {
      finish(reject, new Error(i18n.t('workspace.connectionTimeout', { ms: timeoutMs })))
    }, timeoutMs)

    unsubscribe = api.onTransportConnectionStateChanged((state) => {
      if (state.status === 'connected') {
        finish(resolve, state)
        return
      }

      if (state.status === 'failed') {
        finish(reject, new Error(formatTransportFailure(state)))
      }
    })
  })
}

/**
 * Bounded reconnect repair for a session-load failure that was swallowed while the
 * transport banner was visible (see shouldSurfaceSessionLoadFailure in App.tsx).
 *
 * PR #1732 bounded a single repair attempt's await with DEFAULT_TIMEOUT_MS but left the
 * repair itself unbounded: no attempt cap or backoff, no in-flight guard (a reconnect
 * during a timed-out call started a second concurrent loadSessionsFromServer), and the
 * flag was re-armed on the deadline even when the load later succeeded, so a late
 * success still triggered a redundant reload on the next reconnect.
 *
 * The controller returned here owns that state instead:
 * - single-flight: a reconnect that arrives while a repair is in flight joins it
 *   (`run()` resolves to 'in-flight') instead of starting a second concurrent load;
 * - bounded: at most `maxAttempts` attempts, waiting `backoffMs[i]` before retry i+1;
 * - honest re-arm: the flag stays armed only when the load actually failed or timed out;
 *   a timed-out load that later succeeds disarms it, so the next reconnect does not
 *   reload redundantly.
 */
export const MAX_REPAIR_ATTEMPTS = 3
/** Delay before retry i+1 (2 s, then 8 s). Documented backoff for the bounded repair. */
export const REPAIR_BACKOFF_MS = [2_000, 8_000]

export type ReconnectRepairOutcome = 'repaired' | 'timed-out' | 'exhausted' | 'in-flight'

export interface RepairAttemptDeadline {
  /** Resolves when the per-attempt deadline elapses. */
  elapsed: Promise<void>
  /** Cancels the pending deadline once the attempt settles first. */
  cancel: () => void
}

/** Test/workflow seam: schedules the per-attempt deadline. Defaults to a real timer. */
export type RepairDeadlineFactory = (timeoutMs: number) => RepairAttemptDeadline

function realDeadline(timeoutMs: number): RepairAttemptDeadline {
  const { promise, resolve } = Promise.withResolvers<void>()
  const timer = setTimeout(() => resolve(), timeoutMs)
  return { elapsed: promise, cancel: () => clearTimeout(timer) }
}

export interface BoundedReconnectRepairOptions {
  /**
   * Performs one session load and reports whether it genuinely succeeded. May reject;
   * a rejection is treated as a failure and the controller never propagates it.
   */
  load: () => Promise<boolean>
  /** Re-arms the repair flag (called when the load failed or timed out). */
  arm: () => void
  /** Disarms the repair flag (called on a genuine success). */
  disarm: () => void
  timeoutMs?: number
  maxAttempts?: number
  backoffMs?: number[]
  sleep?: (ms: number) => Promise<void>
  createDeadline?: RepairDeadlineFactory
  onAttemptTimeout?: (attempt: number) => void
  onExhausted?: (attempts: number) => void
}

export interface BoundedReconnectRepair {
  readonly inFlight: boolean
  run(): Promise<ReconnectRepairOutcome>
}

export function createBoundedReconnectRepair(
  options: BoundedReconnectRepairOptions,
): BoundedReconnectRepair {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxAttempts = options.maxAttempts ?? MAX_REPAIR_ATTEMPTS
  const backoffMs = options.backoffMs ?? REPAIR_BACKOFF_MS
  const createDeadline = options.createDeadline ?? realDeadline
  const sleep = options.sleep ?? ((ms: number) => {
    const { promise, resolve } = Promise.withResolvers<void>()
    setTimeout(() => resolve(), ms)
    return promise
  })

  let inFlight: Promise<void> | null = null
  let deferred: Promise<unknown> | null = null

  /**
   * Runs one load under the per-attempt deadline. A timed-out load keeps running; its
   * promise (resolving to whether it succeeded) is returned so the caller can hold the
   * single-flight guard until it settles.
   */
  async function loadOnce(): Promise<{ timedOut: boolean; succeeded: boolean; settled: Promise<boolean> }> {
    let succeeded = false
    let finished = false
    const settled = options.load().then(
      (ok) => {
        succeeded = ok
        finished = true
        return ok
      },
      () => {
        succeeded = false
        finished = true
        return false
      },
    )
    const deadline = createDeadline(timeoutMs)
    await Promise.race([settled, deadline.elapsed])
    deadline.cancel()
    return { timedOut: !finished, succeeded, settled }
  }

  async function repair(): Promise<ReconnectRepairOutcome> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const { timedOut, succeeded, settled } = await loadOnce()

      if (timedOut) {
        // Re-arm so a later reconnect retries, but keep the single-flight guard until
        // this load settles: a late success disarms again (no redundant reload), while
        // a late failure leaves the flag armed for the next reconnect to retry.
        options.arm()
        options.onAttemptTimeout?.(attempt)
        deferred = settled
        settled.then((lateSuccess) => {
          if (lateSuccess) options.disarm()
        })
        return 'timed-out'
      }

      if (succeeded) {
        // Genuine success: leave the flag disarmed so no redundant reload follows.
        options.disarm()
        return 'repaired'
      }

      if (attempt === maxAttempts) {
        options.arm()
        options.onExhausted?.(attempt)
        return 'exhausted'
      }

      await sleep(backoffMs[attempt - 1] ?? 0)
    }
    // Unreachable: the loop always returns on its last iteration.
    return 'exhausted'
  }

  return {
    get inFlight() {
      return inFlight !== null
    },
    run() {
      if (inFlight) return Promise.resolve<ReconnectRepairOutcome>('in-flight')
      deferred = null
      const runPromise = repair()
      inFlight = runPromise
        .then(() => deferred, () => deferred)
        .then(() => undefined)
        .finally(() => {
          inFlight = null
          deferred = null
        })
      return runPromise
    },
  }
}
