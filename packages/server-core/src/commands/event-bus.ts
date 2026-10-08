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
  ProjectorError,
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
  /**
   * A projector threw (tagged `ProjectorError`). The event is still published
   * through the ids-only default projection (subject topic → refetch).
   * Defaults to `onListenerError`.
   */
  onProjectorError?: (error: ProjectorError, event: DomainEvent) => void
}

export class InProcessEventBus {
  readonly projections: EventProjectionRegistry
  private readonly logs = new Map<string, TopicLog>()
  private readonly listeners = new Set<EventBusListener>()
  private readonly options: InProcessEventBusOptions
  /** Base sequencer epoch; a workspace log recreated after an idle drop gets `${epoch}~${n}`. */
  readonly epoch: string
  /** Bumped whenever idle logs are dropped, so a recreated log never reuses an epoch. */
  private generation = 0

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
        epoch: this.generation === 0 ? this.epoch : `${this.epoch}~${this.generation}`,
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
      const log = this.log(event.workspaceId)
      // Event-level dedupe: a redelivered event (already sequenced in this log)
      // is skipped as a whole, so none of its frames gets a second seq.
      if (event.eventId && !log.claimEvent(event.eventId)) continue
      // Each projector is isolated inside project(); a throwing one is reported
      // and replaced by the ids-only default projection (clients refetch). The
      // outer guard only protects the stream against a broken registry.
      let publications: Array<ReturnType<EventProjectionRegistry['project']>[number]>
      try {
        publications = this.projections.project(event, error => this.reportProjectorError(error, event))
      } catch (error) {
        this.reportProjectorError(error instanceof ProjectorError ? error : new ProjectorError(event, error), event)
        continue
      }
      for (const publication of publications) {
        const frame = log.append(publication.topic, {
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

  private reportProjectorError(error: ProjectorError, event: DomainEvent): void {
    try {
      if (this.options.onProjectorError) this.options.onProjectorError(error, event)
      else this.options.onListenerError?.(error)
    } catch { /* reporting must not break publishing */ }
  }

  /** Sequencer epoch of a workspace's current log (frames, replays and cursors use it). */
  epochOf(workspaceId: string): string {
    return this.log(workspaceId).epoch
  }

  subscribe(listener: EventBusListener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  latest(workspaceId: string, topic: string): number {
    return this.logs.get(workspaceId)?.latest(topic) ?? 0
  }

  /**
   * Evict idle replay windows and remembered event ids in every workspace log,
   * then drop logs with nothing left (hosts call this on a timer). A dropped
   * workspace starts a new log with a new epoch on its next event, so held
   * positions resolve to `snapshot_required` rather than silent duplicates.
   */
  evictIdle(): number {
    let evicted = 0
    let dropped = false
    for (const [workspaceId, log] of this.logs) {
      evicted += log.evictIdle()
      if (log.isIdle()) {
        this.logs.delete(workspaceId)
        dropped = true
      }
    }
    if (dropped) this.generation += 1
    return evicted
  }

  /** Workspace logs currently held (diagnostics, tests). */
  logCount(): number {
    return this.logs.size
  }

  /** Remembered event ids of one workspace (diagnostics, tests). */
  claimedEventCount(workspaceId: string): number {
    return this.logs.get(workspaceId)?.claimedCount() ?? 0
  }

  /** Retained replay windows of one workspace (diagnostics, tests). */
  windowCount(workspaceId: string): number {
    return this.logs.get(workspaceId)?.windowCount() ?? 0
  }

  replay(workspaceId: string, topic: string, sinceSeq: number, epoch?: string): TopicReplay {
    return this.log(workspaceId).replay(topic, sinceSeq, epoch)
  }
}
