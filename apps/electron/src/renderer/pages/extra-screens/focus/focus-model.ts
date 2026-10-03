/**
 * Фокус — pure helpers: today's calendar, top-3 task ranking and the day
 * summary section upserted into the daily note between markers.
 */
import type { PersonalTask } from '@rox/core/tasks/personal'

export interface DayEvent {
  id: string
  title: string
  startAt: number
  endAt?: number
  allDay?: boolean
  kind: 'calendar' | 'meeting'
}

export function startOfDay(now: number): number {
  const d = new Date(now)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** Calendar events from the persisted CalendarStore bundle (`rox.calendar.v1`). */
export function calendarEventsToday(bundle: unknown, now: number): { connected: boolean; events: DayEvent[] } {
  if (!bundle || typeof bundle !== 'object') return { connected: false, events: [] }
  const b = bundle as { accounts?: unknown[]; events?: unknown[] }
  const connected = Array.isArray(b.accounts) && b.accounts.length > 0
  const dayStart = startOfDay(now)
  const dayEnd = dayStart + 86400000
  const events: DayEvent[] = []
  for (const raw of Array.isArray(b.events) ? b.events : []) {
    if (!raw || typeof raw !== 'object') continue
    const e = raw as { id?: string; title?: string; startAt?: number; endAt?: number; allDay?: boolean; deleted?: boolean; accountId?: string }
    if (e.deleted || typeof e.startAt !== 'number') continue
    const end = typeof e.endAt === 'number' ? e.endAt : e.startAt
    if (e.startAt >= dayEnd || end < dayStart) continue
    events.push({ id: `${e.accountId ?? ''}:${e.id ?? e.startAt}`, title: e.title || '—', startAt: e.startAt, endAt: e.endAt, allDay: e.allDay, kind: 'calendar' })
  }
  return { connected, events }
}

export function mergeDay(calendar: readonly DayEvent[], meetings: readonly DayEvent[]): DayEvent[] {
  return [...calendar, ...meetings].sort((a, b) => (a.allDay === b.allDay ? a.startAt - b.startAt : a.allDay ? -1 : 1))
}

const PRIORITY: Record<string, number> = { high: 3, medium: 2, low: 1, none: 0 }

function isOpen(task: PersonalTask): boolean {
  return !task.completedAt && !task.cancelledAt
}

/** Pinned first (in pin order), then today/overdue, then priority, then order. */
export function rankTopTasks(tasks: readonly PersonalTask[], pinned: readonly string[], now: number, limit = 3): PersonalTask[] {
  const open = tasks.filter(isOpen)
  const byId = new Map(open.map((t) => [t.id, t]))
  const out: PersonalTask[] = pinned.map((id) => byId.get(id)).filter((t): t is PersonalTask => !!t)
  const dayEnd = startOfDay(now) + 86400000
  const score = (t: PersonalTask) =>
    (t.list === 'today' || (t.dueAt != null && t.dueAt < dayEnd) ? 10 : 0) + (PRIORITY[t.priority] ?? 0)
  const rest = open
    .filter((t) => !pinned.includes(t.id))
    .sort((a, b) => score(b) - score(a) || a.order - b.order || a.createdAt - b.createdAt)
  for (const t of rest) {
    if (out.length >= limit) break
    out.push(t)
  }
  return out.slice(0, limit)
}

export function completedToday(tasks: readonly PersonalTask[], now: number): PersonalTask[] {
  const dayStart = startOfDay(now)
  return tasks.filter((t) => t.completedAt != null && t.completedAt >= dayStart)
}

export const SUMMARY_START = '<!-- rox:focus-summary -->'
export const SUMMARY_END = '<!-- /rox:focus-summary -->'

export interface DaySummaryInput {
  now: number
  focus: { sessions: number; minutes: number }
  done: readonly string[]
  meetings: readonly string[]
  deferred: number
  inboxLeft: number | null
  language: 'ru' | 'en'
}

function hm(minutes: number, ru: boolean): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (ru) return h ? `${h} ч ${m} мин` : `${m} мин`
  return h ? `${h} h ${m} min` : `${m} min`
}

export function buildDaySummary(input: DaySummaryInput): string {
  const ru = input.language === 'ru'
  const date = new Date(input.now).toLocaleDateString(ru ? 'ru-RU' : 'en-US', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const lines = [
    `## ${ru ? 'Итоги дня' : 'Day summary'} · ${date}`,
    `- ${ru ? 'Фокус' : 'Focus'}: ${input.focus.sessions} · ${hm(input.focus.minutes, ru)}`,
    `- ${ru ? 'Сделано задач' : 'Tasks done'}: ${input.done.length}`,
    ...input.done.slice(0, 10).map((title) => `  - [x] ${title}`),
  ]
  if (input.meetings.length) {
    lines.push(`- ${ru ? 'Встречи' : 'Meetings'}: ${input.meetings.length}`)
    lines.push(...input.meetings.slice(0, 10).map((title) => `  - ${title}`))
  }
  lines.push(`- ${ru ? 'Отложенные во время фокуса вопросы агентов' : 'Agent questions deferred during focus'}: ${input.deferred}`)
  if (input.inboxLeft != null) lines.push(`- ${ru ? 'Осталось во Входящих' : 'Left in Inbox'}: ${input.inboxLeft}`)
  return lines.join('\n')
}

/** Insert or replace the marked summary section; everything else is kept. */
export function upsertSummarySection(content: string, summary: string): string {
  const block = `${SUMMARY_START}\n${summary}\n${SUMMARY_END}`
  const start = content.indexOf(SUMMARY_START)
  const end = content.indexOf(SUMMARY_END)
  if (start >= 0 && end > start) {
    return content.slice(0, start) + block + content.slice(end + SUMMARY_END.length)
  }
  const trimmed = content.replace(/\s+$/, '')
  return trimmed ? `${trimmed}\n\n${block}\n` : `${block}\n`
}
