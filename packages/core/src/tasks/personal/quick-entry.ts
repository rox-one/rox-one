/**
 * Quick Entry parser (Things-style) with Russian + English natural language:
 * «Купить молоко завтра #дом», «Отчёт в пт до 15 окт в 10:00», «Позвонить
 * через неделю», «Спорт каждый пн», «Идея когда-нибудь». Tokens are removed
 * from the title; everything is local time. Pure — tests pass `now`.
 */
import { startOfLocalDay, startOfZonedDay, zonedDateTimeParts, zonedDateTimeToEpoch } from './dates.ts'
import type { Recurrence } from './types.ts'
import type { ZonedDateTimeParts } from './dates.ts'

const MS_DAY = 24 * 60 * 60 * 1000
const B = '(?<![\\p{L}\\p{N}])'
const E = '(?![\\p{L}\\p{N}])'

export type EntryWhen = 'today' | 'evening' | 'anytime' | 'someday' | 'date'

export interface ParsedTaskEntry {
  title: string
  when?: EntryWhen
  /** Local midnight of the start day («Когда») when `when` is 'date' (or today/evening). */
  startAt?: number
  deadlineAt?: number
  reminderAt?: number
  tags: string[]
  /** «вечером» / «tonight» was given (Этот вечер on the start day). */
  evening: boolean
  recurrence?: Recurrence
  /** Recognised fragments, for the live preview under the input. */
  tokens: Array<{ kind: 'when' | 'deadline' | 'reminder' | 'tag' | 'repeat'; text: string }>
}

const WEEKDAY_WORDS: Array<[RegExp, number]> = [
  [/^(пн|пнд|понедельник[а-я]*|mon|monday)$/iu, 1],
  [/^(вт|втр|вторник[а-я]*|tue|tues|tuesday)$/iu, 2],
  [/^(ср|среда|среду|среды|wed|wednesday)$/iu, 3],
  [/^(чт|чтв|четверг[а-я]*|thu|thur|thurs|thursday)$/iu, 4],
  [/^(пт|птн|пятниц[а-я]*|fri|friday)$/iu, 5],
  [/^(сб|суб|суббот[а-я]*|sat|saturday)$/iu, 6],
  [/^(вс|вск|воскресень[а-я]*|sun|sunday)$/iu, 0],
]
const WEEKDAY_ALT =
  'пн|пнд|понедельник[а-я]*|вт|втр|вторник[а-я]*|ср|среда|среду|среды|чт|чтв|четверг[а-я]*|пт|птн|пятниц[а-я]*|сб|суб|суббот[а-я]*|вс|вск|воскресень[а-я]*|mon|monday|tue|tues|tuesday|wed|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday|sun|sunday'

const MONTHS: Array<[RegExp, number]> = [
  [/^(янв|январ)/iu, 0], [/^(фев|феврал)/iu, 1], [/^(мар|март)/iu, 2], [/^(апр|апрел)/iu, 3],
  [/^(мая|май|may)/iu, 4], [/^(июн|jun)/iu, 5], [/^(июл|jul)/iu, 6], [/^(авг|aug)/iu, 7],
  [/^(сен|сент|sep)/iu, 8], [/^(окт|oct)/iu, 9], [/^(ноя|nov)/iu, 10], [/^(дек|dec)/iu, 11],
  [/^jan/iu, 0], [/^feb/iu, 1], [/^mar/iu, 2], [/^apr/iu, 3],
]
const MONTH_ALT = 'янв[а-я]*|фев[а-я]*|мар[а-я]*|апр[а-я]*|мая|май|июн[а-я]*|июл[а-я]*|авг[а-я]*|сен[а-я]*|окт[а-я]*|ноя[а-я]*|дек[а-я]*|jan[a-z]*|feb[a-z]*|mar[a-z]*|apr[a-z]*|may|jun[a-z]*|jul[a-z]*|aug[a-z]*|sep[a-z]*|oct[a-z]*|nov[a-z]*|dec[a-z]*'

function weekdayOf(word: string): number | null {
  for (const [re, day] of WEEKDAY_WORDS) if (re.test(word)) return day
  return null
}

function monthOf(word: string): number | null {
  for (const [re, month] of MONTHS) if (re.test(word)) return month
  return null
}

function nextWeekday(now: number, weekday: number): number {
  const today = startOfLocalDay(now)
  const current = new Date(today).getDay()
  const delta = (weekday - current + 7) % 7 || 7
  return dayOffset(today, delta)
}

