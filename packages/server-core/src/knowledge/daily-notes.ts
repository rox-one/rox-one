/**
 * Daily notes: install-day + today, auto-tag, and that day's sessions.
 * Local vault only — no external knowledge engine.
 */

export const DAILY_FOLDER = 'daily'
export const INSTALL_DAY_FILE = '.rox-install-day'
export const DAILY_TAG = 'daily'
export const DAILY_SESSIONS_START = '<!-- rox:daily-sessions -->'
export const DAILY_SESSIONS_END = '<!-- /rox:daily-sessions -->'

export type DailySessionRef = {
  id: string
  name: string
  createdAt?: number
  lastMessageAt?: number
}

export function formatDateId(date: Date): string {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export function assertDailyDate(date?: string, now = new Date()): string {
  const value = date?.trim() || formatDateId(now)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Invalid daily note date')
  return value
}

export function dailyNoteId(date?: string, now = new Date()): string {
  return `${DAILY_FOLDER}/${assertDailyDate(date, now)}`
}

export function shiftDate(date: string, deltaDays: number): string {
  const [year, month, day] = date.split('-').map(Number)
  const next = new Date(year!, month! - 1, day)
  next.setDate(next.getDate() + deltaDays)
  return formatDateId(next)
}

export function datesToEnsure(installDate: string, today: string): string[] {
  const dates = [assertDailyDate(installDate), assertDailyDate(today)]
  return [...new Set(dates)]
}

export function sessionFallsOnDate(session: DailySessionRef, date: string): boolean {
  const ts = session.createdAt ?? session.lastMessageAt
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return false
  return formatDateId(new Date(ts)) === date
}

export function sessionsForDate(sessions: readonly DailySessionRef[], date: string): DailySessionRef[] {
  return sessions.filter((session) => sessionFallsOnDate(session, date))
}

export function renderSessionsBlock(sessions: readonly DailySessionRef[]): string {
  const lines = sessions.map((session) => `- ${session.name.replace(/\s+/g, ' ').trim() || session.id}`)
  const inner = lines.length > 0 ? lines.join('\n') : ''
  return `${DAILY_SESSIONS_START}\n${inner}${inner ? '\n' : ''}${DAILY_SESSIONS_END}`
}

export function mergeSessionsBlock(markdown: string, sessions: readonly DailySessionRef[]): string {
  const block = renderSessionsBlock(sessions)
  if (markdown.includes(DAILY_SESSIONS_START) && markdown.includes(DAILY_SESSIONS_END)) {
    return markdown.replace(
      new RegExp(`${escapeRegExp(DAILY_SESSIONS_START)}[\\s\\S]*?${escapeRegExp(DAILY_SESSIONS_END)}`),
      block,
    )
  }
  const trimmed = markdown.trimEnd()
  return `${trimmed}\n\n## Sessions\n\n${block}\n`
}

export function ensureDailyTag(tags: unknown): string[] {
  const list = Array.isArray(tags) ? tags.map(String).filter(Boolean) : []
  if (!list.includes(DAILY_TAG)) list.push(DAILY_TAG)
  return list
}

export function buildDailyNoteMarkdown(input: {
  date: string
  sessions?: readonly DailySessionRef[]
  template?: string
}): string {
  const date = assertDailyDate(input.date)
  const fallback = [
    '---',
    'title: "{{date}}"',
    'tags:',
    `  - ${DAILY_TAG}`,
    '---',
    '',
    '# {{date}}',
    '',
  ].join('\n')
  const template = (input.template?.trim() ? input.template : fallback)
    .replaceAll('{{date}}', date)
    .replaceAll('{{title}}', date)
    .replaceAll('{{yesterday}}', shiftDate(date, -1))
    .replaceAll('{{tomorrow}}', shiftDate(date, 1))
  return mergeSessionsBlock(template, sessionsForDate(input.sessions ?? [], date))
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
