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

/** Group newest-first by day; items inside a day keep newest-first order. */
export function groupByDay<T extends DayKeyed>(items: readonly T[], opts: { now: number; timeZone?: string }): DayGroup<T>[] {
  const today = dayKey(opts.now, opts.timeZone)
  const yesterday = dayKey(opts.now - 86_400_000, opts.timeZone)
  const sorted = [...items].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
  const groups: DayGroup<T>[] = []
  for (const item of sorted) {
    const day = dayKey(item.at, opts.timeZone)
    let group = groups[groups.length - 1]
    if (!group || group.day !== day) {
      group = { day, relative: day === today ? 'today' : day === yesterday ? 'yesterday' : null, items: [] }
      groups.push(group)
    }
    group.items.push(item)
  }
  return groups
}
