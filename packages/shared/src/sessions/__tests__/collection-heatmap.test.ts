import { describe, expect, it } from 'bun:test'
import type { CollectionSessionMeta } from '../collection-query.ts'
import {
  buildYearHeatmap,
  compareDaySessions,
  heatmapNavigate,
  localDayKey,
  sessionsOnDay,
  sessionDurationMs,
} from '../collection-heatmap.ts'

function meta(partial: Partial<CollectionSessionMeta> & { id: string }): CollectionSessionMeta {
  return { lastMessageAt: 0, createdAt: 0, ...partial }
}

describe('localDayKey', () => {
  it('uses the local calendar day, not UTC ISO', () => {
    const local = new Date(2026, 0, 2, 0, 30, 0)
    const key = localDayKey(local.getTime())
    expect(key).toBe('2026-01-02')
    const iso = local.toISOString().slice(0, 10)
    if (iso !== '2026-01-02') {
      expect(key).not.toBe(iso)
    }
  })
})

describe('buildYearHeatmap', () => {
  it('focuses today and labels every month', () => {
    const now = new Date(2026, 8, 12, 15, 0, 0).getTime()
    const grid = buildYearHeatmap([], 2026, now)
    expect(grid.todayKey).toBe('2026-09-12')
    expect(grid.year).toBe(2026)
    expect(grid.weeks.length).toBeGreaterThanOrEqual(52)
    expect(grid.weeks[0]?.length).toBe(7)
    expect(grid.monthLabels.map((label) => label.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })

  it('pads days outside the year as empty cells', () => {
    const jan1 = new Date(2026, 0, 1)
    const grid = buildYearHeatmap([], 2026, jan1.getTime())
    const leading = grid.weeks[0]?.filter((cell) => !cell.inYear) ?? []
    expect(jan1.getDay()).toBeGreaterThan(0)
    expect(leading.length).toBe(jan1.getDay())
    for (const cell of leading) {
      expect(cell.key).toBeNull()
      expect(cell.count).toBe(0)
      expect(cell.level).toBe(0)
    }
  })

  it('buckets activity on lastMessageAt local day', () => {
    const day = new Date(2026, 5, 15, 18, 0, 0).getTime()
    const other = new Date(2026, 5, 16, 9, 0, 0).getTime()
    const grid = buildYearHeatmap(
      [
        meta({ id: 'a', lastMessageAt: day }),
        meta({ id: 'b', lastMessageAt: day }),
        meta({ id: 'c', lastMessageAt: other }),
        meta({ id: 'd', lastMessageAt: new Date(2025, 5, 15).getTime() }),
      ],
      2026,
      day,
    )
    const cell = grid.weeks.flat().find((c) => c.key === '2026-06-15')
    expect(cell?.count).toBe(2)
    expect(cell?.level).toBeGreaterThan(0)
  })
})

describe('heatmapNavigate', () => {
  it('moves left/right/up/down and wraps year edges', () => {
    expect(heatmapNavigate('2026-01-01', 'left', 2026)).toBe('2026-12-31')
    expect(heatmapNavigate('2026-12-31', 'right', 2026)).toBe('2026-01-01')
    expect(heatmapNavigate('2026-01-10', 'left', 2026)).toBe('2026-01-09')
    expect(heatmapNavigate('2026-01-10', 'right', 2026)).toBe('2026-01-11')
    expect(heatmapNavigate('2026-01-10', 'up', 2026)).toBe('2026-01-03')
    expect(heatmapNavigate('2026-01-10', 'down', 2026)).toBe('2026-01-17')
    expect(heatmapNavigate('2026-01-03', 'up', 2026)).toBe('2026-12-27')
  })
})

describe('sessionsOnDay', () => {
  it('returns only sessions whose activity falls on the local day', () => {
    const day = new Date(2026, 2, 4, 12, 0, 0).getTime()
    const items = [
      meta({ id: 'hit', lastMessageAt: day }),
      meta({ id: 'created-only', lastMessageAt: null, createdAt: day }),
      meta({ id: 'miss', lastMessageAt: new Date(2026, 2, 5, 12, 0, 0).getTime() }),
    ]
    expect(sessionsOnDay(items, '2026-03-04').map((s) => s.id)).toEqual(['hit', 'created-only'])
  })
})

describe('sessionDurationMs / compareDaySessions', () => {
  it('computes duration only when both timestamps exist', () => {
    expect(sessionDurationMs(meta({ id: 'a', createdAt: 1000, lastMessageAt: 4000 }))).toBe(3000)
    expect(sessionDurationMs(meta({ id: 'b', createdAt: 1000, lastMessageAt: null }))).toBeNull()
  })

  it('sorts a day table by messages then id', () => {
    const items = [
      meta({ id: 'b', name: 'Beta', messageCount: 2 }),
      meta({ id: 'a', name: 'Alpha', messageCount: 2 }),
      meta({ id: 'c', name: 'Gamma', messageCount: 9 }),
    ]
    const sorted = [...items].sort((x, y) => compareDaySessions(x, y, 'messages', 'desc'))
    expect(sorted.map((s) => s.id)).toEqual(['c', 'a', 'b'])
  })

  it('sorts a day table by createdAt with nulls last on asc', () => {
    const items = [
      meta({ id: 'none', createdAt: null }),
      meta({ id: 'late', createdAt: 200 }),
      meta({ id: 'early', createdAt: 100 }),
    ]
    const sorted = [...items].sort((x, y) => compareDaySessions(x, y, 'createdAt', 'asc'))
    expect(sorted.map((s) => s.id)).toEqual(['early', 'late', 'none'])
  })
})

describe('2000-session heatmap', () => {
  it('buckets 2000 sessions onto a year grid in local days', () => {
    const now = new Date(2026, 8, 12, 15, 0, 0).getTime()
    const sessions = Array.from({ length: 2000 }, (_, i) => {
      const day = new Date(2026, 0, 1 + (i % 365), 12, 0, 0).getTime()
      return meta({ id: `s${i}`, lastMessageAt: day, createdAt: day - 60_000, messageCount: i % 10 })
    })
    const started = performance.now()
    const grid = buildYearHeatmap(sessions, 2026, now)
    const elapsed = performance.now() - started
    const counted = grid.weeks.flat().reduce((sum, cell) => sum + cell.count, 0)
    expect(grid.todayKey).toBe('2026-09-12')
    expect(grid.weeks.length).toBeGreaterThanOrEqual(52)
    expect(counted).toBe(2000)
    expect(elapsed).toBeLessThan(250)
  })
})
