/**
 * W1-03 (#1500) — Per-topic sequencing and `seq` gap recovery (TECH-SPEC §5
 * rules, DATA-MODEL §10 rule 2).
 *
 * `TopicLog` (server side) assigns a strictly increasing `seq` per topic and
 * keeps a bounded replay window. A client that resubscribes with `sinceSeq`
 * gets the missing frames replayed, or `snapshot_required` when the window no
 * longer covers the gap (or the sequencer epoch changed, e.g. restart).
 *
 * `TopicSeqTracker` (client side) detects duplicates and gaps per topic.
 *
 * In production the sequencer is shared through Valkey (`INCR rt:seq:{topic}`);
 * this in-process implementation backs local mode and tests.
 */

import type { RealtimeEventFrame, Topic } from './topics.ts'

export const DEFAULT_TOPIC_REPLAY_CAPACITY = 1000

export type TopicReplay =
  | { kind: 'up_to_date'; latestSeq: number; epoch: string }
  | { kind: 'events'; frames: RealtimeEventFrame[]; latestSeq: number; epoch: string }
  | { kind: 'snapshot_required'; latestSeq: number; epoch: string }

function randomEpoch(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  return cryptoApi?.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2)
}

export interface TopicLogOptions {
  /** Frames retained per topic for replay. */
  capacity?: number
  /** Fixed epoch (tests); default is random per instance. */
  epoch?: string
}

export class TopicLog {
  readonly epoch: string
  private readonly capacity: number
  private readonly seqs = new Map<Topic, number>()
  private readonly windows = new Map<Topic, RealtimeEventFrame[]>()

  constructor(options: TopicLogOptions = {}) {
    this.capacity = Math.max(1, Math.floor(options.capacity ?? DEFAULT_TOPIC_REPLAY_CAPACITY))
    this.epoch = options.epoch ?? randomEpoch()
  }

  latest(topic: Topic): number {
    return this.seqs.get(topic) ?? 0
  }

  /** Assign the next seq and retain the frame for replay. */
  append<P>(topic: Topic, frame: Omit<RealtimeEventFrame<P>, 'seq' | 'epoch' | 'frame' | 'topic'>): RealtimeEventFrame<P> {
    const seq = this.latest(topic) + 1
    this.seqs.set(topic, seq)
    const full: RealtimeEventFrame<P> = { frame: 'event', topic, seq, epoch: this.epoch, ...frame }
    let window = this.windows.get(topic)
    if (!window) {
      window = []
      this.windows.set(topic, window)
    }
    window.push(full as RealtimeEventFrame)
    if (window.length > this.capacity) window.splice(0, window.length - this.capacity)
    return full
  }

  /** Frames after `sinceSeq` (exclusive), or `snapshot_required` when the window can't close the gap. */
  replay(topic: Topic, sinceSeq: number, epoch?: string): TopicReplay {
    const latestSeq = this.latest(topic)
    const base = { latestSeq, epoch: this.epoch }
    if (!Number.isSafeInteger(sinceSeq) || sinceSeq < 0) return { kind: 'snapshot_required', ...base }
    if (epoch !== undefined && epoch !== this.epoch) {
      // Seqs from another epoch mean nothing here; only an empty history is safe.
      return sinceSeq === 0 && latestSeq === 0 ? { kind: 'up_to_date', ...base } : { kind: 'snapshot_required', ...base }
    }
    if (sinceSeq > latestSeq) return { kind: 'snapshot_required', ...base }
    if (sinceSeq === latestSeq) return { kind: 'up_to_date', ...base }
    const window = this.windows.get(topic) ?? []
    const oldest = window[0]?.seq
    if (oldest === undefined || oldest > sinceSeq + 1) return { kind: 'snapshot_required', ...base }
    return { kind: 'events', frames: window.filter(frame => frame.seq > sinceSeq), ...base }
  }

  /** Drop retained frames (keeps seq counters so seqs never repeat within the epoch). */
  trim(topic: Topic): void {
    this.windows.delete(topic)
  }
}

export type SeqAcceptResult = 'apply' | 'duplicate' | 'gap'

/** Client-side per-topic position tracking. */
export class TopicSeqTracker {
  private readonly positions = new Map<Topic, { epoch: string; seq: number }>()

  position(topic: Topic): { epoch: string; seq: number } | undefined {
    return this.positions.get(topic)
  }

  /** Set the position after a subscribe result or a snapshot refetch. */
  reset(topic: Topic, epoch: string, seq: number): void {
    this.positions.set(topic, { epoch, seq })
  }

  forget(topic: Topic): void {
    this.positions.delete(topic)
  }

  /**
   * - `apply`: next in order (position advances);
   * - `duplicate`: already applied (ignore);
   * - `gap`: one or more frames are missing (or the epoch changed): resubscribe with `sinceSeq`.
   */
  accept(frame: Pick<RealtimeEventFrame, 'topic' | 'seq' | 'epoch'>): SeqAcceptResult {
    const current = this.positions.get(frame.topic)
    if (!current) {
      // First frame without a known position: only seq 1 is provably complete.
      if (frame.seq === 1) {
        this.positions.set(frame.topic, { epoch: frame.epoch, seq: 1 })
        return 'apply'
      }
      return 'gap'
    }
    if (current.epoch !== frame.epoch) return 'gap'
    if (frame.seq <= current.seq) return 'duplicate'
    if (frame.seq !== current.seq + 1) return 'gap'
    current.seq = frame.seq
    return 'apply'
  }
}
