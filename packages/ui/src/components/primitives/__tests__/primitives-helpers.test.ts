/**
 * W1-08 (#1505) — pure helpers behind the field / social / view primitives.
 */
import { describe, expect, it } from 'bun:test'
import {
  PRIVACY_LEVELS,
  applyReactionToggle,
  availablePrivacyLevels,
  dayKey,
  daysInMonth,
  filterPeople,
  flattenTree,
  formatContextualDate,
  groupByDay,
  initialsOf,
  isStatusBadgeKey,
  isoToDay,
  layoutGantt,
  monthGrid,
  normalizeContextualDate,
  parseIsoDate,
  quarterOf,
  resolveProgressPercent,
  shiftIso,
  toggleSubscriber,
  validGanttItems,
} from '../index'

describe('StatusBadge / Progress', () => {
  it('validates status keys', () => {
    expect(isStatusBadgeKey('on_track')).toBe(true)
    expect(isStatusBadgeKey('green')).toBe(false)
    expect(isStatusBadgeKey(undefined)).toBe(false)
  })

  it('resolves percent from done/total or percent, clamped and NaN-safe', () => {
    expect(resolveProgressPercent({ done: 3, total: 5 })).toBe(60)
    expect(resolveProgressPercent({ percent: 140 })).toBe(100)
    expect(resolveProgressPercent({ percent: -3 })).toBe(0)
    expect(resolveProgressPercent({ done: 1, total: 0 })).toBe(0)
    expect(resolveProgressPercent({ percent: Number.NaN })).toBe(0)
  })

  it('initials fall back to ?', () => {
    expect(initialsOf('Анна Смирнова')).toBe('АС')
    expect(initialsOf('mark')).toBe('M')
    expect(initialsOf('   ')).toBe('?')
  })
})

describe('people / subscribers / reactions / privacy', () => {
  const people = [{ id: '1', name: 'Анна Смирнова', title: 'Product' }, { id: '2', name: 'Mark Lindgreen' }]

  it('filters people by name or title, case-insensitively', () => {
    expect(filterPeople(people, 'анна').map((p) => p.id)).toEqual(['1'])
    expect(filterPeople(people, 'product').map((p) => p.id)).toEqual(['1'])
    expect(filterPeople(people, '').length).toBe(2)
    expect(filterPeople(people, 'zzz')).toEqual([])
  })

  it('toggles subscribers immutably', () => {
    const ids = ['1']
    expect(toggleSubscriber(ids, '2')).toEqual(['1', '2'])
    expect(toggleSubscriber(ids, '1')).toEqual([])
    expect(ids).toEqual(['1'])
  })

  it('toggles reactions: add, increment, decrement-to-removal', () => {
    expect(applyReactionToggle([], '👍')).toEqual([{ emoji: '👍', count: 1, mine: true }])
    expect(applyReactionToggle([{ emoji: '👍', count: 2 }], '👍')).toEqual([{ emoji: '👍', count: 3, mine: true }])
    expect(applyReactionToggle([{ emoji: '👍', count: 1, mine: true }], '👍')).toEqual([])
  })

  it('offers space levels only with a space and link levels only on request', () => {
    expect(availablePrivacyLevels({})).not.toContain('space-view')
    expect(availablePrivacyLevels({})).not.toContain('link-view')
    expect(availablePrivacyLevels({ spaceName: 'Rox', includeLinkOptions: true })).toEqual([...PRIVACY_LEVELS])
  })
})

describe('contextual date', () => {
  it('parses strictly and knows the calendar', () => {
    expect(parseIsoDate('2026-02-29')).toBeNull()
    expect(parseIsoDate('2028-02-29')).toEqual({ year: 2028, month: 2, day: 29 }) // month is 1-based
    expect(parseIsoDate('nope')).toBeNull()
    expect(daysInMonth(2026, 1)).toBe(28)
    expect(quarterOf(9)).toBe(4)
  })

  it('normalises to the start of the precision period', () => {
    expect(normalizeContextualDate({ precision: 'quarter', date: '2026-11-17' })).toEqual({ precision: 'quarter', date: '2026-10-01' })
    expect(normalizeContextualDate({ precision: 'year', date: '2026-11-17' })).toEqual({ precision: 'year', date: '2026-01-01' })
    expect(normalizeContextualDate({ precision: 'day', date: 'bad' })).toBeNull()
  })

  it('formats per locale and precision', () => {
    const q = (quarter: number, year: number) => `Q${quarter} ${year}`
    expect(formatContextualDate({ precision: 'quarter', date: '2026-10-01' }, 'en', q)).toBe('Q4 2026')
    expect(formatContextualDate({ precision: 'year', date: '2026-01-01' }, 'ru', q)).toContain('2026')
    expect(formatContextualDate({ precision: 'day', date: '2026-10-08' }, 'en', q)).toContain('8')
  })

  it('builds a Monday-first month grid', () => {
    const grid = monthGrid(2026, 9)
    expect(grid.length % 7).toBe(0)
    expect(grid.indexOf('2026-10-01')).toBe(3) // Thursday
  })
})

