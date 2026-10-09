/**
 * Realtime voice session lifecycle: connect → ready → retry-wait → terminal,
 * with a bounded pending-audio queue that survives a reconnect.
 *
 * The bridge never talks to a provider itself — it owns the states, the retry
 * policy and the queue; a transport adapter (see `realtime-providers/openai.ts`)
 * performs the wire handshake. Audio produced while the socket is not ready is
 * queued (bounded) and drained on `ready`; queued frames older than the TTL are
 * pruned. The TTL bounds queued frames only: a session has no lifetime cap and
 * ends solely via `close()` or exhausted retries.
 *
 * Provenance: OpenClaw `src/talk/realtime-session-lifecycle.ts`,
 * `src/talk/provider-types.ts` (clean-room re-expression; ledger d1.3).
 */

import type { RealtimeVoiceBridge, RealtimeVoiceBridgeCallbacks, RealtimeVoiceBridgeConfig } from './realtime-bridge-types.ts'

export type RealtimeVoiceSessionState = 'idle' | 'connecting' | 'ready' | 'retry-wait' | 'terminal'

/** Every legal state edge. Terminal is absorbing; the table is the CI guard. */
export const REALTIME_SESSION_TRANSITIONS: Record<RealtimeVoiceSessionState, readonly RealtimeVoiceSessionState[]> = {
  idle: ['connecting', 'terminal'],
  connecting: ['ready', 'retry-wait', 'terminal'],
  ready: ['retry-wait', 'terminal'],
  'retry-wait': ['connecting', 'terminal'],
  terminal: [],
}

export function canTransitionRealtimeSession(from: RealtimeVoiceSessionState, to: RealtimeVoiceSessionState): boolean {
  return REALTIME_SESSION_TRANSITIONS[from].includes(to)
}

export const REALTIME_AUDIO_QUEUE_MAX_CHUNKS = 320
export const REALTIME_AUDIO_QUEUE_MAX_BYTES = 1024 * 1024
/** Queued-frame TTL (not a session lifetime): frames older than this are pruned. */
export const REALTIME_AUDIO_QUEUE_TTL_MS = 30 * 60 * 1000

export interface RealtimeAudioChunk {
  data: Uint8Array
  enqueuedAt: number
}

export type RealtimeAudioDropReason = 'chunk-too-large' | 'queue-full'

export interface RealtimeAudioQueueResult {
  accepted: boolean
  /** Chunks evicted by the cap to admit this frame. */
  dropped: number
  reason?: RealtimeAudioDropReason
}

export interface RealtimeVoiceAudioQueue {
  readonly size: number
  readonly bytes: number
  readonly droppedChunks: number
  readonly droppedBytes: number
  enqueue(chunk: Uint8Array, at?: number): RealtimeAudioQueueResult
  /** Prune expired frames, then remove and return every remaining frame in order. */
  drain(now?: number): Uint8Array[]
  /** Drop frames older than the TTL; returns how many were removed. */
  prune(now: number): number
  snapshot(): { chunks: number; bytes: number; oldestAt: number | null }
}

/**
 * FIFO queue capped at `maxChunks` frames and `maxBytes` bytes. Overflow evicts
 * the oldest frames (drop-oldest) and counts them; a frame larger than the whole
 * byte budget is rejected outright rather than evicting the entire queue.
 */
