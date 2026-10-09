/**
 * Queue-steering policy tests (row f.4) — locks the exact semantics ported from
 * OpenClaw's `steer | followup | collect | interrupt` queue modes:
 * per-session lane serialization, global-lane fairness, coalescing, steering
 * delivery and deterministic interrupt preemption.
 *
 * The lane drains synchronously up to its first await, so a task is "active"
 * the moment it is submitted; tests await the real `whenIdle` / `runGlobal`
 * promises instead of guessing durations.
 */

import { describe, expect, it } from 'bun:test'
import { planSteeringSubmit, QueueSteering } from '../queue-steering'

function gate(): { promise: Promise<void>; open: () => void } {
  let open!: () => void
  const promise = new Promise<void>((resolve) => { open = resolve })
  return { promise, open }
}

describe('QueueSteering — per-session lane', () => {
  it('serializes two concurrent sends and preserves submission order', async () => {
    const order: string[] = []
    const first = gate()
    const queue = new QueueSteering(async (task) => {
      order.push(`start:${task.text}`)
      if (task.text === 'A') await first.promise
      order.push(`end:${task.text}`)
    })

    const a = queue.submitSession('s1', 'followup', 'A', 'a')
    const b = queue.submitSession('s1', 'followup', 'B', 'b')
    expect(a).toMatchObject({ disposition: 'enqueued', dropped: [] })
    expect(b.disposition).toBe('enqueued')

    // Only the first task runs; B waits behind it on the same lane.
    expect(order).toEqual(['start:A'])
    expect(queue.pendingCount('session:s1')).toBe(1)

    first.open()
    await queue.whenIdle('session:s1')
    expect(order).toEqual(['start:A', 'end:A', 'start:B', 'end:B'])
  })

  it('steer delivers into the active run instead of queueing', async () => {
    const drained: string[] = []
    const first = gate()
    const queue = new QueueSteering(async (task, ctx) => {
      if (task.text === 'A') {
        await first.promise
        for (const steered of ctx.drainSteered()) drained.push(steered.text)
      }
    })

    const a = queue.submitSession('s', 'followup', 'A', 'a')
    const steer = queue.submitSession('s', 'steer', 'S', 'st')
    expect(a.disposition).toBe('enqueued')
    expect(steer).toMatchObject({ disposition: 'steered', targetId: 'a' })
    expect(queue.pendingCount('session:s')).toBe(0)

    first.open()
    await queue.whenIdle('session:s')
    expect(drained).toEqual(['S'])
  })

  it('collect coalesces into the trailing pending collect; other verbs break the group', async () => {
    const seen: string[] = []
    const first = gate()
    const queue = new QueueSteering(async (task) => {
      if (task.text === 'run') await first.promise
      seen.push(`${task.verb}:${task.text}`)
    })

    queue.submitSession('s', 'followup', 'run', 'r0')
    const one = queue.submitSession('s', 'collect', 'one', 'c1')
    const two = queue.submitSession('s', 'collect', 'two', 'c2')
    const three = queue.submitSession('s', 'followup', 'three', 'f1')
    const four = queue.submitSession('s', 'collect', 'four', 'c3')

    expect(one.disposition).toBe('enqueued')
    expect(two).toMatchObject({ disposition: 'coalesced', targetId: 'c1' })
    expect(three.disposition).toBe('enqueued')
    // The trailing followup breaks the collect group, so this collect enqueues.
    expect(four.disposition).toBe('enqueued')

    first.open()
    await queue.whenIdle('session:s')
    expect(seen).toEqual(['followup:run', 'collect:one\n\ntwo', 'followup:three', 'collect:four'])
  })

  it('interrupt drops every queued item, reports them in order, and aborts the active run', async () => {
    const order: string[] = []
    const first = gate()
    let aborted = false
    const queue = new QueueSteering(async (task, ctx) => {
      order.push(`run:${task.text}`)
      if (task.text === 'A') {
        await Promise.race([first.promise, ctx.preempted])
        aborted = ctx.signal.aborted
      }
    })

    queue.submitSession('s', 'followup', 'A', 'a')
    queue.submitSession('s', 'followup', 'B', 'b')
    queue.submitSession('s', 'followup', 'C', 'c')

    const interrupt = queue.submitSession('s', 'interrupt', 'D', 'd')
    expect(interrupt.disposition).toBe('preempted')
    expect(interrupt.dropped).toEqual(['b', 'c'])
    expect(interrupt.abortedActiveId).toBe('a')

    await queue.whenIdle('session:s')
    // The aborted run never completes its normal path; the interrupt runs next.
    expect(aborted).toBe(true)
    expect(order).toEqual(['run:A', 'run:D'])
  })
})

describe('QueueSteering — global lane', () => {
  it('serializes cross-session work FIFO', async () => {
    const order: string[] = []
    const first = gate()
    const queue = new QueueSteering(async () => {})

    const g1 = queue.runGlobal(async () => { order.push('g1:start'); await first.promise; order.push('g1:end') })
    const g2 = queue.runGlobal(async () => { order.push('g2') })
    const g3 = queue.runGlobal(async () => { order.push('g3') })

    await Promise.resolve()
    expect(order).toEqual(['g1:start'])

    first.open()
    await Promise.all([g1, g2, g3])
    expect(order).toEqual(['g1:start', 'g1:end', 'g2', 'g3'])
  })

  it('a busy session lane never blocks the global lane (no cross-lane starvation)', async () => {
    const sessionGate = gate()
    let globalRan = false
    const queue = new QueueSteering(async () => { await sessionGate.promise })

    queue.submitSession('s', 'followup', 'blocked', 'b1')
    expect(queue.isActive('session:s')).toBe(true)

    await queue.runGlobal(async () => { globalRan = true })
    expect(globalRan).toBe(true)
    expect(queue.isActive('session:s')).toBe(true)

    sessionGate.open()
    await queue.whenIdle('session:s')
  })
})

describe('planSteeringSubmit — policy kernel', () => {
  it('reports interrupt drops in submission order', () => {
    expect(planSteeringSubmit([{ id: 'x', verb: 'followup' }, { id: 'y', verb: 'collect' }], 'a', 'interrupt'))
      .toEqual({ disposition: 'preempted', droppedIds: ['x', 'y'] })
  })

  it('steers only when a run is active', () => {
    expect(planSteeringSubmit([], 'active-1', 'steer')).toMatchObject({ disposition: 'steered', steerTargetId: 'active-1' })
    expect(planSteeringSubmit([], undefined, 'steer').disposition).toBe('enqueued')
  })

  it('followup never coalesces', () => {
    expect(planSteeringSubmit([{ id: 'x', verb: 'followup' }], undefined, 'followup').disposition).toBe('enqueued')
  })
})