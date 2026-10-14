import { describe, expect, it } from 'bun:test'
import { cancelIdlePreload, resetIdlePreloadForTests, runIdlePreload, startIdlePreload } from '../idle-preload'

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

describe('runIdlePreload cancellation and input deferral', () => {
  it('stops scheduling after abort', async () => {
    const ran: string[] = []
    const ac = new AbortController()
    const loaders = ['a', 'b', 'c'].map(n => [n, async () => { ran.push(n); if (n === 'a') ac.abort() }] as const)
    await runIdlePreload(loaders, { requestIdle: cb => cb(), signal: ac.signal, isUserBusy: () => false })
    expect(ran).toEqual(['a'])
  })

  it('re-queues while the user is busy, bounded by maxDeferrals', async () => {
    let idles = 0
    let busy = 3
    const ran: string[] = []
    await runIdlePreload([['x', async () => { ran.push('x') }]], {
      requestIdle: cb => { idles++; cb() },
      isUserBusy: () => busy-- > 0,
    })
    expect(ran).toEqual(['x'])
    expect(idles).toBe(4)

    idles = 0
    await runIdlePreload([['y', async () => { ran.push('y') }]], {
      requestIdle: cb => { idles++; cb() },
      isUserBusy: () => true,
      maxDeferrals: 2,
    })
    expect(idles).toBe(3)
    expect(ran).toEqual(['x', 'y'])
  })
})

describe('startIdlePreload / cancelIdlePreload', () => {
  it('cancel aborts the run and lets a later start run again', async () => {
    resetIdlePreloadForTests()
    let idles = 0
    const requestIdle = () => { idles++ } // never fires: runs park on their first slot
    void startIdlePreload({ requestIdle })
    void startIdlePreload({ requestIdle }) // no-op while started
    expect(idles).toBe(1)
    cancelIdlePreload()
    void startIdlePreload({ requestIdle })
    expect(idles).toBe(2)
    resetIdlePreloadForTests()
  })

  it('a stale caller signal does not abort a later run', async () => {
    resetIdlePreloadForTests()
    const stale = new AbortController()
    const fire: Array<() => void> = []
    void startIdlePreload({ requestIdle: cb => { fire.push(cb) }, signal: stale.signal })
    cancelIdlePreload()
    void startIdlePreload({ requestIdle: cb => { fire.push(cb) }, isUserBusy: () => true, maxDeferrals: 1 })
    stale.abort()
    fire[1]!()
    await Promise.resolve(); await Promise.resolve()
    // Not aborted: the busy run re-queued its slot instead of returning.
    expect(fire.length).toBe(3)
    resetIdlePreloadForTests()
  })
})
