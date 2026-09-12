/** Local-calendar helpers and natural-language dates for personal tasks. */

const MS_DAY = 24 * 60 * 60 * 1000

export function localDayKey(ts: number): string {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function startOfLocalDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function isSameLocalDay(a: number, b: number): boolean {
  return localDayKey(a) === localDayKey(b)
}

export interface ParsedNlDate {
  dueAt?: number
  startAt?: number
  evening: boolean
  list?: 'today' | 'upcoming' | 'someday'
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  воскресенье: 0, понедельник: 1, вторник: 2, среда: 3, четверг: 4, пятница: 5, суббота: 6,
}

export function parseNlDate(input: string, now: number): ParsedNlDate | null {
  const text = input.trim().toLowerCase()
  if (!text) return null
  const evening = /\b(evening|tonight|вечером|вечера)\b/.test(text)

  const iso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(text)
  if (iso) {
    const [y, m, d] = iso[1]!.split('-').map(Number)
    const due = new Date(y!, (m ?? 1) - 1, d ?? 1, evening ? 18 : 9, 0, 0, 0).getTime()
    return { dueAt: due, evening, list: isSameLocalDay(due, now) ? 'today' : 'upcoming' }
  }

  if (/\b(today|сегодня)\b/.test(text)) {
    const due = startOfLocalDay(now) + (evening ? 18 : 9) * 60 * 60 * 1000
    return { dueAt: due, evening, list: 'today' }
  }
  if (/\b(tomorrow|завтра)\b/.test(text)) {
    const due = startOfLocalDay(now) + MS_DAY + (evening ? 18 : 9) * 60 * 60 * 1000
    return { dueAt: due, evening, list: 'upcoming' }
  }
  if (/\b(someday|когда-нибудь)\b/.test(text)) {
    return { evening, list: 'someday' }
  }

  const inDays = /\b(?:in|через)\s+(\d+)\s+(day|days|дн)/.exec(text)
  if (inDays) {
    const n = Number(inDays[1])
    const due = startOfLocalDay(now) + n * MS_DAY + (evening ? 18 : 9) * 60 * 60 * 1000
    return { dueAt: due, evening, list: n === 0 ? 'today' : 'upcoming' }
  }

  for (const [name, weekday] of Object.entries(WEEKDAYS)) {
    if (!text.includes(name)) continue
    const from = new Date(startOfLocalDay(now))
    const delta = (weekday - from.getDay() + 7) % 7 || 7
    const due = from.getTime() + delta * MS_DAY + (evening ? 18 : 9) * 60 * 60 * 1000
    return { dueAt: due, evening, list: 'upcoming' }
  }

  if (evening) {
    const due = startOfLocalDay(now) + 18 * 60 * 60 * 1000
    return { dueAt: due, evening: true, list: 'today' }
  }
  return null
}

export function parseQuickEntry(raw: string, now: number): { title: string; parsed: ParsedNlDate | null } {
  const parsed = parseNlDate(raw, now)
  if (!parsed) return { title: raw.trim(), parsed: null }
  const stripped = raw
    .replace(/\b(today|tomorrow|tonight|evening|someday|сегодня|завтра|вечером|когда-нибудь)\b/gi, '')
    .replace(/\b(?:in|через)\s+\d+\s+(?:day|days|дн\w*)\b/gi, '')
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return { title: stripped || raw.trim(), parsed }
}
