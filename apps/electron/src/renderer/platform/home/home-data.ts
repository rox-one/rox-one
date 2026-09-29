/**
 * Главная widgets — pure projections over data the app already has (session
 * metadata, LLM connections, automations, local meetings, personal tasks,
 * notes, radar/decisions stores). No I/O, no invented numbers: a missing
 * measurement stays null/empty and the widget shows an honest empty state.
 */

const DAY_MS = 86_400_000

export function startOfLocalDay(ts: number): number {
  const d = new Date(ts)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

// ---------------------------------------------------------------------------
// Расход и токены / Модели
// ---------------------------------------------------------------------------

export interface UsageSessionLike {
  model?: string
  llmConnection?: string
  lastMessageAt?: number
  createdAt?: number
  tokenUsage?: { totalTokens?: number; costUsd?: number }
}

export interface UsageDay {
  /** Local midnight of the day. */
  start: number
  tokens: number
  costUsd: number
  sessions: number
}

export interface UsageOverview {
  /** Oldest → newest, `days` entries ending today. */
  days: UsageDay[]
  today: UsageDay
  totalTokens: number
  totalCostUsd: number
  /** False when no session in the window carries token usage at all. */
  hasData: boolean
}

function usageOf(session: UsageSessionLike): { tokens: number; cost: number } | null {
  const usage = session.tokenUsage
  if (!usage) return null
  const tokens = Number.isFinite(usage.totalTokens) ? usage.totalTokens ?? 0 : 0
  const cost = Number.isFinite(usage.costUsd) ? usage.costUsd ?? 0 : 0
  if (tokens === 0 && cost === 0) return null
  return { tokens, cost }
}

function activityAt(session: UsageSessionLike): number {
  return session.lastMessageAt ?? session.createdAt ?? 0
}

/**
 * Session usage is a running total per session (JSONL header), not a
 * per-message ledger, so each session's usage is attributed to the day of its
 * last activity. The widget says so.
 */
export function buildUsageOverview(sessions: readonly UsageSessionLike[], now: number, days = 7): UsageOverview {
  const todayStart = startOfLocalDay(now)
  const buckets: UsageDay[] = []
  for (let i = days - 1; i >= 0; i -= 1) {
    buckets.push({ start: startOfLocalDay(todayStart - i * DAY_MS + DAY_MS / 2), tokens: 0, costUsd: 0, sessions: 0 })
  }
  const windowStart = buckets[0]!.start
  let hasData = false
  for (const session of sessions) {
    const at = activityAt(session)
    if (at < windowStart) continue
    const usage = usageOf(session)
    if (!usage) continue
    const dayStart = startOfLocalDay(at)
    const bucket = buckets.find((b) => b.start === dayStart)
    if (!bucket) continue
    hasData = true
    bucket.tokens += usage.tokens
    bucket.costUsd += usage.cost
    bucket.sessions += 1
  }
  return {
    days: buckets,
    today: buckets[buckets.length - 1]!,
    totalTokens: buckets.reduce((sum, b) => sum + b.tokens, 0),
    totalCostUsd: buckets.reduce((sum, b) => sum + b.costUsd, 0),
    hasData,
  }
}

export interface ModelUsage {
  /** Model id as stored on the session, or '' when the session used the connection default. */
  model: string
  connection?: string
  sessions: number
  tokens: number
  costUsd: number
}

/** Usage per model over sessions active since `since` (tokens desc). */
export function usageByModel(sessions: readonly UsageSessionLike[], since: number): ModelUsage[] {
  const map = new Map<string, ModelUsage>()
  for (const session of sessions) {
    if (activityAt(session) < since) continue
    const model = session.model?.trim() ?? ''
    const key = model || `@${session.llmConnection ?? ''}`
    const row = map.get(key) ?? { model, connection: session.llmConnection, sessions: 0, tokens: 0, costUsd: 0 }
    row.sessions += 1
    const usage = usageOf(session)
    if (usage) {
      row.tokens += usage.tokens
      row.costUsd += usage.cost
    }
    map.set(key, row)
  }
  return [...map.values()].sort((a, b) => b.tokens - a.tokens || b.sessions - a.sessions)
}

export interface ConnectionLike {
  slug: string
  name: string
  providerType?: string
  defaultModel?: string
  isAuthenticated?: boolean
  isDefault?: boolean
}

export interface ConnectionUsage {
  slug: string
  name: string
  providerType?: string
  defaultModel?: string
  authenticated: boolean
  isDefault: boolean
  sessions: number
  tokens: number
}

/**
 * Configured connections with how much they were used since `since`.
 * Sessions without an explicit connection count toward the default one.
 */
export function connectionUsage(
  connections: readonly ConnectionLike[],
  sessions: readonly UsageSessionLike[],
  since: number,
  workspaceDefault?: string,
): ConnectionUsage[] {
  const defaultSlug = workspaceDefault ?? connections.find((c) => c.isDefault)?.slug
  const rows = new Map<string, ConnectionUsage>()
  for (const c of connections) {
    rows.set(c.slug, {
      slug: c.slug,
      name: c.name || c.slug,
      providerType: c.providerType,
      defaultModel: c.defaultModel,
      authenticated: c.isAuthenticated !== false,
      isDefault: c.slug === defaultSlug,
      sessions: 0,
      tokens: 0,
    })
  }
  for (const session of sessions) {
    if (activityAt(session) < since) continue
    const slug = session.llmConnection ?? defaultSlug
    const row = slug ? rows.get(slug) : undefined
    if (!row) continue
    row.sessions += 1
    row.tokens += usageOf(session)?.tokens ?? 0
  }
  return [...rows.values()].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || b.sessions - a.sessions || a.name.localeCompare(b.name))
}

