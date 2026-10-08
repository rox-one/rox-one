/**
 * W1-03 (#1500) — Client realtime subscriber with `seq` gap recovery.
 *
 * Tracks the last applied seq per topic. A frame that skips ahead (gap) is
 * dropped and the topic is resubscribed with `sinceSeq`, so the gateway
 * replays exactly the missing frames; `snapshot_required` (window exceeded,
 * epoch changed) resets the position and asks the host to refetch through
 * the query API. Duplicates are ignored. `resume()` resubscribes everything
 * after a reconnect.
 *
 * While a subscribe request is in flight its topics are *pending*: live frames
 * that overtake the RPC result are buffered and run through the tracker once
 * the result has set the position, so a first event is never dropped.
 */

import {
  REALTIME_RPC,
  TopicSeqTracker,
  type RealtimeEventFrame,
  type RealtimeFrame,
  type RealtimeSubscribeRequest,
  type RealtimeSubscribeResult,
  type RealtimeSubscribeTopicResult,
} from '@rox/core/events'

export interface RealtimeConnection {
  subscribe(request: RealtimeSubscribeRequest): Promise<RealtimeSubscribeResult>
  unsubscribe(topics: string[]): Promise<void>
  onFrame(listener: (frame: RealtimeFrame) => void): () => void
}

/** Minimal WS-RPC client surface (`WsRpcClient` satisfies it). */
export interface RealtimeRpcClient {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
  on(channel: string, callback: (...args: any[]) => void): () => void
}

/** Adapter: the workspace gateway's `realtime:*` channels over a WS-RPC client. */
export function wsRpcRealtimeConnection(client: RealtimeRpcClient, workspaceId: string): RealtimeConnection {
  return {
    subscribe: request => client.invoke(REALTIME_RPC.SUBSCRIBE, workspaceId, request) as Promise<RealtimeSubscribeResult>,
    unsubscribe: async topics => { await client.invoke(REALTIME_RPC.UNSUBSCRIBE, workspaceId, { topics }) },
    onFrame: listener => client.on(REALTIME_RPC.EVENT, (ws: unknown, frame: RealtimeFrame) => {
      if (ws === workspaceId) listener(frame)
    }),
  }
}

export interface RealtimeSubscriberOptions {
  connection: RealtimeConnection
  onEvent: (frame: RealtimeEventFrame) => void
  /** The topic's history can't be replayed: refetch its state, then continue live. */
  onSnapshotRequired?: (topic: string, latestSeq: number) => void
  onForbidden?: (topic: string) => void
  /** The gateway refused the topic because of its per-client topic limit. */
  onLimitExceeded?: (topic: string) => void
  onError?: (error: unknown) => void
}

export class RealtimeSubscriber {
  private readonly tracker = new TopicSeqTracker()
  private readonly topics = new Set<string>()
  private readonly recovering = new Map<string, Promise<void>>()
  private readonly highWater = new Map<string, number>()
  /** Topics with an in-flight subscribe → frames that arrived before its result. */
  private readonly pending = new Map<string, { requests: number; frames: RealtimeFrame[] }>()
  private readonly unlisten: () => void
  private readonly options: RealtimeSubscriberOptions

  constructor(options: RealtimeSubscriberOptions) {
    this.options = options
    this.unlisten = options.connection.onFrame(frame => this.onFrame(frame))
  }

  position(topic: string): { epoch: string; seq: number } | undefined {
    return this.tracker.position(topic)
  }

  subscribed(): string[] {
    return [...this.topics]
  }

  async subscribe(topics: string[]): Promise<RealtimeSubscribeTopicResult[]> {
    // Each requested topic holds exactly one pending slot for this request and
    // releases it exactly once (duplicates in `topics` or in the result can't
    // unbalance the counter of a concurrent request).
    const requested = [...new Set(topics)]
    const request: RealtimeSubscribeRequest = {
      topics: requested.map(topic => {
        const position = this.tracker.position(topic)
        return position ? { topic, sinceSeq: position.seq, epoch: position.epoch } : { topic }
      }),
    }
    for (const topic of requested) {
      const entry = this.pending.get(topic) ?? { requests: 0, frames: [] }
      entry.requests += 1
      this.pending.set(topic, entry)
    }
    const unsettled = new Set(requested)
    const settle = (topic: string): RealtimeFrame[] => (unsettled.delete(topic) ? this.settlePending(topic) : [])
    let result: RealtimeSubscribeResult
    try {
      result = await this.options.connection.subscribe(request)
    } catch (error) {
      for (const topic of requested) settle(topic)
      throw error
    }
    for (const item of result.topics) {
      this.applyResult(item)
      // Frames that overtook the result: replayed ones are now duplicates.
      for (const frame of settle(item.topic)) this.onFrame(frame)
    }
    for (const topic of requested) for (const frame of settle(topic)) this.onFrame(frame)
    return result.topics
  }

