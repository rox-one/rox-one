import { describe, expect, it } from 'bun:test'
import { keepSubscriptionAfterResolve, nextSubscriptionActions } from '../use-im-relay'

describe('keepSubscriptionAfterResolve (late subscribe)', () => {
  it('keeps when still desired and active', () => {
    expect(keepSubscriptionAfterResolve('c1', new Set(['c1', 'c2']), new Set(['c1']))).toBe(true)
  })

  it('drops when removed from desired while subscribe in flight', () => {
    expect(keepSubscriptionAfterResolve('c1', new Set(['c2']), new Set(['c1']))).toBe(false)
  })

  it('drops when unmount cleared active and desired', () => {
    expect(keepSubscriptionAfterResolve('c1', new Set(), new Set())).toBe(false)
  })

  it('drops when active was cleared but desired briefly still lists id', () => {
    expect(keepSubscriptionAfterResolve('c1', new Set(['c1']), new Set())).toBe(false)
  })
})

describe('nextSubscriptionActions (live flap)', () => {
  it('live=false unsubscribes active but caller may keep desired ids', () => {
    const r = nextSubscriptionActions(['a', 'b'], new Set(['a', 'b']), false)
    expect(r.subscribe).toEqual([])
    expect(r.unsubscribe.sort()).toEqual(['a', 'b'])
    expect([...r.nextActive]).toEqual([])
  })

  it('live=true after live=false with unchanged desiredKey subscribes all desired', () => {
    // Roster set desired while FALLBACK (live=false) → active cleared, desired still [a,b].
    const offline = nextSubscriptionActions(['a', 'b'], new Set(), false)
    expect(offline.subscribe).toEqual([])
    expect([...offline.nextActive]).toEqual([])
    // Relay becomes live without desiredKey change.
    const online = nextSubscriptionActions(['a', 'b'], offline.nextActive, true)
    expect(online.subscribe.sort()).toEqual(['a', 'b'])
    expect(online.unsubscribe).toEqual([])
    expect([...online.nextActive].sort()).toEqual(['a', 'b'])
  })

  it('incremental: selecting open channel away from followed set only unsubs that id', () => {
    const r = nextSubscriptionActions(['a', 'b'], new Set(['a', 'b', 'c']), true)
    expect(r.subscribe).toEqual([])
    expect(r.unsubscribe).toEqual(['c'])
    expect([...r.nextActive].sort()).toEqual(['a', 'b'])
  })
})
