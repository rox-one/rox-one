/**
 * W1-03 (#1500) — In-process post-commit event bus.
 *
 * Committed domain events → projections → per-workspace `TopicLog` (seq +
 * replay window) → listeners (local push channel, realtime gateway, Valkey
 * relay). Used by the local bus and by the workspace service; the sequencer
 * epoch changes per process, so clients refetch after a restart.
 */

import {
  EventProjectionRegistry,
  TopicLog,
  type DomainEvent,
  type RealtimeEventFrame,
  type TopicReplay,
} from '@rox/core/events'

export type EventBusListener = (workspaceId: string, frame: RealtimeEventFrame, event: DomainEvent) => void

export interface InProcessEventBusOptions {
  projections?: EventProjectionRegistry
  /** Replay window per topic. */
  capacity?: number
  /** Fixed sequencer epoch (tests). */
  epoch?: string
  /** Idle replay windows are evicted after this long (default 10 min). */
  windowIdleTtlMs?: number
  /** Replay windows retained per workspace (LRU, default 5000). */
  maxWindowsPerWorkspace?: number
  now?: () => Date
  onListenerError?: (error: unknown) => void
}

export class InProcessEventBus {
  readonly projections: EventProjectionRegistry
  private readonly logs = new Map<string, TopicLog>()
  private readonly listeners = new Set<EventBusListener>()
  private readonly options: InProcessEventBusOptions
  readonly epoch: string

  constructor(options: InProcessEventBusOptions = {}) {
    this.options = options
    this.projections = options.projections ?? new EventProjectionRegistry()
    this.epoch = options.epoch ?? new TopicLog().epoch
  }

  private log(workspaceId: string): TopicLog {
    let log = this.logs.get(workspaceId)
    if (!log) {
      const { capacity, windowIdleTtlMs, maxWindowsPerWorkspace, now } = this.options
      log = new TopicLog({
        epoch: this.epoch,
        ...(capacity ? { capacity } : {}),
        ...(windowIdleTtlMs ? { idleTtlMs: windowIdleTtlMs } : {}),
        ...(maxWindowsPerWorkspace ? { maxWindows: maxWindowsPerWorkspace } : {}),
        ...(now ? { now: () => now().getTime() } : {}),
      })
      this.logs.set(workspaceId, log)
    }
    return log
  }

  /** Project and sequence committed events; returns the frames that were published. */
  publish(events: readonly DomainEvent[]): RealtimeEventFrame[] {
    const frames: RealtimeEventFrame[] = []
    for (const event of events) {
      for (const publication of this.projections.project(event)) {
        const frame = this.log(event.workspaceId).append(publication.topic, {
          type: publication.type,
          payload: publication.payload ?? {},
          eventId: event.eventId,
          domainType: event.type,
          at: (this.options.now?.() ?? new Date()).toISOString(),
        })
        frames.push(frame)
        for (const listener of this.listeners) {
          try { listener(event.workspaceId, frame, event) } catch (error) { this.options.onListenerError?.(error) }
        }
      }
    }
    return frames
  }

  subscribe(listener: EventBusListener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  latest(workspaceId: string, topic: string): number {
    return this.logs.get(workspaceId)?.latest(topic) ?? 0
  }

  /** Evict idle replay windows in every workspace log (hosts may call this on a timer). */
  evictIdle(): number {
    let evicted = 0
    for (const log of this.logs.values()) evicted += log.evictIdle()
    return evicted
  }

  /** Retained replay windows of one workspace (diagnostics, tests). */
  windowCount(workspaceId: string): number {
    return this.logs.get(workspaceId)?.windowCount() ?? 0
  }

  replay(workspaceId: string, topic: string, sinceSeq: number, epoch?: string): TopicReplay {
    return this.log(workspaceId).replay(topic, sinceSeq, epoch)
  }
}