  /** Ends one in-flight request for `topic`; returns buffered frames when it was the last. */
  private settlePending(topic: string): RealtimeFrame[] {
    const entry = this.pending.get(topic)
    if (!entry) return []
    entry.requests -= 1
    if (entry.requests > 0) return []
    this.pending.delete(topic)
    return entry.frames
  }

  async unsubscribe(topics: string[]): Promise<void> {
    for (const topic of topics) {
      this.topics.delete(topic)
      this.tracker.forget(topic)
    }
    await this.options.connection.unsubscribe(topics)
  }

  /** Resubscribe all topics from their last positions (after a reconnect). */
  async resume(): Promise<void> {
    if (this.topics.size > 0) await this.subscribe([...this.topics])
  }

  close(): void {
    this.unlisten()
  }

  /** Resolves once in-flight gap recoveries finished (tests). */
  async settled(): Promise<void> {
    while (this.recovering.size > 0) await Promise.all([...this.recovering.values()])
  }

  private applyResult(item: RealtimeSubscribeTopicResult): void {
    this.applyStatus(item)
    if (item.status !== 'subscribed' || !item.frames) return
    for (const frame of item.frames) this.deliver(frame, true)
  }

  private applyStatus(item: RealtimeSubscribeTopicResult): void {
    if (item.status === 'forbidden' || item.status === 'invalid' || item.status === 'limit_exceeded') {
      this.topics.delete(item.topic)
      this.tracker.forget(item.topic)
      if (item.status === 'forbidden') this.options.onForbidden?.(item.topic)
      if (item.status === 'limit_exceeded') this.options.onLimitExceeded?.(item.topic)
      return
    }
    this.topics.add(item.topic)
    if (item.status === 'snapshot_required') {
      this.tracker.reset(item.topic, item.epoch, item.seq)
      this.options.onSnapshotRequired?.(item.topic, item.seq)
      return
    }
    const position = this.tracker.position(item.topic)
    // Fresh subscription: start from the current seq. With a replay, the
    // result's frames advance the position themselves.
    if (!position || position.epoch !== item.epoch) this.tracker.reset(item.topic, item.epoch, item.seq)
  }

  private onFrame(frame: RealtimeFrame): void {
    const pending = this.pending.get(frame.topic)
    if (pending) {
      pending.frames.push(frame)
      return
    }
    if (!this.topics.has(frame.topic)) return
    if (frame.frame === 'snapshot_required') {
      this.tracker.reset(frame.topic, frame.epoch, frame.latestSeq)
      this.options.onSnapshotRequired?.(frame.topic, frame.latestSeq)
      return
    }
    this.deliver(frame, false)
  }

  private deliver(frame: RealtimeEventFrame, fromReplay: boolean): void {
    const verdict = this.tracker.accept(frame)
    if (verdict === 'apply') {
      try { this.options.onEvent(frame) } catch (error) { this.options.onError?.(error) }
      return
    }
    if (verdict !== 'gap' || fromReplay) return
    // Remember the newest seq seen; if the replay does not reach it, recover again.
    this.highWater.set(frame.topic, Math.max(this.highWater.get(frame.topic) ?? 0, frame.seq))
    if (!this.recovering.has(frame.topic)) this.recover(frame.topic, 0)
  }

  private recover(topic: string, attempt: number): void {
    const run = this.subscribe([topic])
      .then(() => {
        const position = this.tracker.position(topic)
        const high = this.highWater.get(topic) ?? 0
        this.recovering.delete(topic)
        if (this.topics.has(topic) && position && position.seq < high && attempt < 3) {
          this.recover(topic, attempt + 1)
        } else {
          this.highWater.delete(topic)
        }
      })
      .catch(error => {
        this.recovering.delete(topic)
        this.options.onError?.(error)
      })
    this.recovering.set(topic, run)
  }
}
