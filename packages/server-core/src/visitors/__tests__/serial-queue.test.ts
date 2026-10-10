/**
 * SerialQueue unit tests (port-matrix row a1.6): concurrent operations must not
 * interleave, and a rejected operation must not stall the queue.
 *
 * Interleaving is observed with microtask yields (no real timers) — the queue's
 * guarantee is that a second operation does not start until the first settles.
 */
import { describe, expect, test } from 'bun:test'
import { SerialQueue } from '../serial-queue.ts'

const yieldOnce = () => Promise.resolve()

describe('SerialQueue', () => {
  test('two concurrent operations never interleave (strict start/end order)', async () => {
    const queue = new SerialQueue()
    const events: string[] = []

    const operation = (name: string) => async () => {
      events.push(`${name}:start`)
      await yieldOnce()
      events.push(`${name}:middle`)
      await yieldOnce()
      events.push(`${name}:end`)
    }

    await Promise.all([queue.enqueue(operation('a')), queue.enqueue(operation('b'))])

    expect(events).toEqual([
      'a:start', 'a:middle', 'a:end',
      'b:start', 'b:middle', 'b:end',
    ])
  })

  test('a rejected operation propagates but does not stall the queue', async () => {
    const queue = new SerialQueue()
    const ran: string[] = []

    const failing = queue.enqueue(() => { throw new Error('boom') })
    const following = queue.enqueue(async () => { ran.push('after'); return 'ok' })

    await expect(failing).rejects.toThrow('boom')
    await expect(following).resolves.toBe('ok')
    expect(ran).toEqual(['after'])
  })

  test('drain resolves once every enqueued operation has settled', async () => {
    const queue = new SerialQueue()
    let done = false
    queue.enqueue(async () => { await yieldOnce(); done = true })
    await queue.drain()
    expect(done).toBe(true)
  })
})