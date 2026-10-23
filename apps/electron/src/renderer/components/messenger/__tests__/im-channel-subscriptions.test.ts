import { describe, expect, it } from 'bun:test'
import {
  keepSubscriptionAfterResolve,
  lateSubscribeDisposition,
  nextSubscriptionActions,
} from '../use-im-relay'

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

describe('lateSubscribeDisposition (shared refcount)', () => {
  it('activates when this attempt still owns the pending slot', () => {
    expect(lateSubscribeDisposition(3, 3)).toBe('activate')
  })

  it('unsubscribes once when effect cancelled pending before settle (no effect unsub)', () => {
    // Multi subscribe in-flight (gen=1); unfollow deletes pending → then releases bump.
    // Effect must NOT also imUnsubscribe for a still-pending id.
    const pending = new Map<string, number>([['c1', 1]])
    pending.delete('c1') // effect cancel
    expect(lateSubscribeDisposition(1, pending.get('c1'))).toBe('unsubscribe')
  })

  it('unsubscribes when superseded by a newer attempt gen', () => {
    expect(lateSubscribeDisposition(1, 2)).toBe('unsubscribe')
  })

  it('regression: open∩followed unfollow mid-flight → only one multi-path unsub', () => {
    // Both hooks claim c1. Multi starts attempt gen=1 (pending); open holds its own bump.
    const pending = new Map<string, number>([['c1', 1]])
    const multiUnsubs: string[] = []
    // Unfollow / remove from followedIds before settle:
    pending.delete('c1')
    // Effect does not call imUnsubscribe for pending — only then does:
    const d = lateSubscribeDisposition(1, pending.get('c1'))
    expect(d).toBe('unsubscribe')
    if (d === 'unsubscribe') multiUnsubs.push('c1')
    expect(multiUnsubs).toEqual(['c1']) // exactly one; open hook still holds native sub
  })
})

describe('nextSubscriptionActions (live flap)', () => {
  it('live=false unsubscribes active but caller may keep desired ids', () => {
    const r = nextSubscriptionActions(['a', 'b'], new Set(['a', 'b']), false)
    expect(r.subscribe).toEqual([])
    expect(r.unsubscribe.sort()).toEqual(['a', 'b'])
    expect([...r.nextActive]).toEqual([])
  })

  it('live=true after live=false with unchanged desiredKey lists subscribe without optimistic active', () => {
    // Roster set desired while FALLBACK (live=false) → active cleared, desired still [a,b].
    const offline = nextSubscriptionActions(['a', 'b'], new Set(), false)
    expect(offline.subscribe).toEqual([])
    expect([...offline.nextActive]).toEqual([])
    // Relay becomes live without desiredKey change — pending until settle.
    const online = nextSubscriptionActions(['a', 'b'], offline.nextActive, true)
    expect(online.subscribe.sort()).toEqual(['a', 'b'])
    expect(online.unsubscribe).toEqual([])
    expect([...online.nextActive]).toEqual([])
  })

  it('incremental: removing a settled id from desired only unsubs that id', () => {
    const r = nextSubscriptionActions(['a', 'b'], new Set(['a', 'b', 'c']), true)
    expect(r.subscribe).toEqual([])
    expect(r.unsubscribe).toEqual(['c'])
    expect([...r.nextActive].sort()).toEqual(['a', 'b'])
  })

  it('overlapping open+followed desired keeps settled active (no dual-sub churn)', () => {
    const r = nextSubscriptionActions(['open', 'a'], new Set(['open', 'a']), true)
    expect(r.subscribe).toEqual([])
    expect(r.unsubscribe).toEqual([])
    expect([...r.nextActive].sort()).toEqual(['a', 'open'])
  })

  it('skips subscribe for ids already settled active', () => {
    const r = nextSubscriptionActions(['a', 'b'], new Set(['a']), true)
    expect(r.subscribe).toEqual(['b'])
    expect(r.unsubscribe).toEqual([])
    expect([...r.nextActive]).toEqual(['a'])
  })
})
