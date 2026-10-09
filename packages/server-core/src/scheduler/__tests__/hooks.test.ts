import { describe, expect, it } from 'bun:test'
import { HookRegistry } from '../hooks.ts'

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('HookRegistry', () => {
  it('dispatches listeners in registration order, awaiting each in turn', async () => {
    const registry = new HookRegistry()
    const order: string[] = []
    const entered = deferred()
    const gate = deferred()

    registry.on('build', async () => {
      order.push('first:enter')
      entered.resolve()
      await gate.promise
      order.push('first:exit')
    })
    registry.on('build', () => {
      order.push('second')
    })
    registry.on('build', () => {
      order.push('third')
    })

    const dispatch = registry.emit('build', { id: 1 })
    await entered.promise
    // The second listener must not have started while the first is suspended.
    expect(order).toEqual(['first:enter'])
    gate.resolve()
    const result = await dispatch

    expect(order).toEqual(['first:enter', 'first:exit', 'second', 'third'])
    expect(result.invoked).toBe(3)
    expect(result.failures).toEqual([])
  })

  it('isolates a throwing listener and still runs the rest', async () => {
    const registry = new HookRegistry()
    const order: string[] = []
    registry.on('x', () => {
      order.push('a')
    })
    registry.on('x', () => {
      throw new Error('boom')
    })
    registry.on('x', () => {
      order.push('c')
    })

    const result = await registry.emit('x', undefined)

    expect(order).toEqual(['a', 'c'])
    expect(result.invoked).toBe(3)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]!.index).toBe(1)
  })

  it('only dispatches to the named event and supports unsubscribe', async () => {
    const registry = new HookRegistry()
    const seen: string[] = []
    const off = registry.on('a', () => {
      seen.push('a')
    })
    registry.on('b', () => {
      seen.push('b')
    })
    expect(registry.listenerCount('a')).toBe(1)
    expect(registry.events().sort()).toEqual(['a', 'b'])

    await registry.emit('a', undefined)
    expect(off()).toBe(true)
    expect(registry.listenerCount('a')).toBe(0)
    expect(off()).toBe(false)
    expect(registry.off('a', () => {})).toBe(false)

    await registry.emit('a', undefined)
    await registry.emit('b', undefined)
    expect(seen).toEqual(['a', 'b'])
  })

  it('returns an empty result for events with no listeners', async () => {
    const registry = new HookRegistry()
    const result = await registry.emit('missing', undefined)
    expect(result).toEqual({ event: 'missing', invoked: 0, failures: [] })
  })
})