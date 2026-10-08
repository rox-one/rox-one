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
    expect(log.replay('user:a', 1)).toMatchObject({ kind: 'snapshot_required', latestSeq: 2 })
    expect(log.replay('user:a', 2)).toMatchObject({ kind: 'up_to_date' })
    expect(log.append('user:a', frame).seq).toBe(3) // counters survive eviction
    expect(log.replay('user:a', 2)).toMatchObject({ kind: 'events', frames: [expect.objectContaining({ seq: 3 })] })
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

describe('TopicLog.appendOnce (review 2)', () => {
  test('the same (topic, eventId, type) is sequenced once; redelivery returns the original frame', () => {
    const log = new TopicLog({ epoch: 'e1' })
    const first = log.appendOnce('user:a', { ...frame, eventId: 'ev-1' })
    const again = log.appendOnce('user:a', { ...frame, eventId: 'ev-1' })
    expect(first.fresh).toBe(true)
    expect(again).toEqual({ frame: first.frame, fresh: false })
    expect(log.appendOnce('user:b', { ...frame, eventId: 'ev-1' }).frame.seq).toBe(1) // other topic
    expect(log.appendOnce('user:a', { ...frame, eventId: 'ev-1', type: 'system.other' }).frame.seq).toBe(2) // other publication
    expect(log.appendOnce('user:a', { ...frame, eventId: 'ev-2' }).frame.seq).toBe(3)
    expect(log.latest('user:a')).toBe(3)
  })

  test('the dedupe memory is bounded', () => {
    const log = new TopicLog({ epoch: 'e1', dedupeCapacity: 2 })
    log.appendOnce('user:a', { ...frame, eventId: '1' })
    log.appendOnce('user:a', { ...frame, eventId: '2' })
    log.appendOnce('user:a', { ...frame, eventId: '3' })
    expect(log.appendOnce('user:a', { ...frame, eventId: '3' }).fresh).toBe(false)
    expect(log.appendOnce('user:a', { ...frame, eventId: '1' }).fresh).toBe(true) // forgotten
  })
})