/** Local midnight `n` days after `day` (DST-safe). */
function dayOffset(day: number, n: number): number {
  const d = new Date(day)
  d.setDate(d.getDate() + n)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function monthOffset(day: number, n: number): number {
  const d = new Date(day)
  d.setMonth(d.getMonth() + n)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Date expression → local midnight, or null. Returns the matched length used. */
const DATE_EXPR = [
  `сегодня|today`,
  `послезавтра|day after tomorrow`,
  `завтра|tomorrow`,
  `через\\s+(?:\\d+\\s+)?(?:дн[а-я]*|день|недел[а-я]*|месяц[а-я]*|год[а-я]*|лет)`,
  `in\\s+\\d+\\s+(?:days?|weeks?|months?|years?)`,
  `in\\s+a\\s+(?:day|week|month|year)`,
  `на\\s+следующей\\s+неделе|next\\s+week`,
  `на\\s+выходных|this\\s+weekend`,
  `(?:(?:в|во|on)\\s+)?(?:след(?:ующ[а-я]*)?\\s+|next\\s+)?(?:${WEEKDAY_ALT})`,
  `\\d{4}-\\d{2}-\\d{2}`,
  `\\d{1,2}\\.\\d{1,2}(?:\\.\\d{2,4})?`,
  `\\d{1,2}\\s+(?:${MONTH_ALT})(?:\\s+\\d{4})?`,
].join('|')

export function parseDateExpression(input: string, now: number): number | null {
  const text = input.trim().toLowerCase().replace(/\s+/g, ' ')
  const today = startOfLocalDay(now)
  if (/^(сегодня|today)$/u.test(text)) return today
  if (/^(послезавтра|day after tomorrow)$/u.test(text)) return dayOffset(today, 2)
  if (/^(завтра|tomorrow)$/u.test(text)) return dayOffset(today, 1)
  let m = /^(?:через|in)\s+(\d+|a)?\s*(дн[а-я]*|день|days?|day|недел[а-я]*|weeks?|месяц[а-я]*|months?|год[а-я]*|лет|years?)$/u.exec(text)
  if (m) {
    const n = m[1] && m[1] !== 'a' ? Number(m[1]) : 1
    const unit = m[2]!
    if (/^(дн|день|day)/u.test(unit)) return dayOffset(today, n)
    if (/^(недел|week)/u.test(unit)) return dayOffset(today, 7 * n)
    if (/^(месяц|month)/u.test(unit)) return monthOffset(today, n)
    return monthOffset(today, 12 * n)
  }
  if (/^(на следующей неделе|next week)$/u.test(text)) return nextWeekday(now, 1)
  if (/^(на выходных|this weekend)$/u.test(text)) {
    const dow = new Date(today).getDay()
    return dow === 6 || dow === 0 ? today : nextWeekday(now, 6)
  }
  m = /^(?:(?:в|во|on)\s+)?(след(?:ующ[а-я]*)?\s+|next\s+)?(\S+)$/u.exec(text)
  if (m) {
    const wd = weekdayOf(m[2]!)
    if (wd != null) {
      const base = nextWeekday(now, wd)
      return m[1] && base - today < 7 * MS_DAY && new Date(today).getDay() !== 0 && wd > new Date(today).getDay() ? dayOffset(base, 7) : base
    }
  }
  m = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(text)
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()
  m = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?$/u.exec(text)
  if (m) return resolveDayMonth(Number(m[1]), Number(m[2]) - 1, m[3] ? normYear(Number(m[3])) : null, today)
  m = /^(\d{1,2})\s+(\S+)(?:\s+(\d{4}))?$/u.exec(text)
  if (m) {
    const month = monthOf(m[2]!)
    if (month != null) return resolveDayMonth(Number(m[1]), month, m[3] ? Number(m[3]) : null, today)
  }
  return null
}

function normYear(y: number): number {
  return y < 100 ? 2000 + y : y
}

function resolveDayMonth(day: number, month: number, year: number | null, today: number): number | null {
  if (day < 1 || day > 31 || month < 0 || month > 11) return null
  const y = year ?? new Date(today).getFullYear()
  let at = new Date(y, month, day).getTime()
  if (new Date(at).getMonth() !== month) return null
  if (year == null && at < today) at = new Date(y + 1, month, day).getTime()
  return at
}

interface Cursor {
  text: string
  /** Same length as text; consumed spans are blanked. */
  work: string
}

function take(cur: Cursor, re: RegExp): RegExpExecArray | null {
  const m = re.exec(cur.work)
  if (!m) return null
  const start = m.index
  const end = start + m[0].length
  cur.work = cur.work.slice(0, start) + ' '.repeat(end - start) + cur.work.slice(end)
  return m
}

export function parseTaskEntry(raw: string, now: number = Date.now()): ParsedTaskEntry {
  const cur: Cursor = { text: raw, work: raw }
  const out: ParsedTaskEntry = { title: raw.trim(), tags: [], evening: false, tokens: [] }
  const today = startOfLocalDay(now)

  // #tags (letters, digits, - _ /)
  for (;;) {
    const m = take(cur, new RegExp(`${B}#([\\p{L}\\p{N}_\\-/]+)`, 'iu'))
    if (!m) break
    const tag = m[1]!
    if (!out.tags.includes(tag)) out.tags.push(tag)
    out.tokens.push({ kind: 'tag', text: m[0] })
  }

  // Repeat: каждый день / ежедневно / каждую неделю / каждый пн / every day / every monday
  const rep = take(cur, new RegExp(`${B}(?:(каждый|каждую|каждое|каждые|every)\\s+(\\d+\\s+)?(день|дня|дней|day|days|недел[а-я]*|weeks?|месяц[а-я]*|months?|год[а-я]*|years?|${WEEKDAY_ALT})|(ежедневно|daily|еженедельно|weekly|ежемесячно|monthly|ежегодно|yearly))${E}`, 'iu'))
  if (rep) {
    const word = (rep[3] ?? rep[4] ?? '').toLowerCase()
    const interval = rep[2] ? Math.max(1, Number(rep[2].trim())) : 1
    const wd = weekdayOf(word)
    if (wd != null) out.recurrence = { rule: 'weekly', interval: 1, weekdays: [wd] }
    else if (/^(день|дня|дней|day|days|ежедневно|daily)$/u.test(word)) out.recurrence = { rule: 'daily', interval }
    else if (/^(недел|week|еженедельно|weekly)/u.test(word)) out.recurrence = { rule: 'weekly', interval }
    else if (/^(месяц|month|ежемесячно|monthly)/u.test(word)) out.recurrence = { rule: 'monthly', interval }
    else out.recurrence = { rule: 'yearly', interval }
    out.tokens.push({ kind: 'repeat', text: rep[0] })
    if (out.recurrence.weekdays && out.startAt == null) {
      out.startAt = nextWeekdayOrToday(now, out.recurrence.weekdays[0]!)
      out.when = out.startAt === today ? 'today' : 'date'
    }
  }

  // Deadline: «до пт», «до 15 окт», «дедлайн завтра», «deadline fri», «by fri»
  const dl = take(cur, new RegExp(`${B}(?:до|дедлайн|срок|deadline|due|by)\\s+(${DATE_EXPR})${E}`, 'iu'))
  if (dl) {
    const at = parseDateExpression(dl[1]!, now)
    if (at != null) {
      out.deadlineAt = at
      out.tokens.push({ kind: 'deadline', text: dl[0] })
    }
  }

  // Reminder time: «в 15:00», «в 9», «в 9:30», «at 3pm», «at 15:00»
  const tm = take(cur, new RegExp(`${B}(?:в|во|at|@)\\s*(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm|утра|вечера|дня|ночи)?${E}`, 'iu'))
  let reminderHM: [number, number] | null = null
  if (tm) {
    let h = Number(tm[1])
    const min = tm[2] ? Number(tm[2]) : 0
    const suffix = (tm[3] ?? '').toLowerCase()
    if ((suffix === 'pm' || suffix === 'вечера' || suffix === 'дня') && h < 12) h += 12
    if ((suffix === 'am' || suffix === 'ночи') && h === 12) h = 0
    // «в 2024» or «в 45» are not times — put the text back.
    if (h <= 23 && min <= 59 && (tm[2] || suffix || /^(в|во|at|@)\s*\d{1,2}$/iu.test(tm[0].trim()))) {
      reminderHM = [h, min]
      out.tokens.push({ kind: 'reminder', text: tm[0] })
    } else {
      cur.work = cur.work.slice(0, tm.index) + tm[0] + cur.work.slice(tm.index + tm[0].length)
    }
  }

  // Evening / someday / anytime / date
  const eve = take(cur, new RegExp(`${B}(?:сегодня\\s+вечером|этим\\s+вечером|вечером|tonight|this\\s+evening|evening)${E}`, 'iu'))
  if (eve) {
    out.when = 'evening'
    out.evening = true
    out.startAt = today
    out.tokens.push({ kind: 'when', text: eve[0] })
  }
  const some = take(cur, new RegExp(`${B}(?:когда-нибудь|когда нибудь|someday|some day)${E}`, 'iu'))
  if (some) {
    out.when = 'someday'
    out.evening = false
    out.startAt = undefined
    out.tokens.push({ kind: 'when', text: some[0] })
  }
  const any = take(cur, new RegExp(`${B}(?:в\\s+любое\\s+время|anytime)${E}`, 'iu'))
  if (any && !out.when) {
    out.when = 'anytime'
    out.tokens.push({ kind: 'when', text: any[0] })
  }
  const date = take(cur, new RegExp(`${B}(?:${DATE_EXPR})${E}`, 'iu'))
  if (date) {
    const at = parseDateExpression(date[0], now)
    if (at != null) {
      out.tokens.push({ kind: 'when', text: date[0] })
      if (out.when === 'evening') {
        out.startAt = at
        if (at !== today) out.when = 'date'
      } else {
        out.startAt = at
        out.when = at === today ? 'today' : 'date'
      }
    } else {
      cur.work = cur.work.slice(0, date.index) + date[0] + cur.work.slice(date.index + date[0].length)
    }
  }

  if (reminderHM) {
    const base = out.startAt ?? today
    const d = new Date(base)
    d.setHours(reminderHM[0], reminderHM[1], 0, 0)
    let at = d.getTime()
    if (out.startAt == null && at <= now) at = dayOffset(base, 1) + reminderHM[0] * 3600000 + reminderHM[1] * 60000
    out.reminderAt = at
    if (!out.when) {
      out.when = startOfLocalDay(at) === today ? 'today' : 'date'
      out.startAt = startOfLocalDay(at)
    }
  }

  const title = cur.work.replace(/\s+/g, ' ').trim()
  out.title = title || raw.trim()
  return out
}

function nextWeekdayOrToday(now: number, weekday: number): number {
  const today = startOfLocalDay(now)
  if (new Date(today).getDay() === weekday) return today
  return nextWeekday(now, weekday)
}

/** Next start date for a repeating task (local midnight), or null when the rule ended. */
export function nextRepeatDate(rec: Recurrence, anchor: number, completedAt: number): number | null {
  const interval = Math.max(1, Math.floor(rec.interval || 1))
  if (rec.timeZone) {
    try {
      const zone = rec.timeZone
      const source = rec.mode === 'after' ? completedAt : anchor
      const wallClock = zonedDateTimeParts(source, zone)
      const baseDay = zonedDateTimeParts(startOfZonedDay(source, zone), zone)
      const floor = startOfZonedDay(completedAt, zone)
      const stepZoned = (from: ZonedDateTimeParts): ZonedDateTimeParts => {
        const date = new Date(Date.UTC(from.year, from.month - 1, from.day))
        switch (rec.rule) {
          case 'daily':
            date.setUTCDate(date.getUTCDate() + interval)
            break
          case 'weekly': {
            const days = (rec.weekdays ?? []).filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b)
            if (days.length === 0) date.setUTCDate(date.getUTCDate() + 7 * interval)
            else {
              const dow = date.getUTCDay()
              const later = days.find((d) => d > dow)
              date.setUTCDate(date.getUTCDate() + (later != null ? later - dow : 7 * (interval - 1) + 7 - dow + days[0]!))
            }
            break
          }
          case 'monthly':
          case 'yearly': {
            const month = from.month - 1 + interval * (rec.rule === 'yearly' ? 12 : 1)
            const year = from.year + Math.floor(month / 12)
            const targetMonth = month % 12
            const lastDay = new Date(Date.UTC(year, targetMonth + 1, 0)).getUTCDate()
            date.setUTCFullYear(year, targetMonth, Math.min(from.day, lastDay))
            break
          }
          default:
            date.setUTCDate(date.getUTCDate() + 1)
        }
        return { ...wallClock, year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() }
      }
      let nextParts = stepZoned(baseDay)
      let next = zonedDateTimeToEpoch(nextParts, zone)
      let guard = 0
      while (rec.mode !== 'after' && next <= floor && guard < 1000) {
        nextParts = stepZoned(nextParts)
        next = zonedDateTimeToEpoch(nextParts, zone)
        guard += 1
      }
      if (rec.until != null && next > rec.until) return null
      return next
    } catch {
      // Invalid legacy timezone values retain the local-calendar behavior.
    }
  }
  const base = startOfLocalDay(rec.mode === 'after' ? completedAt : anchor)
  const floor = startOfLocalDay(completedAt)
  const step = (from: number): number => {
    switch (rec.rule) {
      case 'daily':
        return dayOffset(from, interval)
      case 'weekly': {
        const days = (rec.weekdays ?? []).filter((d) => d >= 0 && d <= 6).sort()
        if (days.length === 0) return dayOffset(from, 7 * interval)
        const dow = new Date(from).getDay()
        const later = days.find((d) => d > dow)
        if (later != null) return dayOffset(from, later - dow)
        return dayOffset(from, 7 * (interval - 1) + (7 - dow + days[0]!))
      }
      case 'monthly':
        return monthOffset(from, interval)
      case 'yearly':
        return monthOffset(from, 12 * interval)
      default:
        return dayOffset(from, 1)
    }
  }
  let next = step(base)
  // Fixed schedules skip past occurrences so a late completion lands in the future.
  let guard = 0
  while (rec.mode !== 'after' && next <= floor && guard < 1000) {
    next = step(next)
    guard += 1
  }
  if (rec.until != null && next > rec.until) return null
  return next
}