// ---------------------------------------------------------------------------
// Автоматизации
// ---------------------------------------------------------------------------

export interface AutomationLike {
  id: string
  name: string
  enabled: boolean
  cron?: string
  timezone?: string
}

export interface AutomationRunRef {
  id: string
  name: string
  at: number
}

export interface AutomationsOverview {
  enabled: number
  paused: number
  next: AutomationRunRef[]
  failures: AutomationRunRef[]
}

export function buildAutomationsOverview(
  automations: readonly AutomationLike[],
  last: Readonly<Record<string, { ts: number; ok: boolean } | undefined>>,
  nextRun: (automation: AutomationLike) => number | null,
  now: number,
  limit = 3,
): AutomationsOverview {
  const next: AutomationRunRef[] = []
  const failures: AutomationRunRef[] = []
  for (const a of automations) {
    if (a.enabled && a.cron) {
      const at = nextRun(a)
      if (at != null && at >= now) next.push({ id: a.id, name: a.name, at })
    }
    const l = last[a.id]
    if (l && !l.ok && Number.isFinite(l.ts)) failures.push({ id: a.id, name: a.name, at: l.ts })
  }
  next.sort((x, y) => x.at - y.at)
  failures.sort((x, y) => y.at - x.at)
  return {
    enabled: automations.filter((a) => a.enabled).length,
    paused: automations.filter((a) => !a.enabled).length,
    next: next.slice(0, limit),
    failures: failures.slice(0, limit),
  }
}

// ---------------------------------------------------------------------------
// Встречи
// ---------------------------------------------------------------------------

export interface MeetingLike {
  id: string
  title: string
  status: 'planned' | 'recording' | 'paused' | 'ready'
  createdAt: number
  scheduledAt?: number
  startedAt?: number
  endedAt?: number
  transcript?: { status: string }
}

export interface MeetingsOverview<T extends MeetingLike> {
  live: T | null
  upcoming: T[]
  last: T | null
}

export function buildMeetingsOverview<T extends MeetingLike>(meetings: readonly T[], now: number, upcomingLimit = 2): MeetingsOverview<T> {
  const live = meetings.find((m) => m.status === 'recording' || m.status === 'paused') ?? null
  const upcoming = meetings
    .filter((m) => m.status === 'planned' && m.scheduledAt != null && m.scheduledAt >= now - 15 * 60_000)
    .sort((a, b) => (a.scheduledAt ?? 0) - (b.scheduledAt ?? 0))
    .slice(0, upcomingLimit)
  const done = meetings
    .filter((m) => m.status === 'ready')
    .sort((a, b) => (b.endedAt ?? b.startedAt ?? b.createdAt) - (a.endedAt ?? a.startedAt ?? a.createdAt))
  return { live, upcoming, last: done[0] ?? null }
}

