import { describe, expect, it } from 'bun:test'
import { pageForeignDiscover, FOREIGN_DISCOVER_PAGE } from '../import-discover.ts'
import { createCoalescedProgress, type ForeignImportProgress } from '../import-progress.ts'
import type { ForeignDiscoverResult, ForeignIndexEntry } from '../import-types.ts'

function entry(i: number): ForeignIndexEntry {
  return { id: `e${i}`, kind: 'claude', sourcePath: `/tmp/${i}`, userTurns: 1 } as ForeignIndexEntry
}

describe('pageForeignDiscover', () => {
  it('a 1000-item scan returns the first page of ≤ 100 with total/hasMore', () => {
    const result: ForeignDiscoverResult = {
      entries: Array.from({ length: 1000 }, (_, i) => entry(i)),
      scannedAt: 1,
      cachePath: '/tmp/cache',
    }
    const page = pageForeignDiscover(result, 0, FOREIGN_DISCOVER_PAGE)
    expect(page.entries.length).toBeLessThanOrEqual(100)
    expect(page.entries.length).toBe(100)
    expect(page.total).toBe(1000)
    expect(page.hasMore).toBe(true)
  })
})

describe('createCoalescedProgress', () => {
  it('emits ≤ 10 events in any 1000ms window during a 1000-session ingest', () => {
    let now = 0
    const timeouts: Array<{ fn: () => void; at: number }> = []
    const clock = {
      now: () => now,
      setTimeout: (fn: () => void, ms: number) => {
        timeouts.push({ fn, at: now + ms })
        return timeouts.length
      },
      clearTimeout: () => {},
    }
    const events: Array<{ at: number; p: ForeignImportProgress }> = []
    const sink = createCoalescedProgress((p) => events.push({ at: now, p }), { hz: 10, clock })
    for (let i = 1; i <= 1000; i++) {
      now = i // 1ms per session
      sink.report({ done: i, total: 1000, phase: 'persist' })
      for (const t of timeouts.splice(0)) if (t.at <= now) t.fn()
    }
    sink.flush()
    for (let start = 0; start <= 1000; start += 50) {
      const windowEvents = events.filter((e) => e.at >= start && e.at < start + 1000)
      expect(windowEvents.length).toBeLessThanOrEqual(10)
    }
  })
})
