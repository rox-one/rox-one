import { describe, expect, it } from 'bun:test'
import { runIdlePreload } from '../idle-preload'

describe('WP7 idle preload', () => {
  it('runs loaders one at a time, each after its own idle callback, and survives failures', async () => {
    const events: string[] = []
    const idle: Array<() => void> = []
    const logged: string[] = []
    const done = runIdlePreload([
      ['a', async () => { events.push('a') }],
      ['b', async () => { events.push('b'); throw new Error('boom') }],
      ['c', async () => { events.push('c') }],
    ], { requestIdle: cb => idle.push(cb), log: m => logged.push(m) })
    for (let i = 0; i < 3; i++) {
      await Promise.resolve()
      expect(idle.length).toBe(1)
      expect(events.length).toBe(i)
      idle.shift()!()
      await new Promise(r => setTimeout(r, 0))
    }
    await done
    expect(events).toEqual(['a', 'b', 'c'])
    expect(logged).toEqual(['[idle-preload] b failed'])
  })
})
