/**
 * GitHub-style year heatmap for sessions (Issue 05).
 * Days are local calendar dates, never UTC ISO slices.
 */

import type { CollectionOrderDir } from './collection-types.ts'
import type { CollectionSessionMeta } from './collection-query.ts'

const MS_PER_DAY = 24 * 60 * 60 * 1000

export type HeatmapNavDir = 'left' | 'right' | 'up' | 'down'
export type HeatmapLevel = 0 | 1 | 2 | 3 | 4
export type HeatmapDayOrderBy =
  | 'name'
  | 'lastMessageAt'
  | 'createdAt'
  | 'messages'
  | 'tokens'
  | 'duration'
  | 'size'
  | 'toolCalls'
  | 'commits'
  | 'parallelAgents'

export interface HeatmapCell {
  /** YYYY-MM-DD when the cell is in the displayed year; otherwise null. */
  key: string | null
  inYear: boolean
  count: number
  level: HeatmapLevel
}

export interface HeatmapMonthLabel {
  weekIndex: number
  /** 1–12 */
  month: number
}

export interface YearHeatmap {
  year: number
  todayKey: string
  /** Column-major: `weeks[col][row]`, row 0 = Sunday. */
  weeks: HeatmapCell[][]
  monthLabels: HeatmapMonthLabel[]
  maxCount: number
}

export function localDayKey(ts: number): string {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function parseDayKey(key: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!match) return null
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null
  return { y, m, d }
}

export function sessionActivityAt(
  meta: Pick<CollectionSessionMeta, 'lastMessageAt' | 'createdAt'>,
): number | null {
  const ts = meta.lastMessageAt ?? meta.createdAt
  return ts != null && Number.isFinite(ts) ? ts : null
}

export function sessionDurationMs(
  meta: Pick<CollectionSessionMeta, 'lastMessageAt' | 'createdAt'>,
): number | null {
  if (meta.createdAt == null || meta.lastMessageAt == null) return null
  if (!Number.isFinite(meta.createdAt) || !Number.isFinite(meta.lastMessageAt)) return null
  const duration = meta.lastMessageAt - meta.createdAt
  return duration >= 0 ? duration : null
}

export function sessionTokenTotal(
  meta: Pick<CollectionSessionMeta, 'tokenUsage'>,
): number | null {
  const total = meta.tokenUsage?.totalTokens
  return total != null && Number.isFinite(total) ? total : null
}

export function sessionsOnDay<T extends Pick<CollectionSessionMeta, 'lastMessageAt' | 'createdAt'>>(
  sessions: readonly T[],
  dayKey: string,
): T[] {
  return sessions.filter((session) => {
    const ts = sessionActivityAt(session)
    return ts != null && localDayKey(ts) === dayKey
  })
}

function heatLevel(count: number, maxCount: number): HeatmapLevel {
  if (count <= 0) return 0
  if (maxCount <= 1) return 1
  const ratio = count / maxCount
  if (ratio <= 0.25) return 1
  if (ratio <= 0.5) return 2
  if (ratio <= 0.75) return 3
  return 4
}

function daysInYear(year: number): number {
  const start = new Date(year, 0, 1).getTime()
  const end = new Date(year, 11, 31).getTime()
  return Math.round((end - start) / MS_PER_DAY) + 1
}

function dayOfYear(key: string): number | null {
  const parsed = parseDayKey(key)
  if (!parsed) return null
  const jan1 = new Date(parsed.y, 0, 1).getTime()
  const day = new Date(parsed.y, parsed.m - 1, parsed.d).getTime()
  return Math.round((day - jan1) / MS_PER_DAY)
}

export function keyFromDayOfYear(year: number, dayIndex: number): string {
  const count = daysInYear(year)
  const wrapped = ((dayIndex % count) + count) % count
  return localDayKey(new Date(year, 0, 1 + wrapped).getTime())
}

export function heatmapNavigate(focusedKey: string, dir: HeatmapNavDir, year: number): string {
  const delta = dir === 'left' ? -1 : dir === 'right' ? 1 : dir === 'up' ? -7 : 7
  const parsed = parseDayKey(focusedKey)
  if (!parsed || parsed.y !== year) return localDayKey(new Date(year, 0, 1).getTime())
  const index = dayOfYear(focusedKey)
  if (index == null) return localDayKey(new Date(year, 0, 1).getTime())
  return keyFromDayOfYear(year, index + delta)
}

/** Home: today when it belongs to `year`, otherwise Jan 1. */
export function heatmapHomeKey(year: number, todayKey: string): string {
  return todayKey.startsWith(`${year}-`) ? todayKey : `${year}-01-01`
}

