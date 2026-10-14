/**
 * #1589 — coalesce streaming deltas to at most one renderer update per frame.
 *
 * Every `text_delta` / `thinking_delta` used to run the full session-event path
 * (new messages array, per-session atom write, a fresh session meta Map) on
 * arrival — dozens of times per frame on fast models. Adjacent deltas of the
 * same type, session and turn are concatenated here and delivered once per
 * animation frame. Concatenation is exact: the delta handlers only append.
 *
 * Ordering is preserved globally: any other event first flushes everything
 * queued before it, then is delivered synchronously, so lifecycle, tool and
 * completion events never overtake text that arrived earlier.
 */

type DeltaType = 'text_delta' | 'thinking_delta'

interface DeltaLike {
  type: string
  sessionId?: string
  turnId?: string
  delta?: string
  text?: string
}

export interface StreamDeltaCoalescerOptions {
  /** Called when delivering one event throws; the remaining events still deliver. */
  onError?: (error: unknown, event: unknown) => void
  /** Defaults to requestAnimationFrame plus a timer fallback (rAF stalls in hidden windows). */
  schedule?: (flush: () => void) => () => void
}

/** Fallback delay: a hidden/occluded window gets no frames, text must still land. */
export const STREAM_FLUSH_FALLBACK_MS = 50

function isDelta(event: DeltaLike): event is DeltaLike & { type: DeltaType; sessionId: string } {
  return (event.type === 'text_delta' && typeof event.delta === 'string')
    || (event.type === 'thinking_delta' && typeof event.text === 'string')
}

function defaultSchedule(flush: () => void): () => void {
  let done = false
  const run = () => { if (!done) { done = true; flush() } }
  const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(run) : null
  const timer = setTimeout(run, STREAM_FLUSH_FALLBACK_MS)
  return () => {
    done = true
    if (raf !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf)
    clearTimeout(timer)
  }
}

export function createStreamDeltaCoalescer<E>(
  deliver: (event: E) => void,
  {
    schedule = defaultSchedule,
    onError = (error, event) => console.error('[stream-coalescer] session event handler failed', (event as DeltaLike)?.type, error),
  }: StreamDeltaCoalescerOptions = {},
) {
  let queue: DeltaLike[] = []
  let cancelScheduled: (() => void) | null = null
  let disposed = false

  // A throw while applying one event must not take the rest of the batch (or
  // the turn-end/abort event that triggered the flush) down with it.
  const safeDeliver = (event: E) => {
    try { deliver(event) } catch (error) { onError(error, event) }
  }

  const flush = () => {
    cancelScheduled?.()
    cancelScheduled = null
    if (queue.length === 0) return
    const pending = queue
    queue = []
    for (const event of pending) safeDeliver(event as unknown as E)
  }

  const push = (incoming: E) => {
    if (disposed) return
    const event = incoming as unknown as DeltaLike
    if (!isDelta(event)) {
      flush()
      safeDeliver(incoming)
      return
    }
    const last = queue[queue.length - 1]
    if (last && last.type === event.type && last.sessionId === event.sessionId && last.turnId === event.turnId) {
      queue[queue.length - 1] = event.type === 'text_delta'
        ? { ...last, delta: (last.delta ?? '') + event.delta }
        : { ...last, text: (last.text ?? '') + event.text }
    } else {
      queue.push({ ...event })
    }
    if (!cancelScheduled) cancelScheduled = schedule(flush)
  }

  return {
    push,
    flush,
    /** Deliver anything still queued, stop scheduling, and ignore later pushes. */
    dispose: () => {
      flush()
      disposed = true
    },
  }
}
