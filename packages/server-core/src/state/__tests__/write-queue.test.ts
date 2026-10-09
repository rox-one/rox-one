import { describe, expect, it } from 'bun:test'
import { createWriteQueue } from '../write-queue.ts'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  const { promise, resolve } = Promise.withResolvers<void>()
  return { promise, resolve }
}

/** Flush pending microtasks deterministically (no wall-clock timers). */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await Promise.resolve()
}

describe('write queue', () => {
  it('runs same-key writers strictly FIFO', async () => {
    const queue = createWriteQueue()
    const order: string[] = []
    const gate = deferred()
    const first = queue.run({ storePath: 'db', keys: ['x'], fn: async () => { order.push('a'); await gate.promise; order.push('a-done') } })
    const second = queue.run({ storePath: 'db', keys: ['x'], fn: () => { order.push('b') } })

    await flushMicrotasks()
    expect(order).toEqual(['a'])
    expect(queue.pendingCount('db')).toBe(1)
    expect(queue.runningCount('db')).toBe(1)

    gate.resolve()
    await Promise.all([first, second])
    expect(order).toEqual(['a', 'a-done', 'b'])
  })

  it('runs disjoint keys concurrently', async () => {
    const queue = createWriteQueue()
    const gate = deferred()
    const started: string[] = []
    const a = queue.run({ storePath: 'db', keys: ['a'], fn: async () => { started.push('a'); await gate.promise } })
    const b = queue.run({ storePath: 'db', keys: ['b'], fn: async () => { started.push('b'); await gate.promise } })

    await flushMicrotasks()
    expect(started.sort()).toEqual(['a', 'b'])
    expect(queue.runningCount('db')).toBe(2)

    gate.resolve()
    await Promise.all([a, b])
  })

  it('never lets a later overlapping waiter bypass an earlier one', async () => {
    const queue = createWriteQueue()
    const gate = deferred()
    const order: string[] = []
    const a = queue.run({ storePath: 'db', keys: ['x'], fn: async () => { order.push('a'); await gate.promise; order.push('a-done') } })
    const b = queue.run({ storePath: 'db', keys: ['x'], fn: () => { order.push('b') } })
    const c = queue.run({ storePath: 'db', keys: ['x'], fn: () => { order.push('c') } })

    await flushMicrotasks()
    gate.resolve()
    await Promise.all([a, b, c])
    expect(order).toEqual(['a', 'a-done', 'b', 'c'])
  })

  it('treats omitted keys as whole-store exclusive', async () => {
    const queue = createWriteQueue()
    const gate = deferred()
    const exclusive = queue.run({ storePath: 'db', fn: async () => { await gate.promise } })
    const keyed = queue.run({ storePath: 'db', keys: ['x'], fn: () => 'keyed' })

    await flushMicrotasks()
    expect(queue.pendingCount('db')).toBe(1)
    gate.resolve()
    expect(await keyed).toBe('keyed')
    await exclusive
  })

  it('does not wedge the drain when a writer rejects', async () => {
    const queue = createWriteQueue()
    const failed = queue.run({ storePath: 'db', keys: ['x'], fn: () => { throw new Error('boom') } })
    const after = queue.run({ storePath: 'db', keys: ['x'], fn: () => 42 })

    await expect(failed).rejects.toThrow('boom')
    expect(await after).toBe(42)
    await queue.whenIdle('db')
  })

  it('abort cancels only waiters, never a running writer', async () => {
    const queue = createWriteQueue()
    const gate = deferred()
    const controller = new AbortController()
    const running = queue.run({ storePath: 'db', keys: ['x'], fn: async () => { await gate.promise; return 'ran' } })
    const waiting = queue.run({ storePath: 'db', keys: ['x'], signal: controller.signal, fn: () => 'waited' })

    await flushMicrotasks()
    controller.abort()
    await expect(waiting).rejects.toThrow(/abort/i)

    gate.resolve()
    expect(await running).toBe('ran')
    await queue.whenIdle('db')
  })

  it('an aborted running writer is not interrupted', async () => {
    const queue = createWriteQueue()
    const gate = deferred()
    const controller = new AbortController()
    const running = queue.run({ storePath: 'db', keys: ['x'], signal: controller.signal, fn: async () => { await gate.promise; return 'ok' } })

    await flushMicrotasks()
    controller.abort()
    gate.resolve()
    expect(await running).toBe('ok')
  })

  it('rejects immediately when the signal is already aborted', async () => {
    const queue = createWriteQueue()
    const controller = new AbortController()
    controller.abort()
    await expect(queue.run({ storePath: 'db', keys: ['x'], signal: controller.signal, fn: () => 1 })).rejects.toThrow(/abort/i)
    expect(queue.pendingCount('db')).toBe(0)
  })

  it('allows a nested run only when explicitly reentrant', async () => {
    const queue = createWriteQueue()
    const result = await queue.run({
      storePath: 'db',
      fn: async () => {
        const inner = await queue.run({ storePath: 'db', reentrant: true, fn: () => 'inner' })
        return `outer:${inner}`
      },
    })
    expect(result).toBe('outer:inner')

    let nestedRan = false
    await queue.run({
      storePath: 'db',
      fn: async () => {
        void queue.run({ storePath: 'db', fn: () => { nestedRan = true } })
        await flushMicrotasks()
        expect(nestedRan).toBe(false)
      },
    })
    await queue.whenIdle('db')
    expect(nestedRan).toBe(true)
  })

  it('keeps independent store lanes independent', async () => {
    const queue = createWriteQueue()
    const gate = deferred()
    const first = queue.run({ storePath: 'a', fn: async () => { await gate.promise } })
    const second = queue.run({ storePath: 'b', keys: ['x'], fn: () => 'b-ran' })

    expect(await second).toBe('b-ran')
    gate.resolve()
    await first
  })
})