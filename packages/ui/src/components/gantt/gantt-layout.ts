/**
 * Pure layout for the GanttView shell (W1-08; ADR-U10 shared view type).
 *
 * Calendar dates (`YYYY-MM-DD`) map to integer day indexes in UTC, so
 * layout is deterministic across time zones and DST changes.
 */

export const GANTT_ZOOMS = ['week', 'month', 'quarter'] as const
export type GanttZoom = (typeof GANTT_ZOOMS)[number]

/** Pixels per day for each zoom level. */
export const GANTT_DAY_WIDTH: Record<GanttZoom, number> = { week: 32, month: 12, quarter: 4 }

export interface GanttItemDates {
  id: string
  start: string
  end: string
}

export interface GanttColumn {
  key: string
  /** First day of the column (ISO). */
  start: string
  x: number
  width: number
  kind: 'day' | 'month' | 'quarter'
}

export interface GanttBar {
  id: string
  x: number
  width: number
  row: number
}

export interface GanttLayout {
  rangeStart: string
  rangeEnd: string
  dayWidth: number
  totalWidth: number
  columns: GanttColumn[]
  bars: GanttBar[]
  /** Pixel offset of the "Today" marker, or null when today is out of range. */
  todayX: number | null
}

const DAY_MS = 86_400_000

export function isoToDay(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return null
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(t) ? null : Math.round(t / DAY_MS)
}

export function dayToIso(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10)
}

export function shiftIso(iso: string, days: number): string {
  const d = isoToDay(iso)
  return d === null ? iso : dayToIso(d + days)
}

function startOfMonthDay(day: number): number {
  const d = new Date(day * DAY_MS)
  return Math.round(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / DAY_MS)
}

function startOfQuarterDay(day: number): number {
  const d = new Date(day * DAY_MS)
  return Math.round(Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1) / DAY_MS)
}

function addMonthsDay(day: number, months: number): number {
  const d = new Date(day * DAY_MS)
  return Math.round(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1) / DAY_MS)
}

/** Items with a valid start ≤ end (others are dropped from the chart). */
export function validGanttItems<T extends GanttItemDates>(items: readonly T[]): T[] {
  return items.filter((item) => {
    const s = isoToDay(item.start); const e = isoToDay(item.end)
    return s !== null && e !== null && s <= e
  })
}

export function layoutGantt(items: readonly GanttItemDates[], opts: { zoom: GanttZoom; today?: string }): GanttLayout | null {
  const valid = validGanttItems(items)
  if (valid.length === 0) return null
  const dayWidth = GANTT_DAY_WIDTH[opts.zoom]
  let min = Math.min(...valid.map((i) => isoToDay(i.start)!))
  let max = Math.max(...valid.map((i) => isoToDay(i.end)!))
  const today = opts.today ? isoToDay(opts.today) : null
  if (today !== null) { min = Math.min(min, today); max = Math.max(max, today) }

  // Snap the range to whole columns with one column of padding on each side.
  let rangeStart: number
  let rangeEndExclusive: number
  const columns: GanttColumn[] = []
  if (opts.zoom === 'week') {
    const monday = (d: number) => d - ((new Date(d * DAY_MS).getUTCDay() + 6) % 7)
    rangeStart = monday(min) - 7
    rangeEndExclusive = monday(max) + 14
    for (let d = rangeStart; d < rangeEndExclusive; d++) {
      columns.push({ key: dayToIso(d), start: dayToIso(d), x: (d - rangeStart) * dayWidth, width: dayWidth, kind: 'day' })
    }
  } else {
    const step = opts.zoom === 'month' ? 1 : 3
    const snap = opts.zoom === 'month' ? startOfMonthDay : startOfQuarterDay
    rangeStart = addMonthsDay(snap(min), -step)
    rangeEndExclusive = addMonthsDay(snap(max), 2 * step)
    for (let d = rangeStart; d < rangeEndExclusive; d = addMonthsDay(d, step)) {
      const next = addMonthsDay(d, step)
      columns.push({ key: dayToIso(d), start: dayToIso(d), x: (d - rangeStart) * dayWidth, width: (next - d) * dayWidth, kind: opts.zoom === 'month' ? 'month' : 'quarter' })
    }
  }

  const bars = valid.map((item, row) => {
    const s = isoToDay(item.start)!; const e = isoToDay(item.end)!
    return { id: item.id, x: (s - rangeStart) * dayWidth, width: (e - s + 1) * dayWidth, row }
  })

  return {
    rangeStart: dayToIso(rangeStart),
    rangeEnd: dayToIso(rangeEndExclusive - 1),
    dayWidth,
    totalWidth: (rangeEndExclusive - rangeStart) * dayWidth,
    columns,
    bars,
    todayX: today === null ? null : (today - rangeStart) * dayWidth + dayWidth / 2,
  }
}