describe('activity grouping', () => {
  it('groups by day, newest first, with today/yesterday markers', () => {
    const now = Date.parse('2026-10-08T12:00:00Z')
    const groups = groupByDay(
      [{ at: '2026-10-07T10:00:00Z' }, { at: '2026-10-08T09:00:00Z' }, { at: '2026-10-01T09:00:00Z' }, { at: '2026-10-08T11:00:00Z' }],
      { now, timeZone: 'UTC' },
    )
    expect(groups.map((g) => [g.day, g.relative, g.items.length])).toEqual([
      ['2026-10-08', 'today', 2],
      ['2026-10-07', 'yesterday', 1],
      ['2026-10-01', null, 1],
    ])
    expect(dayKey('2026-10-08T23:30:00Z', 'Europe/Moscow')).toBe('2026-10-09')
  })

  it('invalid timestamps sort last into one group; day keys never repeat (#1505 fix3)', () => {
    const now = Date.parse('2026-10-08T12:00:00Z')
    const items = [
      { id: 'bad1', at: 'garbage' },
      { id: 't1', at: '2026-10-08T09:00:00Z' },
      { id: 'bad2', at: '' },
      { id: 't2', at: '2026-10-08T11:00:00Z' },
      { id: 'y1', at: '2026-10-07T10:00:00Z' },
      { id: 'bad3', at: undefined as unknown as string },
      { id: 't3', at: '2026-10-08T10:00:00Z' },
    ]
    for (const order of [items, [...items].reverse()]) {
      const groups = groupByDay(order, { now, timeZone: 'UTC' })
      const days = groups.map((g) => g.day)
      expect(days).toEqual(['2026-10-08', '2026-10-07', 'invalid'])
      expect(new Set(days).size).toBe(days.length)
      expect(groups[0]!.items.map((i) => i.id)).toEqual(['t2', 't3', 't1'])
      expect(groups[2]!.items.map((i) => i.id).sort()).toEqual(['bad1', 'bad2', 'bad3'])
    }
  })
})

describe('gantt layout', () => {
  it('drops invalid items and lays out bars by day', () => {
    const items = [
      { id: 'a', start: '2026-10-01', end: '2026-10-09' },
      { id: 'bad', start: '2026-10-10', end: '2026-10-01' },
      { id: 'nope', start: 'x', end: 'y' },
    ]
    expect(validGanttItems(items).map((i) => i.id)).toEqual(['a'])
    const layout = layoutGantt(items, { zoom: 'week', today: '2026-10-08' })!
    expect(layout.bars).toHaveLength(1)
    expect(layout.bars[0]!.width).toBe(9 * 32)
    expect(layout.todayX).not.toBeNull()
    expect(layoutGantt([], { zoom: 'week' })).toBeNull()
  })

  it('shifts ISO dates across month boundaries', () => {
    expect(shiftIso('2026-10-31', 1)).toBe('2026-11-01')
    expect(isoToDay('2026-10-02')! - isoToDay('2026-10-01')!).toBe(1)
  })
})

describe('tree table', () => {
  it('flattens only expanded branches with aria metadata', () => {
    const rows = [
      { id: 'a', title: 'A', cells: {}, children: [{ id: 'a1', title: 'A1', cells: {} }, { id: 'a2', title: 'A2', cells: {} }] },
      { id: 'b', title: 'B', cells: {} },
    ]
    expect(flattenTree(rows, new Set()).map((r) => r.row.id)).toEqual(['a', 'b'])
    const open = flattenTree(rows, new Set(['a']))
    expect(open.map((r) => [r.row.id, r.level, r.posInSet, r.setSize])).toEqual([
      ['a', 1, 1, 2],
      ['a1', 2, 1, 2],
      ['a2', 2, 2, 2],
      ['b', 1, 2, 2],
    ])
    expect(open[0]!.expanded).toBe(true)
    expect(open[0]!.hasChildren).toBe(true)
  })
})
