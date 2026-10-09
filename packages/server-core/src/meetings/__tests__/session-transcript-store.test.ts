import { describe, expect, test } from 'bun:test'
import { MeetingTranscriptStore } from '../session-transcript-store.ts'

function store(caps: { maxLines?: number; cursorTail?: number; endedMax?: number } = {}) {
  return new MeetingTranscriptStore(caps)
}

describe('bounded observe transcript store (d2.3)', () => {
  test('caps lines per session and signals the eviction', () => {
    const s = store({ maxLines: 3 })
    for (let i = 0; i < 5; i += 1) {
      const result = s.append('sess', { key: `k${i}`, text: `line ${i}`, at: i })
      expect(result.accepted).toBe(true)
    }
    expect(s.lineCount('sess')).toBe(3)
    expect(s.lines('sess').map((line) => line.text)).toEqual(['line 2', 'line 3', 'line 4'])
    const evictions = s.drainEvictions()
    expect(evictions).toHaveLength(2)
    expect(evictions.flatMap((eviction) => eviction.evictedKeys)).toEqual(['k0', 'k1'])
    expect(evictions.every((eviction) => eviction.reason === 'line-cap')).toBe(true)
    expect(s.drainEvictions()).toEqual([])
    expect(s.isEvicted('sess')).toBe(true)
  })

  test('dedupe cursor rejects replayed keys and keeps only the tail', () => {
    const s = store({ cursorTail: 2 })
    expect(s.append('sess', { key: 'a', text: 'a', at: 0 }).accepted).toBe(true)
    expect(s.append('sess', { key: 'b', text: 'b', at: 1 }).accepted).toBe(true)
    expect(s.append('sess', { key: 'c', text: 'c', at: 2 }).accepted).toBe(true)
    expect(s.tailKeys('sess')).toEqual(['b', 'c'])
    expect(s.hasSeen('sess', 'a')).toBe(false)
    expect(s.hasSeen('sess', 'c')).toBe(true)
    const replay = s.append('sess', { key: 'c', text: 'c again', at: 3 })
    expect(replay).toEqual({ accepted: false, duplicate: true })
    expect(s.lineCount('sess')).toBe(3)
  })

  test('keeps at most the configured ended transcripts and signals eviction', () => {
    const s = store({ endedMax: 2 })
    for (const id of ['e1', 'e2', 'e3']) {
      s.append(id, { key: `${id}:0`, text: id, at: 0 })
      s.markEnded(id)
    }
    const evictions = s.drainEvictions()
    expect(evictions).toEqual([
      { sessionId: 'e1', reason: 'ended-cap', evictedKeys: ['e1:0'] },
    ])
    expect(s.lineCount('e1')).toBe(0)
    expect(s.lineCount('e2')).toBe(1)
    expect(s.lineCount('e3')).toBe(1)
    expect(s.lines('e1')).toEqual([])
    expect(s.isEnded('e3')).toBe(true)
  })

  test('ended session rejects new lines; tail cursor filter returns only newer seq', () => {
    const s = store()
    s.append('sess', { key: 'a', text: 'a', at: 0 })
    s.markEnded('sess')
    expect(s.append('sess', { key: 'b', text: 'b', at: 1 })).toEqual({ accepted: false, duplicate: false, code: 'session-ended' })
  })

  test('afterSeq paging exposes lines strictly after the cursor', () => {
    const s = store()
    for (let i = 0; i < 4; i += 1) s.append('sess', { key: `k${i}`, text: `${i}`, at: i })
    expect(s.lines('sess', 1).map((line) => line.seq)).toEqual([2, 3])
    expect(s.lines('sess').map((line) => line.seq)).toEqual([0, 1, 2, 3])
  })
})