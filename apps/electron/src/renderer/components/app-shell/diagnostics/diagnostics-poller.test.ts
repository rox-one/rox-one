import { describe, expect, it } from 'bun:test'
import { createDiagnosticsPoller } from './diagnostics-poller'

function scheduler() {
  const timers = new Map<number, () => void>()
  let next = 0
  return {
    timers,
    setTimer(callback: () => void) { const id = ++next; timers.set(id, callback); return id },
    clearTimer(id: number) { timers.delete(id) },
    tick() { const pending = [...timers.values()]; timers.clear(); pending.forEach(callback => callback()) },
  }
}
async function flush() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }

describe('diagnostics visibility lifecycle', () => {
  it('does no work while closed and schedules only after a visible request settles', async () => {
    const clock = scheduler()
    let calls = 0
    const values: number[] = []
    const poller = createDiagnosticsPoller({
      load: async () => ++calls, onValue: value => values.push(value), onError: () => {},
      intervalMs: 5000, ...clock,
    })
    clock.tick()
    expect(calls).toBe(0)
    expect(clock.timers.size).toBe(0)
    poller.setActive(true)
    await flush()
    expect(values).toEqual([1])
    expect(clock.timers.size).toBe(1)
    poller.setActive(false)
    clock.tick()
    expect(calls).toBe(1)
    expect(clock.timers.size).toBe(0)
    poller.dispose()
  })

  it('cancels active work and ignores a late result after hiding or disposal', async () => {
    const clock = scheduler()
    let settle!: (value: string) => void
    let signal!: AbortSignal
    const values: string[] = []
    const poller = createDiagnosticsPoller({
      load: input => { signal = input; return new Promise<string>(resolve => { settle = resolve }) },
      onValue: value => values.push(value), onError: () => {}, intervalMs: 5000, ...clock,
    })
    poller.setActive(true)
    poller.setActive(false)
    expect(signal.aborted).toBe(true)
    settle('stale')
    await flush()
    expect(values).toEqual([])
    expect(clock.timers.size).toBe(0)
    poller.dispose()
    poller.setActive(true)
    expect(clock.timers.size).toBe(0)
  })

  it('never overlaps requests and resumes once when visible again', async () => {
    const clock = scheduler()
    const resolvers: Array<(value: number) => void> = []
    let calls = 0
    const poller = createDiagnosticsPoller({
      load: () => { calls++; return new Promise<number>(resolve => resolvers.push(resolve)) },
      onValue: () => {}, onError: () => {}, intervalMs: 5000, ...clock,
    })
    poller.setActive(true)
    poller.refresh()
    clock.tick()
    expect(calls).toBe(1)
    poller.setActive(false)
    poller.setActive(true)
    expect(calls).toBe(1)
    resolvers[0]!(1)
    await flush()
    expect(calls).toBe(2)
    poller.dispose()
    resolvers[1]!(2)
    await flush()
    expect(clock.timers.size).toBe(0)
  })
})
