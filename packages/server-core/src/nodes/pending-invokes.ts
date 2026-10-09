/**
 * f.9 — bounded, timed pending node invokes with typed terminal results.
 *
 * Clean-room re-expression of the OpenClaw NodeRegistry pending-invoke
 * bookkeeping (port-analysis row f.9; upstream `src/gateway/node-registry.ts:175`).
 *
 * Invariants enforced here:
 * - every invoke settles exactly once (ok | error | timeout) — a late
 *   `resolve`/`fail`/`cancel` after settlement is a no-op returning `false`;
 * - each node has a bounded number of in-flight invokes (queue-full is refused
 *   at `create`, never silently dropped);
 * - timeouts are explicit: the deadline is stored, a timer settles the invoke
 *   in production, and `sweep(now)` settles deterministically for a caller
 *   that owns the clock.
 */

/** Default ceiling of concurrent invokes per node. */
export const DEFAULT_MAX_PENDING_PER_NODE = 16

/** Default invoke deadline before the result becomes `timeout`. */
export const DEFAULT_INVOKE_TIMEOUT_MS = 30_000

/** Queued-refusal / settlement codes carried inside a terminal error result. */
export type InvokeErrorCode =
  | 'QUEUE_FULL'
  | 'CANCELLED'
  | 'DISCONNECTED'
  | 'TIMEOUT'
  | string

export interface InvokeError {
  readonly code: InvokeErrorCode
  readonly message: string
}

export type TerminalInvokeResult =
  | { readonly status: 'ok'; readonly invokeId: string; readonly nodeId: string; readonly command: string; readonly payload: unknown }
  | { readonly status: 'error'; readonly invokeId: string; readonly nodeId: string; readonly command: string; readonly error: InvokeError }
  | { readonly status: 'timeout'; readonly invokeId: string; readonly nodeId: string; readonly command: string }

export interface PendingInvokeHandle {
  readonly invokeId: string
  readonly nodeId: string
  readonly command: string
  /** Resolves exactly once, with the terminal outcome. */
  readonly result: Promise<TerminalInvokeResult>
}

export type CreatePendingInvoke =
  | { readonly ok: true; readonly handle: PendingInvokeHandle }
  | { readonly ok: false; readonly error: InvokeError }

export interface PendingInvokeTrackerOptions {
  /** Concurrent per-node ceiling. Default 16. */
  readonly maxPerNode?: number
  /** Default deadline in ms. Default 30s. */
  readonly timeoutMs?: number
  /** Injected clock. Default `Date.now`. */
  readonly now?: () => number
  /** Injected timer (default `setTimeout`); tests pass a no-op and drive `sweep`. */
  readonly setTimer?: (fn: () => void, ms: number) => unknown
  /** Injected timer cancel (default `clearTimeout`). */
  readonly clearTimer?: (handle: unknown) => void
}

interface PendingInvokeRecord {
  readonly invokeId: string
  readonly nodeId: string
  readonly command: string
  readonly deadlineAt: number
  readonly timer: unknown
  settled: boolean
  readonly settle: (result: TerminalInvokeResult) => void
}

export class PendingInvokeTracker {
  private readonly maxPerNode: number
  private readonly defaultTimeoutMs: number
  private readonly clock: () => number
  private readonly setTimer: (fn: () => void, ms: number) => unknown
  private readonly clearTimer: (handle: unknown) => void
  private readonly pending = new Map<string, PendingInvokeRecord>()
  private seq = 0

