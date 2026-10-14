import { describe, expect, it } from 'bun:test'
import { addDays, daysBetween } from '@rox/shared/projects/roadmap'
import {
  applySpanDrag, barGeometry, dateAtOffset, dragDeltaDays, ganttScale, ganttTicks, spanFromDates, todayOffset, zoomScale,
} from '../gantt-engine'

const range = { start: '2026-01-01', end: '2026-03-31' }

describe('scale and geometry', () => {
  it('fits the window to the track (matches the original roadmap formulas)', () => {
    const totalDays = daysBetween(range.start, range.end) + 1
    expect(ganttScale(range, 900)).toEqual({ totalDays, pxPerDay: 900 / totalDays })
    expect(ganttScale(range, 0).pxPerDay).toBe(0)
    expect(ganttScale(null, 500)).toEqual({ totalDays: 1, pxPerDay: 500 })
  })

  it('builds spans from optional dates', () => {
    expect(spanFromDates('2026-01-02', '2026-01-05')).toEqual({ start: '2026-01-02', end: '2026-01-05' })
    expect(spanFromDates(undefined, '2026-01-05')).toEqual({ start: '2026-01-05', end: '2026-01-05' })
    expect(spanFromDates('2026-01-02')).toEqual({ start: '2026-01-02', end: '2026-01-02' })
    expect(spanFromDates()).toBeNull()
  })

  it('positions bars at least one day wide', () => {
    for (const [s, e, px] of [['2026-01-01', '2026-01-01', 10], ['2026-01-10', '2026-02-03', 7.5], ['2026-03-01', '2026-03-31', 3]] as const) {
      const g = barGeometry(range, { start: s, end: e }, px)
      expect(g.left).toBe(daysBetween(range.start, s) * px)
      expect(g.width).toBe(Math.max(px, (daysBetween(s, e) + 1) * px))
    }
    expect(barGeometry(range, { start: '2026-01-05', end: '2026-01-05' }, 0).width).toBe(0)
  })

  it('places the today line at the middle of the day or hides it', () => {
    expect(todayOffset(range, '2026-01-01', 10)).toBe(5)
    expect(todayOffset(range, '2026-01-11', 10)).toBe(105)
    expect(todayOffset(range, '2025-12-31', 10)).toBeNull()
    expect(todayOffset(range, '2026-04-01', 10)).toBeNull()
  })
})

describe('drag', () => {
  it('snaps pointer deltas to whole days', () => {
    expect(dragDeltaDays(100, 124, 10)).toBe(2)
    expect(dragDeltaDays(100, 96, 10)).toBe(-0)
    expect(dragDeltaDays(100, 84, 10)).toBe(-2)
  })

  it('moves and resizes without inverting', () => {
    const span = { start: '2026-01-10', end: '2026-01-20' }
    expect(applySpanDrag(span, 'move', 0)).toBe(span)
    expect(applySpanDrag(span, 'move', 3)).toEqual({ start: '2026-01-13', end: '2026-01-23' })
    expect(applySpanDrag(span, 'start', -2)).toEqual({ start: '2026-01-08', end: '2026-01-20' })
    expect(applySpanDrag(span, 'start', 30)).toEqual({ start: '2026-01-20', end: '2026-01-20' })
    expect(applySpanDrag(span, 'end', 5)).toEqual({ start: '2026-01-10', end: '2026-01-25' })
    expect(applySpanDrag(span, 'end', -30)).toEqual({ start: '2026-01-10', end: '2026-01-10' })
  })
})

describe('ticks', () => {
  it('marks month starts as major and labels Mondays when there is room', () => {
    const scale = ganttScale(range, 90 * 10)
    const ticks = ganttTicks(range, scale, 'en-US')
    expect(ticks.filter((t) => t.major).map((t) => t.label)).toEqual(['Jan', 'Feb', 'Mar'])
    expect(ticks.some((t) => !t.major)).toBe(true)
    expect(ganttTicks(range, { totalDays: 90, pxPerDay: 0 }, 'en-US')).toEqual([])
    expect(ganttTicks(null, scale, 'en-US')).toEqual([])
  })

  it('drops minor labels when weeks are too narrow', () => {
    const ticks = ganttTicks(range, { totalDays: 90, pxPerDay: 3 }, 'en-US')
    expect(ticks.every((t) => t.major)).toBe(true)
  })
})

describe('zoom', () => {
  it('uses fixed px/day per level and the container for fit', () => {
    const days = daysBetween(range.start, range.end) + 1
    expect(zoomScale(range, 'week', 500)).toEqual({ totalDays: days, pxPerDay: 20, trackWidth: days * 20 })
    expect(zoomScale(range, 'fit', 500).trackWidth).toBe(500)
  })

  it('maps an offset back to a date, clamped', () => {
    expect(dateAtOffset(range, 0, 10)).toBe('2026-01-01')
    expect(dateAtOffset(range, 25, 10)).toBe('2026-01-03')
    expect(dateAtOffset(range, 1e6, 10)).toBe(range.end)
    expect(dateAtOffset(range, -50, 10)).toBe(range.start)
    expect(dateAtOffset(range, 50, 0)).toBe(range.start)
    expect(addDays(range.start, 0)).toBe(range.start)
  })
})
