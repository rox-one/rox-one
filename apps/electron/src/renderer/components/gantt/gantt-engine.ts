/**
 * Gantt engine — pure layout / scale / zoom math over local ISO dates (YYYY-MM-DD).
 * Extracted from ProjectTimeline (roadmap) so task timelines can reuse it.
 * No React, no DOM: every function is deterministic and unit-tested.
 */
import { addDays, daysBetween, parseIsoDate } from '@rox/shared/projects/roadmap'

export interface GanttRange {
  start: string
  end: string
}

/** Inclusive span on the calendar. */
export interface GanttSpan {
  start: string
  end: string
}

export type GanttDragMode = 'move' | 'start' | 'end'

export interface GanttTick {
  left: number
  label: string
  major: boolean
}

export interface GanttScale {
  totalDays: number
  pxPerDay: number
}

/** Days in the window (≥ 1) and the px-per-day that fits `trackWidth`. */
export function ganttScale(range: GanttRange | null, trackWidth: number): GanttScale {
  const totalDays = range ? Math.max(1, daysBetween(range.start, range.end) + 1) : 1
  return { totalDays, pxPerDay: trackWidth > 0 ? trackWidth / totalDays : 0 }
}

/** A span from optional start/end dates (a single date becomes a one-day span); null if undated. */
export function spanFromDates(start?: string, end?: string): GanttSpan | null {
  const s = start ?? end
  const e = end ?? start
  return s && e ? { start: s, end: e } : null
}

/** Bar offset and width (at least one day wide) inside the track. */
export function barGeometry(range: GanttRange, span: GanttSpan, pxPerDay: number): { left: number; width: number } {
  return {
    left: daysBetween(range.start, span.start) * pxPerDay,
    width: Math.max(pxPerDay, (daysBetween(span.start, span.end) + 1) * pxPerDay),
  }
}

/** Center of `today` inside the track, or null when today is outside the window. */
export function todayOffset(range: GanttRange, today: string, pxPerDay: number): number | null {
  if (daysBetween(range.start, today) < 0 || daysBetween(today, range.end) < 0) return null
  return (daysBetween(range.start, today) + 0.5) * pxPerDay
}

/** Whole days moved by a pointer drag. */
export function dragDeltaDays(startX: number, clientX: number, pxPerDay: number): number {
  return Math.round((clientX - startX) / pxPerDay)
}

/** Move or resize a span by `days`; resizing never inverts the span. */
export function applySpanDrag(span: GanttSpan, mode: GanttDragMode, days: number): GanttSpan {
  if (!days) return span
  if (mode === 'move') return { start: addDays(span.start, days), end: addDays(span.end, days) }
  if (mode === 'start') {
    const next = addDays(span.start, days)
    return { start: next > span.end ? span.end : next, end: span.end }
  }
  const next = addDays(span.end, days)
  return { start: span.start, end: next < span.start ? span.start : next }
}

/**
 * Header ticks: month starts are major; Mondays are minor labels when weeks
 * (or fortnights) have room (≥ 56px), skipping days near month edges.
 */
export function ganttTicks(range: GanttRange | null, scale: GanttScale, locale: string): GanttTick[] {
  const { totalDays, pxPerDay } = scale
  if (!range || pxPerDay <= 0) return []
  const out: GanttTick[] = []
  const monthFmt = new Intl.DateTimeFormat(locale, { month: 'short' })
  const dayFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' })
  const step = pxPerDay * 7 >= 56 ? 7 : pxPerDay * 14 >= 56 ? 14 : 0
  for (let i = 0; i < totalDays; i++) {
    const d = parseIsoDate(addDays(range.start, i))
    const left = i * pxPerDay
    if (d.getDate() === 1) out.push({ left, label: monthFmt.format(d), major: true })
    else if (step && d.getDay() === 1 && (step === 7 || Math.floor(i / 7) % 2 === 0) && d.getDate() > 3 && d.getDate() < 29) {
      out.push({ left, label: dayFmt.format(d), major: false })
    }
  }
  return out
}

// ── Zoom (for scrollable timelines; the roadmap fits its container instead) ──

export type GanttZoom = 'fit' | 'day' | 'week' | 'month' | 'quarter'

/** Fixed px-per-day per zoom level; 'fit' uses the container width. */
export const GANTT_ZOOM_PX_PER_DAY: Record<Exclude<GanttZoom, 'fit'>, number> = {
  day: 48,
  week: 20,
  month: 6,
  quarter: 2,
}

/** Scale for a zoom level: fixed levels yield the track width they need. */
export function zoomScale(range: GanttRange | null, zoom: GanttZoom, containerWidth: number): GanttScale & { trackWidth: number } {
  if (zoom === 'fit') return { ...ganttScale(range, containerWidth), trackWidth: containerWidth }
  const totalDays = ganttScale(range, 0).totalDays
  const pxPerDay = GANTT_ZOOM_PX_PER_DAY[zoom]
  return { totalDays, pxPerDay, trackWidth: totalDays * pxPerDay }
}

/** The date under an x offset in the track (clamped to the window). */
export function dateAtOffset(range: GanttRange, x: number, pxPerDay: number): string {
  if (pxPerDay <= 0) return range.start
  const total = daysBetween(range.start, range.end)
  const day = Math.min(total, Math.max(0, Math.floor(x / pxPerDay)))
  return addDays(range.start, day)
}