export function createRealtimeVoiceAudioQueue(options: {
  maxChunks?: number
  maxBytes?: number
  ttlMs?: number
} = {}): RealtimeVoiceAudioQueue {
  const maxChunks = options.maxChunks ?? REALTIME_AUDIO_QUEUE_MAX_CHUNKS
  const maxBytes = options.maxBytes ?? REALTIME_AUDIO_QUEUE_MAX_BYTES
  const ttlMs = options.ttlMs ?? REALTIME_AUDIO_QUEUE_TTL_MS
  let chunks: RealtimeAudioChunk[] = []
  let bytes = 0
  let droppedChunks = 0
  let droppedBytes = 0

  const prune = (now: number): number => {
    const kept: RealtimeAudioChunk[] = []
    let removed = 0
    for (const chunk of chunks) {
      if (now - chunk.enqueuedAt >= ttlMs) {
        removed += 1
        bytes -= chunk.data.byteLength
        droppedChunks += 1
        droppedBytes += chunk.data.byteLength
      } else {
        kept.push(chunk)
      }
    }
    chunks = kept
    return removed
  }

  return {
    get size() { return chunks.length },
    get bytes() { return bytes },
    get droppedChunks() { return droppedChunks },
    get droppedBytes() { return droppedBytes },
    enqueue(chunk, at = Date.now()) {
      if (!chunk.byteLength) return { accepted: false, dropped: 0, reason: 'chunk-too-large' }
      if (chunk.byteLength > maxBytes) return { accepted: false, dropped: 0, reason: 'chunk-too-large' }
      let dropped = 0
      while (chunks.length > 0 && (chunks.length + 1 > maxChunks || bytes + chunk.byteLength > maxBytes)) {
        const evicted = chunks.shift()!
        bytes -= evicted.data.byteLength
        dropped += 1
        droppedChunks += 1
        droppedBytes += evicted.data.byteLength
      }
      chunks.push({ data: chunk, enqueuedAt: at })
      bytes += chunk.byteLength
      return { accepted: true, dropped }
    },
    drain(now = Date.now()) {
      prune(now)
      const drained = chunks.map((chunk) => chunk.data)
      chunks = []
      bytes = 0
      return drained
    },
    prune,
    snapshot() {
      return { chunks: chunks.length, bytes, oldestAt: chunks.length ? chunks[0]!.enqueuedAt : null }
    },
  }
}

export interface RealtimeSessionSnapshot {
  sessionId: string
  state: RealtimeVoiceSessionState
  seq: number
  attempt: number
  error?: string
  nextRetryAt?: number
}

export type RealtimeSendResult = { action: 'sent' | 'queued' | 'dropped'; dropped: number }

export type RealtimeTimerCancel = () => void
export type RealtimeTimerScheduler = (callback: () => void, ms: number) => RealtimeTimerCancel

const defaultScheduler: RealtimeTimerScheduler = (callback, ms) => {
  const timer = setTimeout(callback, ms)
  if (typeof timer === 'object' && 'unref' in timer) timer.unref()
  return () => clearTimeout(timer)
}

export interface RealtimeVoiceSessionLifecycleOptions {
  sessionId: string
  /** Attempts before the machine settles in `terminal`. Default 5. */
  maxAttempts?: number
  baseDelayMs?: number
  maxDelayMs?: number
  /** When omitted, connect timeouts are never armed (the caller drives `fail`). */
  connectTimeoutMs?: number
  now?: () => number
  schedule?: RealtimeTimerScheduler
  onChange?: (snapshot: RealtimeSessionSnapshot) => void
  queue?: RealtimeVoiceAudioQueue
}

/**
 * State machine + pending-audio queue for one realtime session.
 *
 * `connect` enters `connecting` and arms a connect timeout; `markReady` promotes
 * to `ready` and drains queued audio; `fail` either schedules a backoff retry
 * (`retry-wait` → `connecting`) or, past `maxAttempts`, settles in `terminal`.
 */
export class RealtimeVoiceSessionLifecycle {
  private state: RealtimeVoiceSessionState = 'idle'
  private seq = 0
  private attempt = 0
  private error: string | undefined
  private nextRetryAt: number | undefined
  private cancelTimer: RealtimeTimerCancel | undefined
  readonly queue: RealtimeVoiceAudioQueue
  private readonly now: () => number
  private readonly schedule: RealtimeTimerScheduler
  private readonly onChange: ((snapshot: RealtimeSessionSnapshot) => void) | undefined
  private readonly maxAttempts: number
  private readonly baseDelayMs: number
  private readonly maxDelayMs: number
  private readonly connectTimeoutMs: number | undefined

