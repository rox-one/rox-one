/**
 * Day grouping for ActivityTimeline (pure). Days are computed in an explicit
 * IANA time zone (default: the runtime zone) so tests stay deterministic.
 */

export interface DayKeyed {
  at: string
}

/** `YYYY-MM-DD` of an instant in a time zone. */
export function dayKey(at: string | number | Date, timeZone?: string): string {
  const date = at instanceof Date ? at : new Date(at)
  if (Number.isNaN(date.getTime())) return 'invalid'
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone }).format(date)
}

export interface DayGroup<T> {
  day: string
  relative: 'today' | 'yesterday' | null
  items: T[]
}

/** Sortable time of `at`; an invalid or missing value sorts last. */
function sortTime(at: string): number {
  const time = Date.parse(at)
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time
}

/**
 * Group newest-first by day; items inside a day keep newest-first order.
 * Invalid timestamps sort last (in input order) into one `invalid` group, and
 * every day appears exactly once (groups are keyed by day), so React keys and
 * headings never repeat.
 */
export function groupByDay<T extends DayKeyed>(items: readonly T[], opts: { now: number; timeZone?: string }): DayGroup<T>[] {
  const today = dayKey(opts.now, opts.timeZone)
  const yesterday = dayKey(opts.now - 86_400_000, opts.timeZone)
  const sorted = [...items].sort((a, b) => {
    const ta = sortTime(a.at)
    const tb = sortTime(b.at)
    return ta === tb ? 0 : tb > ta ? 1 : -1
  })
  const groups = new Map<string, DayGroup<T>>()
  for (const item of sorted) {
    const day = dayKey(item.at, opts.timeZone)
    let group = groups.get(day)
    if (!group) {
      group = { day, relative: day === today ? 'today' : day === yesterday ? 'yesterday' : null, items: [] }
      groups.set(day, group)
    }
    group.items.push(item)
  }
  return [...groups.values()]
}
