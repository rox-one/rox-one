import { describe, expect, it } from 'bun:test'
import { PendingInvokeTracker } from '../pending-invokes.ts'

/** Inert timers + a caller-owned clock: `sweep(at)` is the only thing that expires. */
function fixture(options: { maxPerNode?: number; timeoutMs?: number } = {}) {
  let now = 1_000
  const tracker = new PendingInvokeTracker({
    maxPerNode: options.maxPerNode ?? 2,
    timeoutMs: options.timeoutMs ?? 50,
    now: () => now,
    setTimer: () => 0,
    clearTimer: () => {},
  })
  return { tracker, advance: (ms: number) => { now += ms }, at: () => now }
}

describe('PendingInvokeTracker — exactly-once terminal results', () => {
  it('resolve settles ok exactly once', async () => {
    const { tracker } = fixture()
    const created = tracker.create('n1', 'ping')
    expect(created.ok).toBe(true)
    if (!created.ok) return

    expect(tracker.resolve(created.handle.invokeId, { pong: true })).toBe(true)
    expect(await created.handle.result).toMatchObject({ status: 'ok', payload: { pong: true } })

    // Every later settlement is a no-op.
    expect(tracker.resolve(created.handle.invokeId, { pong: false })).toBe(false)
    expect(tracker.fail(created.handle.invokeId, { code: 'X', message: 'x' })).toBe(false)
    expect(tracker.cancel(created.handle.invokeId)).toBe(false)
    expect(tracker.expire(created.handle.invokeId)).toBe(false)
    expect(tracker.size).toBe(0)
  })

  it('cancel is deterministic and settles error/CANCELLED exactly once', async () => {
    const { tracker } = fixture()
    const created = tracker.create('n1', 'ping')
    if (!created.ok) throw new Error('expected acceptance')

    expect(tracker.cancel(created.handle.invokeId)).toBe(true)
    expect(await created.handle.result).toMatchObject({ status: 'error', error: { code: 'CANCELLED' } })
    expect(tracker.cancel(created.handle.invokeId)).toBe(false)
    expect(tracker.resolve(created.handle.invokeId, null)).toBe(false)
  })

  it('sweep settles exactly the invokes whose deadline passed', async () => {
    const { tracker, advance, at } = fixture({ timeoutMs: 50 })
    const early = tracker.create('n1', 'ping')
    if (!early.ok) throw new Error('expected acceptance')

    advance(50)
    const late = tracker.create('n1', 'pong', { timeoutMs: 50 })
    if (!late.ok) throw new Error('expected acceptance')

    // `early` deadline is at; `late` deadline is at + 50.
    expect(tracker.sweep(at())).toEqual([early.handle.invokeId])
    expect(await early.handle.result).toMatchObject({ status: 'timeout' })
    expect(tracker.pendingCountFor('n1')).toBe(1)

    advance(50)
    expect(tracker.sweep(at())).toEqual([late.handle.invokeId])
    expect(await late.handle.result).toMatchObject({ status: 'timeout' })
    expect(tracker.sweep(at())).toEqual([])
  })

  it('enforces the per-node bound and refuses with QUEUE_FULL', () => {
    const { tracker } = fixture({ maxPerNode: 1 })
    expect(tracker.create('n1', 'ping').ok).toBe(true)
    const refused = tracker.create('n1', 'ping')
    expect(refused.ok).toBe(false)
    if (refused.ok) return
    expect(refused.error.code).toBe('QUEUE_FULL')

    // A different node has its own budget.
    expect(tracker.create('n2', 'ping').ok).toBe(true)
  })

  it('failForNode settles every in-flight invoke for the node only', async () => {
    const { tracker } = fixture({ maxPerNode: 3 })
    const a = tracker.create('n1', 'ping')
    const b = tracker.create('n1', 'ping')
    const c = tracker.create('n2', 'ping')
    if (!a.ok || !b.ok || !c.ok) throw new Error('expected acceptance')

    expect(tracker.failForNode('n1', { code: 'DISCONNECTED', message: 'gone' })).toBe(2)
    expect(await a.handle.result).toMatchObject({ status: 'error', error: { code: 'DISCONNECTED' } })
    expect(await b.handle.result).toMatchObject({ status: 'error', error: { code: 'DISCONNECTED' } })
    expect(tracker.pendingCountFor('n2')).toBe(1)
    expect(tracker.resolve(c.handle.invokeId, 1)).toBe(true)
  })
})