  constructor(private readonly options: RealtimeVoiceSessionLifecycleOptions) {
    this.now = options.now ?? Date.now
    this.schedule = options.schedule ?? defaultScheduler
    this.onChange = options.onChange
    this.maxAttempts = options.maxAttempts ?? 5
    this.baseDelayMs = options.baseDelayMs ?? 500
    this.maxDelayMs = options.maxDelayMs ?? 8_000
    this.connectTimeoutMs = options.connectTimeoutMs
    this.queue = options.queue ?? createRealtimeVoiceAudioQueue()
  }

  snapshot(): RealtimeSessionSnapshot {
    return {
      sessionId: this.options.sessionId,
      state: this.state,
      seq: this.seq,
      attempt: this.attempt,
      ...(this.error === undefined ? {} : { error: this.error }),
      ...(this.nextRetryAt === undefined ? {} : { nextRetryAt: this.nextRetryAt }),
    }
  }

  /** Connect timeout for the given attempt, or the base delay when unset. */
  retryDelayMs(attempt: number = this.attempt): number {
    return Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** Math.max(0, attempt - 1))
  }

  connect(): RealtimeSessionSnapshot {
    if (!canTransitionRealtimeSession(this.state, 'connecting')) return this.snapshot()
    this.clearTimer()
    this.error = undefined
    this.nextRetryAt = undefined
    this.transition('connecting')
    if (this.connectTimeoutMs !== undefined) {
      this.cancelTimer = this.schedule(() => { if (this.state === 'connecting') this.fail('connect-timeout') }, this.connectTimeoutMs)
    }
    return this.snapshot()
  }

  markReady(): RealtimeSessionSnapshot {
    if (!canTransitionRealtimeSession(this.state, 'ready')) return this.snapshot()
    this.clearTimer()
    this.error = undefined
    this.nextRetryAt = undefined
    this.transition('ready')
    return this.snapshot()
  }

  fail(error: unknown): RealtimeSessionSnapshot {
    if (this.state !== 'connecting' && this.state !== 'ready') return this.snapshot()
    this.clearTimer()
    this.attempt += 1
    this.error = error instanceof Error ? error.message : String(error)
    if (this.attempt >= this.maxAttempts) {
      this.transition('terminal')
      return this.snapshot()
    }
    this.nextRetryAt = this.now() + this.retryDelayMs()
    this.transition('retry-wait')
    this.cancelTimer = this.schedule(() => this.connect(), this.retryDelayMs())
    return this.snapshot()
  }

  close(reason?: string): RealtimeSessionSnapshot {
    if (this.state === 'terminal') return this.snapshot()
    this.clearTimer()
    this.error = reason
    this.nextRetryAt = undefined
    this.transition('terminal')
    return this.snapshot()
  }

  /** Queue while not ready; the caller flushes `drainPending()` once ready. */
  sendAudio(chunk: Uint8Array, at: number = this.now()): RealtimeSendResult {
    if (this.state === 'terminal') return { action: 'dropped', dropped: 0 }
    if (this.state === 'ready') return { action: 'sent', dropped: 0 }
    const result = this.queue.enqueue(chunk, at)
    return { action: result.accepted ? 'queued' : 'dropped', dropped: result.dropped }
  }

  drainPending(now: number = this.now()): Uint8Array[] {
    return this.queue.drain(now)
  }

  private transition(next: RealtimeVoiceSessionState): void {
    this.state = next
    this.seq += 1
    this.onChange?.(this.snapshot())
  }

  private clearTimer(): void {
    this.cancelTimer?.()
    this.cancelTimer = undefined
  }
}

export type { RealtimeVoiceBridge, RealtimeVoiceBridgeCallbacks, RealtimeVoiceBridgeConfig }