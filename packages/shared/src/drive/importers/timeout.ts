/**
 * ROX Drive (wave 4) — request-timeout policy shared by the cloud-import
 * providers (`./providers/*`) and the S3 upload target (`./r2-target`).
 *
 * Semantics (deliberate, and different per phase):
 *
 *  - **Request timeout** (`DEFAULT_REQUEST_TIMEOUT_MS`, 30s) — a *hard* cap on a
 *    short-lived exchange: token/device-code calls, folder listings and Graph
 *    download-link lookups. These either produce a response promptly or are
 *    hung, and a hung one can never recover. Applied with
 *    `AbortSignal.timeout()`, so it also bounds consumption of the small JSON
 *    body (a server that sends headers then stalls is still aborted).
 *
 *  - **Stall timeout** (`DEFAULT_STALL_TIMEOUT_MS`, 30s) — a *progress* cap for
 *    streams that legitimately run for minutes: file downloads and S3 uploads.
 *    The connection is aborted only when no byte of progress is observed for a
 *    whole window; every chunk re-arms the window, so a slow-but-moving
 *    transfer is never killed. There is deliberately **no** total-time cap
 *    here — killing a large upload mid-flight would corrupt the object and
 *    defeat the runner's resume logic.
 *
 * Both produce a typed `FetchTimeoutError` so callers can distinguish a timeout
 * from an ordinary network/HTTP failure (retryable either way).
 */

/** Hard cap for token/listing/metadata exchanges, milliseconds. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000

/** Maximum time with zero progress before a streamed transfer is aborted. */
export const DEFAULT_STALL_TIMEOUT_MS = 30_000

/** A request or stream made no progress inside its timeout window. */
export class FetchTimeoutError extends Error {
  readonly timeoutMs: number
  readonly kind = 'timeout'
  readonly stall: boolean

  constructor(timeoutMs: number, message?: string, options?: { cause?: unknown; stall?: boolean }) {
    super(message ?? `Request timed out after ${timeoutMs} ms`, options?.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'FetchTimeoutError'
    this.timeoutMs = timeoutMs
    this.stall = options?.stall ?? false
  }
}

/** True for anything this module raises or that `fetch` rejects with on abort. */
export function isTimeoutError(error: unknown): boolean {
  if (error instanceof FetchTimeoutError) return true
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) return true
  return false
}

/**
 * `fetch` bounded by a hard `requestTimeoutMs` cap. Any abort (the timer, or a
 * caller-supplied signal) surfaces as a `FetchTimeoutError` so the caller never
 * has to inspect `DOMException` names.
 */
export async function timedFetch(
  fetchImpl: typeof fetch,
  input: string | URL,
  init: RequestInit,
  requestTimeoutMs: number,
): Promise<Response> {
  const controller = new AbortController()
  // `finally` clears the timer on every settled path, so no pending timeout can
  // outlive the request.
  const timer = setTimeout(() => controller.abort(new FetchTimeoutError(requestTimeoutMs)), requestTimeoutMs)
  const signal = init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal
  try {
    return await fetchImpl(input, { ...init, signal })
  } catch (cause) {
    if (controller.signal.aborted || isTimeoutError(cause)) {
      throw new FetchTimeoutError(requestTimeoutMs, undefined, { cause })
    }
    throw cause
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Tracks a streamed transfer's liveness. `arm()` (re)starts the stall window and
 * must be called on every observed chunk; `clear()` stops it once the transfer
 * settles. `stallPromise` rejects when the window lapses, and the same moment
 * aborts `signal` so a real `fetch` tears its connection down.
 */
export class StallTimeoutMonitor {
  readonly stallMs: number
  private readonly controller = new AbortController()
  private timer: ReturnType<typeof setTimeout> | undefined
  private fired = false
  private readonly reject: (error: FetchTimeoutError) => void
  /** Rejects with a `FetchTimeoutError` when the stall window lapses. */
  readonly stallPromise: Promise<never>

  constructor(stallMs: number) {
    this.stallMs = stallMs
    const { promise, reject } = Promise.withResolvers<never>()
    this.stallPromise = promise
    this.reject = reject
    // During the connect/headers phase nothing awaits this promise; the signal
    // does the work. Keep a handler attached so it is never "unhandled".
    this.stallPromise.catch(() => {})
  }

  get signal(): AbortSignal {
    return this.controller.signal
  }

  get timedOut(): boolean {
    return this.fired
  }

  /** (Re)start the stall window. */
  arm(): void {
    if (this.fired) return
    this.stopTimer()
    this.timer = setTimeout(() => this.fire(), this.stallMs)
  }

  /** Stop watching (transfer settled). */
  clear(): void {
    this.stopTimer()
  }

  private stopTimer(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
  }

  private fire(): void {
    if (this.fired) return
    this.fired = true
    this.stopTimer()
    const error = new FetchTimeoutError(this.stallMs, `No progress for ${this.stallMs} ms`, { stall: true })
    this.reject(error)
    this.controller.abort(error)
  }
}

/**
 * Wrap a response/upload stream so the monitor is re-armed on every chunk and a
 * stall errors the stream with a `FetchTimeoutError` (and aborts `monitor.signal`
 * so the underlying connection is released).
 */
export function guardStreamWithStall(
  source: ReadableStream<Uint8Array>,
  monitor: StallTimeoutMonitor,
): ReadableStream<Uint8Array> {
  const reader = source.getReader()
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      monitor.arm()
      try {
        const { done, value } = await Promise.race([reader.read(), monitor.stallPromise])
        monitor.clear()
        if (done) {
          controller.close()
          return
        }
        controller.enqueue(value)
      } catch (error) {
        monitor.clear()
        await reader.cancel().catch(() => {})
        controller.error(error)
      }
    },
    cancel(reason) {
      monitor.clear()
      return reader.cancel(reason)
    },
  })
}