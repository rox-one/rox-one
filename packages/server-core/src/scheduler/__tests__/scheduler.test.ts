import { describe, expect, it } from 'bun:test'
import { CronExpressionError } from '../cron-expr.ts'
import { HostScheduler, type JobRunContext, type SchedulerClock } from '../scheduler.ts'

/** 2026-01-01T00:00:00Z — a UTC minute boundary. */
const EPOCH = Date.UTC(2026, 0, 1, 0, 0, 0)
const MINUTE = 60_000

class FakeClock implements SchedulerClock {
  wall = 0
  mono = 0
  private readonly seq = { value: 0 }
  private current?: { id: number; run: () => void; at: number }

  now = (): number => this.wall
  monotonicNow = (): number => this.mono
  arm = (run: () => void, delayMs: number): (() => void) => {
    const id = ++this.seq.value
    this.current = { id, run, at: this.mono + delayMs }
    return () => {
      if (this.current?.id === id) this.current = undefined
    }
  }

  get armedAt(): number | null {
    return this.current?.at ?? null
  }

  /**
   * Advance wall + monotonic time and run every timer that becomes due,
   * draining microtasks between fires so a job's completion settles (and its
   * next timer re-arms) exactly as it would on the real event loop.
   */
  async advance(ms: number): Promise<void> {
    this.wall += ms
    this.mono += ms
    for (let guard = 0; guard < 10_000; guard += 1) {
      const timer = this.current
      if (!timer || timer.at > this.mono) break
      this.current = undefined
      timer.run()
      for (let microtask = 0; microtask < 12; microtask += 1) await Promise.resolve()
    }
  }
}

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('HostScheduler — coalescing', () => {
  it('advances N missed periods and fires once with missed=N', async () => {
    const clock = new FakeClock()
    const scheduler = new HostScheduler({ clock })
    const runs: JobRunContext[] = []
    scheduler.scheduleEvery({ id: 'beat', everyMs: 1000, run: (ctx) => void runs.push(ctx) })

    await clock.advance(4000)

    expect(runs).toHaveLength(1)
    expect(runs[0]!.missed).toBe(3)
    expect(runs[0]!.scheduledAtMs).toBe(4000)
    expect(runs[0]!.kind).toBe('every')
  })

  it('coalesces missed cron instants into a single run', async () => {
    const clock = new FakeClock()
    clock.wall = EPOCH
    clock.mono = EPOCH
    const scheduler = new HostScheduler({ clock })
    const runs: JobRunContext[] = []
    scheduler.registerCron({ id: 'minute', expression: '* * * * *', run: (ctx) => void runs.push(ctx) })

    await clock.advance(4 * MINUTE)

    expect(runs).toHaveLength(1)
    expect(runs[0]!.missed).toBe(3)
    expect(runs[0]!.scheduledAtMs).toBe(EPOCH + 4 * MINUTE)
  })
})

describe('HostScheduler — drift-free scheduling', () => {
  it('keeps every tick anchored to exact multiples of the period', async () => {
    const clock = new FakeClock()
    const scheduler = new HostScheduler({ clock })
    const scheduled: number[] = []
    scheduler.scheduleEvery({ id: 'beat', everyMs: 1000, run: (ctx) => void scheduled.push(ctx.scheduledAtMs) })

    for (let i = 0; i < 10; i += 1) await clock.advance(1000)

    expect(scheduled).toEqual([1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000])
  })

  it('does not accumulate drift when the host wakes slightly late', async () => {
    const clock = new FakeClock()
    const scheduler = new HostScheduler({ clock })
    const scheduled: number[] = []
    scheduler.scheduleEvery({ id: 'beat', everyMs: 1000, run: (ctx) => void scheduled.push(ctx.scheduledAtMs) })

    for (let i = 0; i < 10; i += 1) await clock.advance(1007)

    // Every fire still lands on an exact period boundary; lateness never compounds.
    expect(scheduled).toEqual([1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000])
  })
})

describe('HostScheduler — shutdown', () => {
  it('stop() is idempotent and no tick fires after close', async () => {
    const clock = new FakeClock()
    const scheduler = new HostScheduler({ clock })
    let runs = 0
    scheduler.scheduleEvery({ id: 'beat', everyMs: 1000, run: () => { runs += 1 } })

    await scheduler.stop()
    await scheduler.stop()

    expect(scheduler.isClosed).toBe(true)
    expect(clock.armedAt).toBeNull()
    await clock.advance(10_000)
    expect(runs).toBe(0)
  })

  it('beginClose() cancels the timer immediately', async () => {
    const clock = new FakeClock()
    const scheduler = new HostScheduler({ clock })
    let runs = 0
    scheduler.scheduleEvery({ id: 'beat', everyMs: 1000, run: () => { runs += 1 } })

    expect(clock.armedAt).not.toBeNull()
    scheduler.beginClose()
    expect(clock.armedAt).toBeNull()
    await clock.advance(5000)
    expect(runs).toBe(0)
  })

  it('stop() awaits an in-flight callback before resolving', async () => {
    const clock = new FakeClock()
    const scheduler = new HostScheduler({ clock })
    const gate = deferred()
    const entered = deferred()
    let finished = false
    scheduler.scheduleOnce({
      id: 'work',
      atMs: 1000,
      run: async () => {
        entered.resolve()
        await gate.promise
        finished = true
      },
    })

    await clock.advance(1000)
    await entered.promise

    let stopped = false
    const stopPromise = scheduler.stop().then(() => {
      stopped = true
    })
    await Promise.resolve()
    expect(stopped).toBe(false)

    gate.resolve()
    await stopPromise
    expect(stopped).toBe(true)
    expect(finished).toBe(true)
  })
})

describe('HostScheduler — cron registration and hooks', () => {
  it('rejects an invalid cron expression with a typed error', () => {
    const scheduler = new HostScheduler({ clock: new FakeClock() })
    expect(() => scheduler.registerCron({ id: 'bad', expression: 'nope', run: () => undefined })).toThrow(
      CronExpressionError,
    )
  })

  it('dispatches the named hook event through the same tick as the job', async () => {
    const clock = new FakeClock()
    clock.wall = EPOCH
    clock.mono = EPOCH
    const scheduler = new HostScheduler({ clock })
    const order: string[] = []
    scheduler.hooks.on('cron:minute', (payload) => {
      order.push(`hook:${(payload as JobRunContext).missed}`)
    })
    scheduler.registerCron({
      id: 'minute',
      expression: '* * * * *',
      event: 'cron:minute',
      run: () => { order.push('run') },
    })

    await clock.advance(2 * MINUTE)

    expect(order).toEqual(['hook:1', 'run'])
  })

  it('rejects a registration after close', () => {
    const scheduler = new HostScheduler({ clock: new FakeClock() })
    scheduler.beginClose()
    expect(() => scheduler.scheduleEvery({ id: 'x', everyMs: 1000, run: () => undefined })).toThrow(
      'scheduler is closed',
    )
  })
})