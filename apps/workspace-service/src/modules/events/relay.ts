/**
 * W1-03 (#1500) — Transactional-outbox relay.
 *
 * After a command commits, the relay reads `domain_event` rows past its
 * watermark (sequence order == commit order, see the append lock in the
 * Postgres store) and hands them to the sinks (in-process bus → realtime
 * gateway; optional Valkey). Nothing published is ever derived from
 * uncommitted state.
 *
 * - Watermarks are kept per sink and workspace: a failing sink (Valkey) is
 *   retried on its own and never makes another sink (the bus, which would
 *   re-sequence the events as new frames) see an event twice.
 * - A failed pass schedules a retry with exponential backoff, so a quiet
 *   workspace does not keep undelivered events until its next commit.
 * - `publish` returns as soon as the watermark is initialised; delivery runs
 *   in the background with one single-flight loop per sink and workspace,
 *   so command responses never wait on (or hang behind) fan-out.
 * - `start()` initialises the watermarks from the store's committed maximum
 *   sequence per workspace, so the first watermark never depends on which of
 *   two concurrent first commits publishes first.
 */

import type { DomainEvent } from '../../../../../packages/core/src/events/index.ts'
import type { CommandStore } from '../../../../../packages/server-core/src/commands/store.ts'

export type DomainEventSink = (events: DomainEvent[]) => void | Promise<void>

export interface DomainEventRelayOptions {
  store: CommandStore
  sinks: DomainEventSink[]
  batchSize?: number
  /** Retry after a failed pass: base * 2^(failures-1), capped. */
  retryBaseMs?: number
  retryMaxMs?: number
  onError?: (error: unknown) => void
}

interface WorkspaceRelayState {
  /** One watermark, failure count and retry timer per sink (index = sink index). */
  watermarks: number[]
  failures: number[]
  timers: Array<ReturnType<typeof setTimeout> | null>
}

export class DomainEventRelay {
  private readonly states = new Map<string, WorkspaceRelayState>()
  /** In-flight delivery per (sink, workspace). */
  private readonly running = new Map<string, Promise<void>>()
  private readonly again = new Set<string>()
  /** Committed max sequence per workspace at startup (absent → 0). */
  private initial: Map<string, number> | null = null
  private initializing: Promise<void> | null = null
  private closed = false

  constructor(private readonly options: DomainEventRelayOptions) {}

  /**
   * Load the committed maximum sequence per workspace. Call once at startup,
   * before the first command commits; `publish` awaits it. Stores without
   * `latestSequences` fall back to "first published event − 1".
   */
  start(): Promise<void> {
    if (this.initial || !this.options.store.latestSequences) return Promise.resolve()
    this.initializing ??= this.options.store.latestSequences()
      .then(latest => { this.initial = latest })
      .catch(error => {
        this.initializing = null
        this.options.onError?.(error)
      })
    return this.initializing
  }

  close(): void {
    this.closed = true
    for (const state of this.states.values()) for (const timer of state.timers) if (timer) clearTimeout(timer)
  }

  /** Lowest sink watermark (everything at or below it reached every sink). */
  watermark(workspaceId: string): number | undefined {
    const state = this.states.get(workspaceId)
    return state ? Math.min(...state.watermarks) : undefined
  }

  sinkWatermarks(workspaceId: string): number[] | undefined {
    return this.states.get(workspaceId)?.watermarks.slice()
  }

  /**
   * Executor `publish` hook. Never waits on fan-out: after the watermark is
   * initialised it starts a catch-up in the background (errors → `onError`
   * and a retry), so a slow or hung sink (Valkey) never delays the command
   * response. Use `idle()` to wait for delivery (tests, shutdown).
   */
  readonly publish = async (events: DomainEvent[]): Promise<void> => {
    const workspaceId = events[0]?.workspaceId
    if (!workspaceId) return
    if (this.initializing) await this.initializing
    if (!this.states.has(workspaceId)) {
      let start: number | undefined
      if (this.initial) start = this.initial.get(workspaceId) ?? 0
      else {
        const first = Math.min(...events.map(event => event.sequence ?? Number.POSITIVE_INFINITY))
        if (Number.isFinite(first)) start = first - 1
      }
      if (start === undefined) return
      this.states.set(workspaceId, {
        watermarks: this.options.sinks.map(() => start!),
        failures: this.options.sinks.map(() => 0),
        timers: this.options.sinks.map(() => null),
      })
    }
    void this.catchUp(workspaceId).catch(error => this.options.onError?.(error))
  }

  /**
   * Deliver everything after the watermarks. Each sink runs its own
   * single-flight loop, so a hung sink never holds back the others; the
   * promise settles when every sink's loop for this workspace has.
   */
  catchUp(workspaceId: string): Promise<void> {
    const state = this.states.get(workspaceId)
    if (!state || this.closed) return Promise.resolve()
    return Promise.all(this.options.sinks.map((_, index) => this.catchUpSink(workspaceId, state, index))).then(() => undefined)
  }

  /** Resolves once no delivery is in flight (for tests and graceful shutdown). */
  async idle(): Promise<void> {
    while (this.running.size > 0) await Promise.allSettled([...this.running.values()])
  }

  private catchUpSink(workspaceId: string, state: WorkspaceRelayState, index: number): Promise<void> {
    const key = `${index}\u0000${workspaceId}`
    const current = this.running.get(key)
    if (current) {
      this.again.add(key)
      return current
    }
    const run = (async () => {
      do {
        this.again.delete(key)
        await this.pass(workspaceId, state, index)
      } while (this.again.has(key) && !this.closed)
    })().finally(() => this.running.delete(key))
    this.running.set(key, run)
    return run
  }

  private async pass(workspaceId: string, state: WorkspaceRelayState, index: number): Promise<void> {
    if (this.closed) return
    const limit = this.options.batchSize ?? 500
    const sink = this.options.sinks[index]!
    try {
      for (;;) {
        const after = state.watermarks[index]!
        const events = await this.options.store.listEvents(workspaceId, { afterSequence: after, limit })
        if (events.length === 0) break
        await sink(events)
        state.watermarks[index] = events[events.length - 1]!.sequence ?? after
        if (events.length < limit || this.closed) break
      }
      state.failures[index] = 0
    } catch (error) {
      this.options.onError?.(error)
      this.scheduleRetry(workspaceId, state, index)
    }
  }

  private scheduleRetry(workspaceId: string, state: WorkspaceRelayState, index: number): void {
    if (this.closed || state.timers[index]) return
    const failures = (state.failures[index] ?? 0) + 1
    state.failures[index] = failures
    const delay = Math.min((this.options.retryBaseMs ?? 500) * 2 ** (failures - 1), this.options.retryMaxMs ?? 30_000)
    const timer = setTimeout(() => {
      state.timers[index] = null
      void this.catchUpSink(workspaceId, state, index).catch(error => this.options.onError?.(error))
    }, delay)
    ;(timer as { unref?: () => void }).unref?.()
    state.timers[index] = timer
  }
}
