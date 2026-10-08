/** W1-03 (#1500) review 1: idle / LRU eviction of TopicLog replay windows. */
import { describe, expect, test } from 'bun:test'
import { TopicLog } from '../sequence.ts'

const frame = { type: 'system.pinged', payload: {}, eventId: 'e', domainType: 'system.pinged', at: 'now' } as const

describe('TopicLog eviction', () => {
  test('idle windows are evicted after the TTL; seqs continue and old positions get snapshot_required', () => {
    let now = 0
    const log = new TopicLog({ epoch: 'e1', idleTtlMs: 1000, now: () => now })
    log.append('user:a', frame)
    log.append('user:a', frame)
    log.append('user:b', frame)
    expect(log.windowCount()).toBe(2)
    now = 500
    expect(log.replay('user:b', 0).kind).toBe('events') // touch keeps b alive
    now = 1200
    expect(log.evictIdle()).toBe(1) // only a was idle
    expect(log.windowCount()).toBe(1)
    expect(log.replay('user:a', 1, log.epoch)).toMatchObject({ kind: 'snapshot_required', latestSeq: 2 })
    expect(log.replay('user:a', 2, log.epoch)).toMatchObject({ kind: 'up_to_date' })
    expect(log.append('user:a', frame).seq).toBe(3) // counters survive eviction
    expect(log.replay('user:a', 2, log.epoch)).toMatchObject({ kind: 'events', frames: [expect.objectContaining({ seq: 3 })] })
  })

  test('append sweeps idle windows on its own (no host timer needed)', () => {
    let now = 0
    const log = new TopicLog({ epoch: 'e1', idleTtlMs: 1000, now: () => now })
    for (let i = 0; i < 50; i++) log.append(`entity:task:t${i}`, frame)
    now = 5000
    log.append('user:a', frame)
    expect(log.windowCount()).toBe(1)
  })

  test('at most maxWindows windows are kept, least recently used evicted first', () => {
    const log = new TopicLog({ epoch: 'e1', maxWindows: 2 })
    log.append('user:a', frame)
    log.append('user:b', frame)
    log.replay('user:a', 0) // a becomes most recent
    log.append('user:c', frame)
    expect(log.windowCount()).toBe(2)
    expect(log.replay('user:b', 0).kind).toBe('snapshot_required')
    expect(log.replay('user:a', 0).kind).toBe('events')
    expect(log.replay('user:c', 0).kind).toBe('events')
  })
})

describe('TopicLog.claimEvent (review 3: event-level dedupe, ids only)', () => {
  test('an event id is claimed once; a redelivery is refused', () => {
    const log = new TopicLog({ epoch: 'e1' })
    expect(log.claimEvent('ev-1')).toBe(true)
    expect(log.claimEvent('ev-1')).toBe(false)
    expect(log.claimEvent('ev-2')).toBe(true)
    expect(log.claimedCount()).toBe(2)
  })

  test('bounded LRU of ids', () => {
    const log = new TopicLog({ epoch: 'e1', dedupeCapacity: 2 })
    for (const id of ['1', '2', '3']) log.claimEvent(id)
    expect(log.claimedCount()).toBe(2)
    expect(log.claimEvent('3')).toBe(false)
    expect(log.claimEvent('1')).toBe(true) // forgotten
  })

  test('evictIdle releases ids and windows; the log then reports idle', () => {
    let now = 0
    const log = new TopicLog({ epoch: 'e1', idleTtlMs: 1000, now: () => now })
    log.claimEvent('ev-1')
    log.append('user:a', { ...frame, eventId: 'ev-1' })
    expect(log.isIdle()).toBe(false)
    now = 500
    log.evictIdle()
    expect(log.claimedCount()).toBe(1)
    now = 1500
    log.evictIdle()
    expect([log.claimedCount(), log.windowCount()]).toEqual([0, 0])
    expect(log.isIdle()).toBe(true)
    log.replay('user:a', 0) // activity
    expect(log.isIdle()).toBe(false)
  })
})
