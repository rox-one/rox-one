/**
 * Pure helpers for ContextualDatePicker (W1-08, UI-SPEC §4
 * "ContextualDateField"): Operately contextual dates with a precision of
 * day, month, quarter or year. Dates are calendar dates (`YYYY-MM-DD`),
 * never instants, so formatting runs in UTC to avoid timezone drift.
 */

export const DATE_PRECISIONS = ['day', 'month', 'quarter', 'year'] as const
export type DatePrecision = (typeof DATE_PRECISIONS)[number]

export interface ContextualDate {
  precision: DatePrecision
  /** Calendar date `YYYY-MM-DD`; for coarser precisions the period start. */
  date: string
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

export function parseIsoDate(value: string): { year: number; month: number; day: number } | null {
  const m = ISO_DATE.exec(value)
  if (!m) return null
  const year = Number(m[1]); const month = Number(m[2]); const day = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month - 1)) return null
  return { year, month, day }
}

export function toIsoDate(year: number, monthIndex: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
}

export function quarterOf(monthIndex: number): 1 | 2 | 3 | 4 {
  return (Math.floor(monthIndex / 3) + 1) as 1 | 2 | 3 | 4
}

/** Normalise a value to the start of its period (month/quarter/year). */
export function normalizeContextualDate(value: ContextualDate): ContextualDate | null {
  const parts = parseIsoDate(value.date)
  if (!parts) return null
  const monthIndex = parts.month - 1
  switch (value.precision) {
    case 'day': return value
    case 'month': return { precision: 'month', date: toIsoDate(parts.year, monthIndex, 1) }
    case 'quarter': return { precision: 'quarter', date: toIsoDate(parts.year, (quarterOf(monthIndex) - 1) * 3, 1) }
    case 'year': return { precision: 'year', date: toIsoDate(parts.year, 0, 1) }
  }
}

export type QuarterFormatter = (quarter: number, year: number) => string

/**
 * Display string: day "Mar 5", month "March 2026", quarter "Q2 2026"
 * (localised through `formatQuarter`), year "2026". Returns null for an
 * invalid date so callers can show the "Set date" placeholder.
 */
export function formatContextualDate(value: ContextualDate, locale: string, formatQuarter: QuarterFormatter): string | null {
  const parts = parseIsoDate(value.date)
  if (!parts) return null
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day))
  switch (value.precision) {
    case 'day':
      return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date)
    case 'month':
      return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date)
    case 'quarter':
      return formatQuarter(quarterOf(parts.month - 1), parts.year)
    case 'year':
      return String(parts.year)
  }
}

/** Monday-first 6×7 grid of ISO dates (null = padding) for a month. */
export function monthGrid(year: number, monthIndex: number): Array<string | null> {
  const firstWeekday = (new Date(Date.UTC(year, monthIndex, 1)).getUTCDay() + 6) % 7
  const cells: Array<string | null> = Array.from({ length: firstWeekday }, () => null)
  for (let d = 1; d <= daysInMonth(year, monthIndex); d++) cells.push(toIsoDate(year, monthIndex, d))
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}
