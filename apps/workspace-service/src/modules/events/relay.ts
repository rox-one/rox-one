/**
 * W1-03 (#1500) — Transactional-outbox relay.
 *
 * After a command commits, the relay reads `domain_event` rows past its
 * per-workspace watermark (sequence order == commit order, see the append
 * lock in the Postgres store) and hands them to the sinks (in-process bus →
 * realtime gateway; optional Valkey). A failed sink keeps the watermark, so
 * the next commit (or `catchUp`) re-delivers; nothing published is ever
 * derived from uncommitted state.
 */

import type { DomainEvent } from '../../../../../packages/core/src/events/index.ts'
import type { CommandStore } from '../../../../../packages/server-core/src/commands/store.ts'

export type DomainEventSink = (events: DomainEvent[]) => void | Promise<void>

export class DomainEventRelay {
  private readonly watermarks = new Map<string, number>()
  private readonly running = new Map<string, Promise<void>>()
  private readonly again = new Set<string>()

  constructor(private readonly options: { store: CommandStore; sinks: DomainEventSink[]; batchSize?: number; onError?: (error: unknown) => void }) {}

  watermark(workspaceId: string): number | undefined {
    return this.watermarks.get(workspaceId)
  }

  /** Executor `publish` hook: the committed events tell where a fresh watermark starts. */
  readonly publish = (events: DomainEvent[]): Promise<void> => {
    const workspaceId = events[0]?.workspaceId
    if (!workspaceId) return Promise.resolve()
    if (!this.watermarks.has(workspaceId)) {
      const first = Math.min(...events.map(event => event.sequence ?? Number.POSITIVE_INFINITY))
      if (Number.isFinite(first)) this.watermarks.set(workspaceId, first - 1)
    }
    return this.catchUp(workspaceId)
  }

  /** Deliver everything after the watermark (single-flight per workspace). */
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
    const limit = this.options.batchSize ?? 500
    for (;;) {
      const after = this.watermarks.get(workspaceId) ?? 0
      const events = await this.options.store.listEvents(workspaceId, { afterSequence: after, limit })
      if (events.length === 0) return
      for (const sink of this.options.sinks) {
        try { await sink(events) } catch (error) { this.options.onError?.(error); return }
      }
      this.watermarks.set(workspaceId, events[events.length - 1]!.sequence ?? after)
      if (events.length < limit) return
    }
  }
}
