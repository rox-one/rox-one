import { describe, expect, test } from 'bun:test'
import { MeetingRequestTracker } from '../request-state'

describe('committed meeting request ownership', () => {
  test('coalesces duplicate writes while unrelated work remains independent', () => {
    const tracker = new MeetingRequestTracker()
    expect(tracker.begin('plan')).toBeNull()
    tracker.setScope('a')
    const first = tracker.begin('plan', 'a')!
    expect(tracker.begin('plan', 'a')).toBeNull()
    expect(tracker.begin('record', 'a')).not.toBeNull()
    expect(first.finish()).toBe(true)
    expect(tracker.isPending('plan')).toBe(false)
    expect(tracker.isPending('record')).toBe(true)
  })
  test('A → B → A and disposal never revive an old visit', () => {
    const tracker = new MeetingRequestTracker()
    tracker.setScope('a')
    const old = tracker.begin('plan')!
    tracker.setScope('b'); tracker.setScope('a')
    const current = tracker.begin('plan')!
    expect(old.isCurrent()).toBe(false)
    expect(old.finish()).toBe(false)
    expect(current.isCurrent()).toBe(true)
    tracker.setScope(undefined)
    expect(current.isCurrent()).toBe(false)
    expect(tracker.begin('plan', 'a')).toBeNull()
  })
  test('a foreign old callback cannot cancel a current latest read', () => {
    const tracker = new MeetingRequestTracker()
    tracker.setScope('b')
    const current = tracker.beginLatest('update:one', 'b')!
    expect(tracker.beginLatest('update:one', 'a')).toBeNull()
    expect(current.isCurrent()).toBe(true)
    const newer = tracker.beginLatest('update:one', 'b')!
    expect(current.isCurrent()).toBe(false)
    expect(current.finish()).toBe(false)
    expect(newer.isCurrent()).toBe(true)
  })
  test('finishing rejected work permits retry without clearing a later owner', () => {
    const tracker = new MeetingRequestTracker()
    tracker.setScope(null)
    const first = tracker.begin('import')!
    expect(first.finish()).toBe(true)
    const retry = tracker.begin('import')!
    expect(first.finish()).toBe(false)
    expect(retry.isCurrent()).toBe(true)
    tracker.cancelAll()
    expect(retry.isCurrent()).toBe(false)
  })
})
