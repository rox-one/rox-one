/**
 * Pure aggregation for the «Активность» screen: summary numbers, daily/weekly
 * trends and top projects/sources over the workspace's session metadata.
 *
 * Every function is total — empty input yields zeroed buckets of the requested
 * length, never NaN or a thrown error — so the screen can render an honest
 * empty state without guards at each call site.
 *
 * Day and week boundaries are LOCAL calendar dates (same rule as the session
 * heatmap: `localDayKey`), never UTC ISO slices.
 */
import {
  classifyAgentFamily,
  localDayKey,
  sessionActivityAt,
  sessionTokenTotal,
} from '@rox/shared/sessions/collection'

/** Agent-family buckets this screen groups sources by (mirrors `classifyAgentFamily`). */
export type ActivitySourceFamily = 'claude' | 'codex' | 'hermes' | 'opencode' | 'omp' | 'other'

/** Minimal session shape this screen aggregates (renderer SessionMeta is assignable). */
export interface ActivitySession {
  id: string
  projectId?: string | null
  projectIds?: string[] | null
  createdAt?: number | null
  lastMessageAt?: number | null
  messageCount?: number | null
  tokenUsage?: { totalTokens?: number } | null
  toolCallCount?: number | null
  commitCount?: number | null
  model?: string | null
  llmConnection?: string | null
}

export interface ActivityTotals {
  sessions: number
  messages: number
  tokens: number
  toolCalls: number
  commits: number
}

export interface ActivityTrendPoint {
  /** Local day key of the bucket start (YYYY-MM-DD). */
  key: string
  /** Bucket start, epoch ms, local midnight. */
  startAt: number
  sessions: number
  messages: number
}

export interface ActivityTopProject {
  id: string
  name: string
  sessions: number
  messages: number
}

export interface ActivityTopSource {
  family: ActivitySourceFamily
  sessions: number
}

export interface NamedProject {
  id: string
  name: string
}

function finite(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** Local midnight of the day containing `ts`. */
export function startOfLocalDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Local midnight of the Monday that starts the week containing `ts`. */
export function startOfLocalWeek(ts: number): number {
  const d = new Date(startOfLocalDay(ts))
  const mondayOffset = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - mondayOffset)
  return d.getTime()
}

/** The project a session is attributed to: explicit `projectId`, else the first `projectIds`. */
export function primaryProjectId(session: Pick<ActivitySession, 'projectId' | 'projectIds'>): string | null {
  return session.projectId ?? session.projectIds?.[0] ?? null
}

/** Summary numbers over a set of sessions. Nulls count as 0; tokens come from `sessionTokenTotal`. */
export function activityTotals(sessions: readonly ActivitySession[]): ActivityTotals {
  const totals: ActivityTotals = { sessions: 0, messages: 0, tokens: 0, toolCalls: 0, commits: 0 }
  for (const session of sessions) {
    totals.sessions += 1
    totals.messages += finite(session.messageCount)
    totals.tokens += sessionTokenTotal(session) ?? 0
    totals.toolCalls += finite(session.toolCallCount)
    totals.commits += finite(session.commitCount)
  }
  return totals
}

/** Sessions whose latest activity falls inside `[fromTs, toTs)` (local time is irrelevant: ms bounds). */
export function sessionsInWindow(
  sessions: readonly ActivitySession[],
  fromTs: number,
  toTs: number,
): ActivitySession[] {
  return sessions.filter((session) => {
    const ts = sessionActivityAt(session)
    return ts != null && ts >= fromTs && ts < toTs
  })
}

function bucketize(
  sessions: readonly ActivitySession[],
  buckets: Array<{ key: string; startAt: number }>,
  keyOf: (ts: number) => string,
): ActivityTrendPoint[] {
  const byKey = new Map(buckets.map((bucket) => [bucket.key, { sessions: 0, messages: 0 }]))
  for (const session of sessions) {
    const ts = sessionActivityAt(session)
    if (ts == null) continue
    const slot = byKey.get(keyOf(ts))
    if (!slot) continue
    slot.sessions += 1
    slot.messages += finite(session.messageCount)
  }
  return buckets.map((bucket) => ({ key: bucket.key, startAt: bucket.startAt, ...byKey.get(bucket.key)! }))
}

/** Daily buckets for the last `days` local days (today last). `days <= 0` yields `[]`. */
export function dailyTrend(sessions: readonly ActivitySession[], now: number, days: number): ActivityTrendPoint[] {
  if (!Number.isFinite(days) || days <= 0) return []
  const base = new Date(startOfLocalDay(now))
  const buckets = Array.from({ length: days }, (_, index) => {
    const day = new Date(base)
    day.setDate(day.getDate() - (days - 1 - index))
    return { key: localDayKey(day.getTime()), startAt: day.getTime() }
  })
  return bucketize(sessions, buckets, localDayKey)
}

/** Weekly buckets (Monday-start) for the last `weeks` weeks (current week last). `weeks <= 0` yields `[]`. */
export function weeklyTrend(sessions: readonly ActivitySession[], now: number, weeks: number): ActivityTrendPoint[] {
  if (!Number.isFinite(weeks) || weeks <= 0) return []
  const base = new Date(startOfLocalWeek(now))
  const buckets = Array.from({ length: weeks }, (_, index) => {
    const week = new Date(base)
    week.setDate(week.getDate() - (weeks - 1 - index) * 7)
    return { key: localDayKey(week.getTime()), startAt: week.getTime() }
  })
  return bucketize(sessions, buckets, (ts) => localDayKey(startOfLocalWeek(ts)))
}

/**
 * Top projects by activity. A project with no sessions is omitted; sessions
 * whose projectId is not in the catalog keep their raw id as the label.
 * Ties break by name (locale-neutral ordinal) then id, so the order is stable.
 */
export function topProjects(
  sessions: readonly ActivitySession[],
  projects: readonly NamedProject[],
  limit = 5,
): ActivityTopProject[] {
  if (limit <= 0) return []
  const names = new Map(projects.map((project) => [project.id, project.name]))
  const counts = new Map<string, { sessions: number; messages: number }>()
  for (const session of sessions) {
    const id = primaryProjectId(session)
    if (!id) continue
    const slot = counts.get(id) ?? { sessions: 0, messages: 0 }
    slot.sessions += 1
    slot.messages += finite(session.messageCount)
    counts.set(id, slot)
  }
  return [...counts.entries()]
    .map(([id, count]) => ({ id, name: names.get(id) ?? id, ...count }))
    .sort((a, b) => b.sessions - a.sessions || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || (a.id < b.id ? -1 : 1))
    .slice(0, limit)
}

/** Top sources (agent families) by session count. Empty input yields `[]`. */
export function topSources(sessions: readonly ActivitySession[], limit = 5): ActivityTopSource[] {
  if (limit <= 0) return []
  const counts = new Map<ActivitySourceFamily, number>()
  for (const session of sessions) {
    const family = classifyAgentFamily({ model: session.model, llmConnection: session.llmConnection })
    counts.set(family, (counts.get(family) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([family, count]) => ({ family, sessions: count }))
    .sort((a, b) => b.sessions - a.sessions || (a.family < b.family ? -1 : 1))
    .slice(0, limit)
}

/** Compact count for summary tiles: 999, 1.2k, 3.4M. Negative/NaN → "0". */
export function formatCompactCount(value: number): string {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0
  const abs = Math.abs(n)
  if (abs < 1000) return String(Math.round(n))
  if (abs < 1_000_000) return `${(n / 1000).toFixed(abs < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}