  constructor(options: PendingInvokeTrackerOptions = {}) {
    const maxPerNode = options.maxPerNode ?? DEFAULT_MAX_PENDING_PER_NODE
    const timeoutMs = options.timeoutMs ?? DEFAULT_INVOKE_TIMEOUT_MS
    if (!Number.isSafeInteger(maxPerNode) || maxPerNode < 1) {
      throw new Error('PendingInvokeTracker: maxPerNode must be a positive integer')
    }
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
      throw new Error('PendingInvokeTracker: timeoutMs must be a positive integer')
    }
    this.maxPerNode = maxPerNode
    this.defaultTimeoutMs = timeoutMs
    this.clock = options.now ?? Date.now
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  }

  get size(): number {
    return this.pending.size
  }

  pendingCountFor(nodeId: string): number {
    let count = 0
    for (const record of this.pending.values()) {
      if (record.nodeId === nodeId) count += 1
    }
    return count
  }

  /**
   * Reserve a pending invoke for a node. Refused with `QUEUE_FULL` when the
   * node already has `maxPerNode` in-flight invokes.
   */
  create(nodeId: string, command: string, opts: { timeoutMs?: number } = {}): CreatePendingInvoke {
    if (this.pendingCountFor(nodeId) >= this.maxPerNode) {
      return { ok: false, error: { code: 'QUEUE_FULL', message: `node ${nodeId} has ${this.maxPerNode} in-flight invokes` } }
    }

    const invokeId = `ni_${++this.seq}`
    const timeoutMs = opts.timeoutMs ?? this.defaultTimeoutMs
    const deadlineAt = this.clock() + timeoutMs

    let settleFn!: (result: TerminalInvokeResult) => void
    const result = new Promise<TerminalInvokeResult>((resolve) => { settleFn = resolve })

    const record: PendingInvokeRecord = {
      invokeId, nodeId, command, deadlineAt,
      timer: undefined, settled: false, settle: settleFn,
    }
    this.pending.set(invokeId, record)
    record.timer = this.setTimer(() => { this.expire(invokeId) }, timeoutMs)

    return { ok: true, handle: { invokeId, nodeId, command, result } }
  }

  /** Settle an invoke as `ok`. Returns false when it was already settled/unknown. */
  resolve(invokeId: string, payload: unknown): boolean {
    const record = this.pending.get(invokeId)
    if (!record) return false
    return this.settle(record, { status: 'ok', invokeId, nodeId: record.nodeId, command: record.command, payload })
  }

  /** Settle an invoke as `error`. Returns false when it was already settled/unknown. */
  fail(invokeId: string, error: InvokeError): boolean {
    const record = this.pending.get(invokeId)
    if (!record) return false
    return this.settle(record, { status: 'error', invokeId, nodeId: record.nodeId, command: record.command, error })
  }

  /** Deterministic cancellation: settles `error/CANCELLED` exactly once. */
  cancel(invokeId: string): boolean {
    return this.fail(invokeId, { code: 'CANCELLED', message: 'invoke cancelled' })
  }

  /** Settle an invoke as `timeout`. Idempotent; safe to call from the timer. */
  expire(invokeId: string): boolean {
    const record = this.pending.get(invokeId)
    if (!record) return false
    return this.settle(record, { status: 'timeout', invokeId, nodeId: record.nodeId, command: record.command })
  }

  /** Settle every invoke whose deadline has passed. Returns the settled ids. */
  sweep(at: number = this.clock()): string[] {
    const expired: string[] = []
    for (const [invokeId, record] of this.pending) {
      if (at >= record.deadlineAt && this.expire(invokeId)) expired.push(invokeId)
    }
    return expired
  }

  /**
   * Fail every in-flight invoke for a node (disconnect / presence expiry).
   * Returns the number settled.
   */
  failForNode(nodeId: string, error: InvokeError): number {
    let settled = 0
    for (const [invokeId, record] of [...this.pending]) {
      if (record.nodeId === nodeId && this.fail(invokeId, error)) settled += 1
    }
    return settled
  }

  private settle(record: PendingInvokeRecord, result: TerminalInvokeResult): boolean {
    if (record.settled) return false
    record.settled = true
    this.pending.delete(record.invokeId)
    this.clearTimer(record.timer)
    record.settle(result)
    return true
  }
}