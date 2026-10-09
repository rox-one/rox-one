/**
 * Live-refresh coalescer for the workspace work board (row b2.2).
 *
 * The main process broadcasts `workboard:changed` payload-only — the receiver
 * re-reads by revision (see `packages/shared/src/protocol/events.ts`). A drag
 * storm or a burst of server writes otherwise thrashes the board with redundant
 * `workboard:read` round-trips, so every changed event funnels through this
 * module, which:
 *
 *   - normalises the payload and ignores malformed revisions;
 *   - no-ops when the payload revision equals the applied revision;
 *   - treats a revision regression as an epoch bump forcing a full reload
 *     (the server lost state; `sinceRevision` is dropped);
 *   - single-flights the read, coalescing rapid events into one reload;
 *   - defers while the tab is hidden and resumes on `visibilitychange`;
 *   - defers while a card write is in flight and retries once (default 1 s,
 *     or sooner when the caller reports the write finished via `endWrite`).
 *
 * `document` and the timer functions are injectable so the state machine is
 * testable with fake timers and no DOM.
 */

import type { WorkboardReadResult } from '../../../../shared/types'

export interface WorkboardChangedPayload {
  revision: number
}

/** Minimal surface of `document` this module needs — injectable for tests. */
export interface BoardVisibilityDocument {
  readonly hidden: boolean
  addEventListener(type: 'visibilitychange', listener: () => void): void
  removeEventListener(type: 'visibilitychange', listener: () => void): void
}

export interface BoardLiveRefreshReadArgs {
  /** Omitted for a full reload (regression / epoch bump). */
  sinceRevision?: number
  /** The epoch the read belongs to — a fresh identity after a regression. */
  epoch: number
}

export interface BoardLiveRefreshReload {
  result: WorkboardReadResult
  epoch: number
  /** The revision now considered applied (unchanged reads keep the prior one). */
  revision: number
  /** True when `sinceRevision` was dropped (regression / epoch bump). */
  full: boolean
}

export interface BoardLiveRefreshOptions {
  read: (args: BoardLiveRefreshReadArgs) => Promise<WorkboardReadResult>
  /** Called after every read (including `unchanged` ones). */
  onReloaded?: (reload: BoardLiveRefreshReload) => void
  onError?: (error: unknown) => void
  /** True while an optimistic card write is in flight — refresh is deferred. */
  isWriteInFlight: () => boolean
  /** Defaults to the real `document`; `null` disables visibility handling. */
  document?: BoardVisibilityDocument | null
  setTimeout?: (handler: () => void, ms: number) => unknown
  clearTimeout?: (handle: unknown) => void
  /** Delay before retrying a refresh blocked by an in-flight write. */
  retryDelayMs?: number
  initialRevision?: number
  initialEpoch?: number
}

export interface BoardLiveRefreshHandle {
  /** Feed a `workboard:changed` payload. */
  notify(payload: WorkboardChangedPayload | null | undefined): void
  /** Report that a card write finished — resumes a deferred refresh. */
  endWrite(): void
  getRevision(): number
  getEpoch(): number
  isReloading(): boolean
  hasPending(): boolean
  dispose(): void
}

/** Payload shape guard: a finite, integral revision or `null`. */
export function normaliseWorkboardRevision(
  payload: WorkboardChangedPayload | null | undefined,
): number | null {
  const raw = payload?.revision
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null
  return Math.trunc(raw)
}

function defaultDocument(): BoardVisibilityDocument | null {
  return typeof document !== 'undefined'
    ? (document as unknown as BoardVisibilityDocument)
    : null
}

export function createBoardLiveRefresh(options: BoardLiveRefreshOptions): BoardLiveRefreshHandle {
  const retryDelayMs = options.retryDelayMs ?? 1000
  const scheduleTimeout =
    options.setTimeout ?? ((handler: () => void, ms: number) => globalThis.setTimeout(handler, ms))
  const cancelTimeout =
    options.clearTimeout ??
    ((handle: unknown) => globalThis.clearTimeout(handle as number))
  const doc = options.document !== undefined ? options.document : defaultDocument()

  let appliedRevision = options.initialRevision ?? 0
  let epoch = options.initialEpoch ?? 0
  let pending: number | null = null
  let pendingRegressed = false
  let reloading = false
  let flushTimer: unknown = null
  let retryTimer: unknown = null
  let disposed = false

  const isHidden = (): boolean => !!doc?.hidden

  function armFlush(): void {
    if (disposed || flushTimer !== null) return
    // Hidden tabs do no work; the visibilitychange handler re-arms on return.
    if (isHidden()) return
    flushTimer = scheduleTimeout(() => {
      flushTimer = null
      void attempt(false)
    }, 0)
  }

  function armWriteRetry(): void {
    if (disposed || retryTimer !== null) return
    // A stuck card write must not block the board forever: retry once, then wait
    // for `endWrite()`. `force` bypasses the write guard on this one retry.
    retryTimer = scheduleTimeout(() => {
      retryTimer = null
      void attempt(true)
    }, retryDelayMs)
  }

  async function attempt(force: boolean): Promise<void> {
    if (disposed || pending === null || reloading) return
    if (isHidden()) return
    if (!force && options.isWriteInFlight()) {
      armWriteRetry()
      return
    }

    pending = null
    const full = pendingRegressed
    pendingRegressed = false
    if (full) epoch += 1

    reloading = true
    try {
      const result = await options.read({
        ...(full ? {} : { sinceRevision: appliedRevision }),
        epoch,
      })
      let reloadedEpoch = epoch
      if (!result.unchanged) {
        if (!full && result.revision < appliedRevision) {
          // An incremental read answered with an older revision than we had
          // applied — give the board a new epoch so consumers drop stale state.
          epoch += 1
          reloadedEpoch = epoch
        }
        appliedRevision = result.revision
      }
      options.onReloaded?.({ result, epoch: reloadedEpoch, revision: appliedRevision, full })
    } catch (error) {
      options.onError?.(error)
    } finally {
      reloading = false
      // A newer revision arrived while we were reading — coalesce into one more.
      if (pending !== null) armFlush()
    }
  }

  function onVisibilityChange(): void {
    if (disposed) return
    if (isHidden()) return
    if (pending !== null) armFlush()
  }

  doc?.addEventListener('visibilitychange', onVisibilityChange)

  function notify(payload: WorkboardChangedPayload | null | undefined): void {
    if (disposed) return
    const revision = normaliseWorkboardRevision(payload)
    if (revision === null) return
    if (revision === appliedRevision && !pendingRegressed) return
    if (revision < appliedRevision) pendingRegressed = true
    pending = revision
    armFlush()
  }

  function endWrite(): void {
    if (disposed) return
    if (retryTimer !== null) {
      cancelTimeout(retryTimer)
      retryTimer = null
    }
    if (pending !== null) void attempt(false)
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    if (flushTimer !== null) {
      cancelTimeout(flushTimer)
      flushTimer = null
    }
    if (retryTimer !== null) {
      cancelTimeout(retryTimer)
      retryTimer = null
    }
    pending = null
    doc?.removeEventListener('visibilitychange', onVisibilityChange)
  }

  return {
    notify,
    endWrite,
    getRevision: () => appliedRevision,
    getEpoch: () => epoch,
    isReloading: () => reloading,
    hasPending: () => pending !== null,
    dispose,
  }
}