/** End: Dec 31 of the displayed year. */
export function heatmapEndKey(year: number): string {
  return `${year}-12-31`
}

export function buildYearHeatmap(
  sessions: ReadonlyArray<Pick<CollectionSessionMeta, 'lastMessageAt' | 'createdAt'>>,
  year: number,
  now: number,
): YearHeatmap {
  const counts = new Map<string, number>()
  for (const session of sessions) {
    const ts = sessionActivityAt(session)
    if (ts == null) continue
    const key = localDayKey(ts)
    const parsed = parseDayKey(key)
    if (!parsed || parsed.y !== year) continue
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  const jan1 = new Date(year, 0, 1)
  const dec31 = new Date(year, 11, 31)
  const cursor = new Date(year, 0, 1 - jan1.getDay())
  const last = new Date(year, 11, 31 + (6 - dec31.getDay()))

  const weeks: HeatmapCell[][] = []
  while (cursor.getTime() <= last.getTime()) {
    const week: HeatmapCell[] = []
    for (let row = 0; row < 7; row++) {
      const inYear = cursor.getFullYear() === year
      const key = inYear ? localDayKey(cursor.getTime()) : null
      const count = key ? (counts.get(key) ?? 0) : 0
      week.push({ key, inYear, count, level: 0 })
      cursor.setDate(cursor.getDate() + 1)
    }
    weeks.push(week)
  }

  const maxCount = counts.size === 0 ? 0 : Math.max(...counts.values())
  for (const week of weeks) {
    for (const cell of week) {
      cell.level = heatLevel(cell.count, maxCount)
    }
  }

  const monthLabels: HeatmapMonthLabel[] = []
  let lastMonth = 0
  for (let weekIndex = 0; weekIndex < weeks.length; weekIndex++) {
    const firstInYear = weeks[weekIndex]?.find((cell) => cell.inYear && cell.key)
    if (!firstInYear?.key) continue
    const month = Number(firstInYear.key.slice(5, 7))
    if (month !== lastMonth) {
      monthLabels.push({ weekIndex, month })
      lastMonth = month
    }
  }

  return {
    year,
    todayKey: localDayKey(now),
    weeks,
    monthLabels,
    maxCount,
  }
}

function cmpNullable(
  a: number | null | undefined,
  b: number | null | undefined,
  dir: CollectionOrderDir,
): number {
  const aNull = a == null || !Number.isFinite(a)
  const bNull = b == null || !Number.isFinite(b)
  if (aNull && bNull) return 0
  if (aNull) return dir === 'asc' ? 1 : -1
  if (bNull) return dir === 'asc' ? -1 : 1
  const d = (a as number) - (b as number)
  return dir === 'asc' ? d : -d
}

export function compareDaySessions(
  a: CollectionSessionMeta,
  b: CollectionSessionMeta,
  orderBy: HeatmapDayOrderBy,
  orderDir: CollectionOrderDir,
): number {
  let primary = 0
  switch (orderBy) {
    case 'name':
      primary = (a.name ?? '').toLocaleLowerCase().localeCompare((b.name ?? '').toLocaleLowerCase())
      if (orderDir === 'desc') primary = -primary
      break
    case 'lastMessageAt':
      primary = cmpNullable(a.lastMessageAt, b.lastMessageAt, orderDir)
      break
    case 'createdAt':
      primary = cmpNullable(a.createdAt, b.createdAt, orderDir)
      break
    case 'messages':
      primary = cmpNullable(a.messageCount, b.messageCount, orderDir)
      break
    case 'tokens':
      primary = cmpNullable(sessionTokenTotal(a), sessionTokenTotal(b), orderDir)
      break
    case 'duration':
      primary = cmpNullable(sessionDurationMs(a), sessionDurationMs(b), orderDir)
      break
    case 'size':
      primary = cmpNullable(a.transcriptBytes, b.transcriptBytes, orderDir)
      break
    case 'toolCalls':
      primary = cmpNullable(a.toolCallCount, b.toolCallCount, orderDir)
      break
    case 'commits':
      primary = cmpNullable(a.commitCount, b.commitCount, orderDir)
      break
    case 'parallelAgents':
      primary = cmpNullable(a.parallelAgentCount, b.parallelAgentCount, orderDir)
      break
    default: {
      const _never: never = orderBy
      void _never
    }
  }
  if (primary !== 0) return primary
  if (a.id < b.id) return -1
  if (a.id > b.id) return 1
  return 0
}