// ---------------------------------------------------------------------------
// Задачи / Фокус
// ---------------------------------------------------------------------------

export interface TaskLike {
  id: string
  title: string
  list: string
  priority: string
  dueAt?: number
  completedAt?: number
  cancelledAt?: number
  createdAt: number
  order?: number
}

export function isOpenTaskLike(task: TaskLike): boolean {
  return !task.completedAt && !task.cancelledAt
}

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2, none: 3 }

/**
 * Top open tasks: pinned top-3 first, then overdue/due today, today list, by
 * priority, then due date. `overdue` counts open tasks past their due day.
 */
export function topOpenTasks<T extends TaskLike>(
  tasks: readonly T[],
  top3: readonly string[],
  now: number,
  limit = 5,
): { open: number; overdue: number; today: number; top: T[] } {
  const dayEnd = startOfLocalDay(now) + DAY_MS
  const open = tasks.filter(isOpenTaskLike)
  const pinned = new Map(top3.map((id, i) => [id, i]))
  const score = (t: T): number[] => [
    pinned.has(t.id) ? pinned.get(t.id)! : 99,
    t.dueAt != null && t.dueAt < dayEnd ? 0 : 1,
    t.list === 'today' ? 0 : 1,
    PRIORITY_RANK[t.priority] ?? 3,
    t.dueAt ?? Number.MAX_SAFE_INTEGER,
    t.order ?? t.createdAt,
  ]
  const sorted = open.slice().sort((a, b) => {
    const sa = score(a)
    const sb = score(b)
    for (let i = 0; i < sa.length; i += 1) if (sa[i] !== sb[i]) return sa[i]! - sb[i]!
    return 0
  })
  return {
    open: open.length,
    overdue: open.filter((t) => t.dueAt != null && t.dueAt < startOfLocalDay(now)).length,
    today: open.filter((t) => t.list === 'today' || (t.dueAt != null && t.dueAt < dayEnd)).length,
    top: sorted.slice(0, limit),
  }
}

// ---------------------------------------------------------------------------
// Заметки / Радар / Решения
// ---------------------------------------------------------------------------

export function recentByUpdated<T extends { updatedAt: number }>(items: readonly T[], limit = 5): T[] {
  return items.slice().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit)
}

export interface RadarLike {
  topics: readonly unknown[]
  dismissed: readonly string[]
  sweeps: ReadonlyArray<{ startedAt: number; parsedAt?: number; parseFailed?: boolean; items?: ReadonlyArray<{ id: string; title: string; bucket: string; url?: string; source: string }> }>
}

/** Signals of the latest parsed sweep, minus the ones the user dismissed. */
export function radarSignals(data: RadarLike, limit = 4) {
  const latest = data.sweeps
    .filter((s) => s.parsedAt && !s.parseFailed)
    .sort((a, b) => b.startedAt - a.startedAt)[0]
  const running = data.sweeps.some((s) => !s.parsedAt)
  const dismissed = new Set(data.dismissed)
  const items = (latest?.items ?? []).filter((i) => !dismissed.has(i.id))
  const bucketRank: Record<string, number> = { reaction: 0, important: 1, changed: 2 }
  return {
    topics: data.topics.length,
    running,
    sweptAt: latest?.startedAt ?? null,
    total: items.length,
    items: items.slice().sort((a, b) => (bucketRank[a.bucket] ?? 3) - (bucketRank[b.bucket] ?? 3)).slice(0, limit),
  }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatTokens(tokens: number): string {
  if (tokens < 1000) return String(Math.round(tokens))
  if (tokens < 1_000_000) {
    const k = tokens / 1000
    return `${k >= 10 ? k.toFixed(0) : k.toFixed(1)}k`
  }
  return `${(tokens / 1_000_000).toFixed(1)}M`
}

export function formatUsd(cost: number): string {
  if (cost === 0) return '$0'
  if (cost < 0.01) return '<$0.01'
  return `$${cost.toFixed(2)}`
}
