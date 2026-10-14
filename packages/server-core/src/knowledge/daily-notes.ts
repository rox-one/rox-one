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
  return mergeSessionsBlock(renderDailyTemplate(date, input.template), sessionsForDate(input.sessions ?? [], date))
}

/** The daily template with its placeholders filled; no sessions block. */
export function renderDailyTemplate(dateInput: string, templateInput?: string): string {
  const date = assertDailyDate(dateInput)
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
  return (templateInput?.trim() ? templateInput : fallback)
    .replaceAll('{{date}}', date)
    .replaceAll('{{title}}', date)
    .replaceAll('{{yesterday}}', shiftDate(date, -1))
    .replaceAll('{{tomorrow}}', shiftDate(date, 1))
}

/**
 * Content to create for a missing daily note, or `null` when the file exists.
 * An existing daily note is never rewritten in the background: that moved its
 * revision under an open editor and the next save failed with a false
 * «changed outside this editor» conflict. The day's sessions are rendered live
 * by the Notes view instead of being stored in the body.
 */
export function planDailyNoteWrite(input: { date: string; existing: string | null; template?: string }): string | null {
  if (input.existing !== null) return null
  return renderDailyTemplate(input.date, input.template)
}

/** A line the old writer generated inside the block: a plain `- name` bullet. */
function isGeneratedSessionLine(line: string): boolean {
  return /^- (?!\[[ xX]\]\s)\S/.test(line) && !/\[\[|\]\(|https?:\/\//.test(line)
}

/**
 * One-time cleanup for notes created before the live overlay: drops the stored
 * sessions block markers and the generated `- name` lines. Anything else the
 * user wrote inside the block (tasks, links, prose) is kept in place, and so is
 * the `## Sessions` heading when such lines remain. Returns `null` when there
 * is nothing to strip.
 */
export function stripLegacySessionsBlock(markdown: string): string | null {
  const start = markdown.indexOf(DAILY_SESSIONS_START)
  const end = start < 0 ? -1 : markdown.indexOf(DAILY_SESSIONS_END, start)
  if (start < 0 || end < 0) return null
  const inner = markdown.slice(start + DAILY_SESSIONS_START.length, end)
  const kept = inner.split('\n').filter(line => line.trim() && !isGeneratedSessionLine(line)).join('\n')
  let from = start
  if (!kept) {
    const heading = /(?:^|\n)## Sessions[ \t]*\n+$/.exec(markdown.slice(0, start))
    if (heading) from = heading.index + (heading[0].startsWith('\n') ? 1 : 0)
  }
  const before = markdown.slice(0, from).replace(/\n+$/, '')
  const after = markdown.slice(end + DAILY_SESSIONS_END.length).replace(/^\n+/, '')
  const parts = [before, kept, after].filter(Boolean)
  const joined = parts.join('\n\n')
  return joined.endsWith('\n') ? joined : `${joined}\n`
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
