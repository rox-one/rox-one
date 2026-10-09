import { describe, expect, it } from 'bun:test'
import {
  REALTIME_SESSION_TRANSITIONS,
  canTransitionRealtimeSession,
  createRealtimeVoiceAudioQueue,
  RealtimeVoiceSessionLifecycle,
  type RealtimeTimerScheduler,
  type RealtimeVoiceSessionState,
} from '../realtime-bridge.ts'

function manualScheduler() {
  const timers: Array<{ fn: () => void; ms: number; cancelled: boolean }> = []
  const schedule: RealtimeTimerScheduler = (fn, ms) => {
    const timer = { fn, ms, cancelled: false }
    timers.push(timer)
    return () => { timer.cancelled = true }
  }
  const nextTimer = () => timers.find((timer) => !timer.cancelled)
  const fire = () => {
    const timer = nextTimer()
    if (!timer) throw new Error('no scheduled timer')
    timer.cancelled = true
    timer.fn()
  }
  return { schedule, fire, nextTimer }
}

describe('realtime session transition table', () => {
  it('declares exactly the legal edges and makes terminal absorbing', () => {
    expect(REALTIME_SESSION_TRANSITIONS.terminal).toEqual([])
    expect(canTransitionRealtimeSession('idle', 'connecting')).toBe(true)
    expect(canTransitionRealtimeSession('idle', 'ready')).toBe(false)
    expect(canTransitionRealtimeSession('connecting', 'retry-wait')).toBe(true)
    expect(canTransitionRealtimeSession('ready', 'retry-wait')).toBe(true)
    expect(canTransitionRealtimeSession('retry-wait', 'connecting')).toBe(true)
    for (const from of Object.keys(REALTIME_SESSION_TRANSITIONS) as RealtimeVoiceSessionState[]) {
      expect(REALTIME_SESSION_TRANSITIONS[from]).not.toContain('idle')
    }
  })
})

describe('realtime session lifecycle', () => {
  it('drives idle → connecting → ready', () => {
    const { schedule } = manualScheduler()
    const lifecycle = new RealtimeVoiceSessionLifecycle({ sessionId: 's', schedule })
    expect(lifecycle.snapshot().state).toBe('idle')
    lifecycle.connect()
    expect(lifecycle.snapshot().state).toBe('connecting')
    lifecycle.markReady()
    expect(lifecycle.snapshot().state).toBe('ready')
    // ready cannot be re-entered
    const seq = lifecycle.snapshot().seq
    lifecycle.markReady()
    expect(lifecycle.snapshot().seq).toBe(seq)
  })

  it('retries with exponential backoff and settles terminal past maxAttempts', () => {
    const { schedule, fire, nextTimer } = manualScheduler()
    let clock = 1_000
    const lifecycle = new RealtimeVoiceSessionLifecycle({
      sessionId: 's', schedule, now: () => clock, maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1_000, connectTimeoutMs: 5_000,
    })
    lifecycle.connect()
    lifecycle.fail('socket closed')
    expect(lifecycle.snapshot().state).toBe('retry-wait')
    expect(lifecycle.snapshot().attempt).toBe(1)
    expect(lifecycle.snapshot().nextRetryAt).toBe(1_100)
    expect(nextTimer()?.ms).toBe(100)
    fire()
    expect(lifecycle.snapshot().state).toBe('connecting')
    lifecycle.fail('again')
    expect(nextTimer()?.ms).toBe(200)
    fire()
    lifecycle.fail('third')
    expect(lifecycle.snapshot().state).toBe('terminal')
    expect(lifecycle.snapshot().attempt).toBe(3)
    // terminal is absorbing
    clock += 10
    lifecycle.connect()
    expect(lifecycle.snapshot().state).toBe('terminal')
  })

  it('turns a connect timeout into a retry', () => {
    const { schedule, fire } = manualScheduler()
    const lifecycle = new RealtimeVoiceSessionLifecycle({ sessionId: 's', schedule, connectTimeoutMs: 250, baseDelayMs: 50 })
    lifecycle.connect()
    fire()
    expect(lifecycle.snapshot().state).toBe('retry-wait')
    expect(lifecycle.snapshot().error).toBe('connect-timeout')
  })

  it('closes to terminal from any live state and never re-opens later', () => {
    const { schedule } = manualScheduler()
    const lifecycle = new RealtimeVoiceSessionLifecycle({ sessionId: 's', schedule })
    lifecycle.connect()
    lifecycle.close('client-close')
    expect(lifecycle.snapshot().state).toBe('terminal')
    lifecycle.fail('late')
    expect(lifecycle.snapshot().attempt).toBe(0)
  })

  it('queues audio while not ready, sends when ready, drops when terminal', () => {
    const { schedule } = manualScheduler()
    const lifecycle = new RealtimeVoiceSessionLifecycle({ sessionId: 's', schedule })
    expect(lifecycle.sendAudio(new Uint8Array([1])).action).toBe('queued')
    lifecycle.connect()
    expect(lifecycle.sendAudio(new Uint8Array([2])).action).toBe('queued')
    lifecycle.markReady()
    expect(lifecycle.sendAudio(new Uint8Array([3])).action).toBe('sent')
    expect(lifecycle.drainPending().map((chunk) => chunk[0])).toEqual([1, 2])
    lifecycle.close()
    expect(lifecycle.sendAudio(new Uint8Array([4])).action).toBe('dropped')
  })
})

describe('bounded realtime audio queue', () => {
  const chunk = (size: number, fill = 1) => new Uint8Array(size).fill(fill)

  it('evicts the oldest frame when the chunk cap is exceeded', () => {
    const queue = createRealtimeVoiceAudioQueue({ maxChunks: 3, maxBytes: 1_000 })
    for (const value of [1, 2, 3, 4]) queue.enqueue(chunk(1, value), 0)
    expect(queue.size).toBe(3)
    expect(queue.droppedChunks).toBe(1)
    expect(queue.drain(1).map((item) => item[0])).toEqual([2, 3, 4])
  })

  it('evicts by byte budget and counts dropped bytes', () => {
    const queue = createRealtimeVoiceAudioQueue({ maxChunks: 100, maxBytes: 10 })
    queue.enqueue(chunk(4, 1), 0)
    queue.enqueue(chunk(4, 2), 0)
    const result = queue.enqueue(chunk(4, 3), 0)
    expect(result.accepted).toBe(true)
    expect(result.dropped).toBe(1)
    expect(queue.bytes).toBe(8)
    expect(queue.droppedBytes).toBe(4)
  })

  it('rejects a single oversized frame instead of flushing the queue', () => {
    const queue = createRealtimeVoiceAudioQueue({ maxChunks: 10, maxBytes: 8 })
    queue.enqueue(chunk(4, 1), 0)
    const result = queue.enqueue(chunk(9, 2), 0)
    expect(result).toEqual({ accepted: false, dropped: 0, reason: 'chunk-too-large' })
    expect(queue.size).toBe(1)
    expect(queue.droppedChunks).toBe(0)
  })

  it('prunes frames past the 30-minute TTL', () => {
    const queue = createRealtimeVoiceAudioQueue({ ttlMs: 1_800_000 })
    queue.enqueue(chunk(2, 1), 0)
    queue.enqueue(chunk(2, 2), 1_799_999)
    expect(queue.prune(1_800_000)).toBe(1)
    expect(queue.size).toBe(1)
    expect(queue.droppedChunks).toBe(1)
    expect(queue.drain(1_800_000).map((item) => item[0])).toEqual([2])
  })
})