import { describe, expect, it } from 'bun:test'
import { keepSubscriptionAfterResolve } from '../use-im-relay'

describe('keepSubscriptionAfterResolve (late subscribe)', () => {
  it('keeps when still desired and active', () => {
    expect(keepSubscriptionAfterResolve('c1', new Set(['c1', 'c2']), new Set(['c1']))).toBe(true)
  })

  it('drops when removed from desired while subscribe in flight', () => {
    // Optimistic active still has c1; desired no longer does → must unsubscribe on resolve.
    expect(keepSubscriptionAfterResolve('c1', new Set(['c2']), new Set(['c1']))).toBe(false)
  })

  it('drops when unmount/live=false cleared active and desired', () => {
    expect(keepSubscriptionAfterResolve('c1', new Set(), new Set())).toBe(false)
  })

  it('drops when active was cleared but desired briefly still lists id', () => {
    expect(keepSubscriptionAfterResolve('c1', new Set(['c1']), new Set())).toBe(false)
  })
})
