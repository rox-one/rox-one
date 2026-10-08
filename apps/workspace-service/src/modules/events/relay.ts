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
  /** One watermark per sink (index = sink index). */
  watermarks: number[]
  failures: number
  timer: ReturnType<typeof setTimeout> | null
}

export class DomainEventRelay {
  private readonly states = new Map<string, WorkspaceRelayState>()
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
    for (const state of this.states.values()) if (state.timer) clearTimeout(state.timer)
  }

  /** Lowest sink watermark (everything at or below it reached every sink). */
  watermark(workspaceId: string): number | undefined {
    const state = this.states.get(workspaceId)
    return state ? Math.min(...state.watermarks) : undefined
  }

  sinkWatermarks(workspaceId: string): number[] | undefined {
    return this.states.get(workspaceId)?.watermarks.slice()
  }

  /** Executor `publish` hook. */
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
      this.states.set(workspaceId, { watermarks: this.options.sinks.map(() => start!), failures: 0, timer: null })
    }
    return this.catchUp(workspaceId)
  }

  /** Deliver everything after the watermarks (single-flight per workspace). */
  catchUp(workspaceId: string): Promise<void> {
    const current = this.running.get(workspaceId)
    if (current) {
      this.again.add(workspaceId)
      return current
    }
    const run = (async () => {
      do {
        this.again.delete(workspaceId)
        await this.pass(workspaceId)
      } while (this.again.has(workspaceId))
    })().finally(() => this.running.delete(workspaceId))
    this.running.set(workspaceId, run)
    return run
  }

  private async pass(workspaceId: string): Promise<void> {
    const state = this.states.get(workspaceId)
    if (!state || this.closed) return
    const limit = this.options.batchSize ?? 500
    let failed = false
    // Each sink reads from its own watermark: one failing sink never blocks
    // or duplicates delivery to the others.
    for (const [index, sink] of this.options.sinks.entries()) {
      try {
        for (;;) {
          const after = state.watermarks[index]!
          const events = await this.options.store.listEvents(workspaceId, { afterSequence: after, limit })
          if (events.length === 0) break
          await sink(events)
          state.watermarks[index] = events[events.length - 1]!.sequence ?? after
          if (events.length < limit || this.closed) break
        }
      } catch (error) {
        failed = true
        this.options.onError?.(error)
      }
    }
    if (failed) this.scheduleRetry(workspaceId, state)
    else state.failures = 0
  }

  private scheduleRetry(workspaceId: string, state: WorkspaceRelayState): void {
    if (this.closed || state.timer) return
    state.failures += 1
    const delay = Math.min((this.options.retryBaseMs ?? 500) * 2 ** (state.failures - 1), this.options.retryMaxMs ?? 30_000)
    state.timer = setTimeout(() => {
      state.timer = null
      void this.catchUp(workspaceId)
    }, delay)
    ;(state.timer as { unref?: () => void }).unref?.()
  }
}
