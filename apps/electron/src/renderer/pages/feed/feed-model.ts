/**
 * Лента — pure view model: team items (local-first team store), filter
 * chips, day grouping, tab counts. The server aggregator (feed:list) owns
 * agents/news/subscriptions; the team tab is merged here because the team
 * model lives in renderer storage.
 */
import type { FeedItem, FeedSource, FeedSourceKind, FeedTab } from '@craft-agent/shared/feed'
import type { TeamActivityEvent } from '@craft-agent/shared/team'

export type FeedChip =
  | 'all'
  | 'running'
  | 'errors'
  | 'waiting'
  | 'sessions'
  | 'automations'
  | 'articles'
  | 'video'
  | 'releases'
  | 'pages'
  | 'x'
  | 'today'
  | 'week'

export const TAB_CHIPS: Record<FeedTab, readonly FeedChip[]> = {
  agents: ['all', 'running', 'errors', 'waiting', 'sessions', 'automations'],
  team: ['all', 'today', 'week'],
  news: ['all', 'articles', 'video', 'releases', 'pages', 'x'],
  subscriptions: ['all', 'today', 'week'],
}

export interface FeedFilter {
  tab: FeedTab
  chip: FeedChip
  sourceId?: string | null
  query?: string
}

const DAY = 86_400_000

function startOfDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

type T = (key: string, opts?: Record<string, unknown>) => string

/** Team activity → «Команда» items. Text is produced by the caller's labeler. */
export function buildTeamItems(events: readonly TeamActivityEvent[], text: (e: TeamActivityEvent) => string): FeedItem[] {
  return events.map((e) => ({
    id: `team:${e.id}`,
    tab: 'team' as const,
    kind: 'team-activity' as const,
    title: text(e),
    at: e.at,
    ...(e.target.title ? { summary: e.target.title } : {}),
    ref: {
      type: e.target.kind === 'automation' ? ('automation' as const) : e.target.kind,
      id: e.target.id,
      ...(e.target.parentId ? { parentId: e.target.parentId } : {}),
    },
    ...(e.target.kind === 'session' ? { sessionId: e.target.id } : e.target.kind === 'message' && e.target.parentId ? { sessionId: e.target.parentId } : {}),
  }))
}

function kindOfSource(sources: ReadonlyMap<string, FeedSource>, item: FeedItem): FeedSourceKind | undefined {
  return item.sourceId ? sources.get(item.sourceId)?.kind : undefined
}

export function matchesChip(item: FeedItem, chip: FeedChip, now: number, sources: ReadonlyMap<string, FeedSource> = new Map()): boolean {
  switch (chip) {
    case 'all':
      return true
    case 'running':
      return item.status === 'running'
    case 'errors':
      return item.status === 'error'
    case 'waiting':
      return item.status === 'waiting'
    case 'sessions':
      return item.kind === 'session'
    case 'automations':
      return item.kind === 'automation-run'
    case 'articles': {
      const k = kindOfSource(sources, item)
      return item.kind === 'news' && k !== 'youtube' && k !== 'github'
    }
    case 'video':
      return kindOfSource(sources, item) === 'youtube'
    case 'releases':
      return kindOfSource(sources, item) === 'github'
    case 'pages':
      return item.kind === 'page-change'
    case 'x':
      return item.kind === 'x-post'
    case 'today':
      return item.at >= startOfDay(now)
    case 'week':
      return item.at >= now - 7 * DAY
  }
}

export function filterFeed(items: readonly FeedItem[], filter: FeedFilter, now: number, sources: readonly FeedSource[] = []): FeedItem[] {
  const byId = new Map(sources.map((s) => [s.id, s]))
  const q = filter.query?.trim().toLowerCase()
  return items
    .filter((i) => i.tab === filter.tab)
    .filter((i) => !filter.sourceId || i.sourceId === filter.sourceId)
    .filter((i) => matchesChip(i, filter.chip, now, byId))
    .filter((i) => !q || `${i.title} ${i.summary ?? ''} ${i.author ?? ''} ${i.sourceTitle ?? ''}`.toLowerCase().includes(q))
    .sort((a, b) => b.at - a.at)
}

export function tabCounts(items: readonly FeedItem[]): Record<FeedTab, number> {
  const out: Record<FeedTab, number> = { agents: 0, team: 0, news: 0, subscriptions: 0 }
  for (const i of items) out[i.tab]++
  return out
}

export function attentionCount(items: readonly FeedItem[]): number {
  return items.filter((i) => i.tab === 'agents' && (i.status === 'error' || i.status === 'waiting')).length
}

export interface DayGroup {
  key: string
  label: 'today' | 'yesterday' | 'earlier'
  day: number
  items: FeedItem[]
}

export function groupByDay(items: readonly FeedItem[], now: number): DayGroup[] {
  const today = startOfDay(now)
  const groups = new Map<number, FeedItem[]>()
  for (const it of items) {
    const d = startOfDay(it.at)
    const list = groups.get(d)
    if (list) list.push(it)
    else groups.set(d, [it])
  }
  return [...groups.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([day, list]) => ({
      key: String(day),
      day,
      label: day >= today ? ('today' as const) : day >= today - DAY ? ('yesterday' as const) : ('earlier' as const),
      items: list,
    }))
}

export type SourceTone = 'success' | 'danger' | 'warning' | 'muted'

export function sourceTone(s: FeedSource): SourceTone {
  switch (s.lastStatus) {
    case 'ok':
      return 'success'
    case 'error':
      return 'danger'
    case 'unsupported':
      return 'warning'
    default:
      return 'muted'
  }
}

/** Human error text for a source status code. */
export function sourceErrorText(code: string | undefined, t: T): string | undefined {
  if (!code) return undefined
  if (code === 'x-not-connected') return t('feed.sources.error.xNotConnected')
  if (code === 'timeout') return t('feed.sources.error.timeout')
  if (code === 'not-a-feed' || code === 'unrecognized-content') return t('feed.sources.error.notAFeed')
  const http = /^http-(\d+)$/.exec(code)
  if (http) return t('feed.sources.error.http', { status: http[1] })
  return code
}

export function sourceLabel(s: FeedSource): string {
  if (s.title) return s.title
  try {
    const u = new URL(s.url)
    return `${u.hostname.replace(/^www\./, '')}${u.pathname === '/' ? '' : u.pathname}`
  } catch {
    return s.url
  }
}
