/**
 * Лента — pure view model: team items (local-first team store), filter
 * chips, day grouping, tab counts. The server aggregator (feed:list) owns
 * agents/news/subscriptions; the team tab is merged here because the team
 * model lives in renderer storage.
 */
import type { FeedColor, FeedItem, FeedItemAnnotation, FeedSource, FeedSourceKind, FeedTab } from '@craft-agent/shared/feed'
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

// ── redesign: annotations, filters, sort, sources health ─────────────────────

/** Item with user annotations applied; color/tags fall back to the source's. */
export interface FeedViewItem extends FeedItem {
  /** Effective tags: own ∪ source defaults. */
  tags: string[]
  ownTags: string[]
  /** Effective color: own ?? source color. */
  color?: FeedColor
  ownColor?: FeedColor
  starred: boolean
  read: boolean
}

export function applyAnnotations(
  items: readonly FeedItem[],
  annotations: Readonly<Record<string, FeedItemAnnotation>> = {},
  sources: ReadonlyMap<string, FeedSource> = new Map(),
): FeedViewItem[] {
  return items.map((it) => {
    const a = annotations[it.id]
    const src = it.sourceId ? sources.get(it.sourceId) : undefined
    const ownTags = a?.tags ?? []
    const seen = new Set(ownTags.map((x) => x.toLowerCase()))
    const tags = [...ownTags, ...(src?.tags ?? []).filter((x) => !seen.has(x.toLowerCase()))]
    const color = a?.color ?? src?.color
    return {
      ...it,
      tags,
      ownTags,
      ...(color ? { color } : {}),
      ...(a?.color ? { ownColor: a.color } : {}),
      starred: !!a?.starred,
      read: !!a?.readAt,
    }
  })
}

export type FeedOrder = 'newest' | 'oldest'
export type FeedMark = 'all' | 'unread' | 'starred'

export interface FeedViewFilter {
  tab: FeedTab
  chip: FeedChip
  sourceId?: string | null
  query?: string
  colors?: ReadonlySet<FeedColor>
  tag?: string | null
  mark?: FeedMark
}

export function itemSearchText(i: FeedViewItem): string {
  return `${i.title} ${i.summary ?? ''} ${i.author ?? ''} ${i.sourceTitle ?? ''} ${i.url ?? ''} ${i.tags.map((x) => `#${x}`).join(' ')}`.toLowerCase()
}

export function filterView(items: readonly FeedViewItem[], f: FeedViewFilter, now: number, sources: readonly FeedSource[] = []): FeedViewItem[] {
  const byId = new Map(sources.map((s) => [s.id, s]))
  const words = (f.query ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean)
  const tag = f.tag?.toLowerCase()
  return items.filter((i) =>
    i.tab === f.tab
    && (!f.sourceId || i.sourceId === f.sourceId)
    && matchesChip(i, f.chip, now, byId)
    && (!f.colors?.size || (!!i.color && f.colors.has(i.color)))
    && (!tag || i.tags.some((x) => x.toLowerCase() === tag))
    && (f.mark !== 'unread' || !i.read)
    && (f.mark !== 'starred' || i.starred)
    && (!words.length || (() => { const hay = itemSearchText(i); return words.every((w) => hay.includes(w)) })()),
  )
}

export interface OrderedDayGroup<T extends FeedItem = FeedItem> {
  key: string
  label: 'today' | 'yesterday' | 'earlier'
  day: number
  order: FeedOrder
  items: T[]
}

/** Days follow the global order; items inside a day follow the per-day override or the global order. */
export function groupOrdered<T extends FeedItem>(items: readonly T[], now: number, order: FeedOrder, perDay: Readonly<Record<string, FeedOrder>> = {}): OrderedDayGroup<T>[] {
  const today = startOfDay(now)
  const groups = new Map<number, T[]>()
  for (const it of items) {
    const d = startOfDay(it.at)
    const list = groups.get(d)
    if (list) list.push(it)
    else groups.set(d, [it])
  }
  const dir = (o: FeedOrder) => (o === 'newest' ? -1 : 1)
  return [...groups.entries()]
    .sort((a, b) => dir(order) * (a[0] - b[0]))
    .map(([day, list]) => {
      const key = String(day)
      const o = perDay[key] ?? order
      return {
        key,
        day,
        order: o,
        label: day >= today ? ('today' as const) : day >= today - DAY ? ('yesterday' as const) : ('earlier' as const),
        items: [...list].sort((a, b) => dir(o) * (a.at - b.at) || a.id.localeCompare(b.id)),
      }
    })
}

/** Items per day for the last `days` days (oldest first) — source sparkline. */
export function itemsPerDay(items: readonly FeedItem[], sourceId: string, now: number, days = 14): number[] {
  const today = startOfDay(now)
  const out = new Array<number>(days).fill(0)
  for (const i of items) {
    if (i.sourceId !== sourceId) continue
    const idx = days - 1 - Math.round((today - startOfDay(i.at)) / DAY)
    if (idx >= 0 && idx < days) out[idx]!++
  }
  return out
}

export const DEFAULT_TAG_SUGGESTIONS = ['важное', 'прочитать', 'идея', 'работа', 'релиз'] as const

/** Tags by frequency across items and sources, then defaults; excludes `exclude`. */
export function suggestTags(items: readonly FeedViewItem[], sources: readonly FeedSource[], exclude: readonly string[] = [], limit = 8, defaults: readonly string[] = DEFAULT_TAG_SUGGESTIONS): string[] {
  const count = new Map<string, { name: string; n: number }>()
  const bump = (name: string, w = 1) => {
    const k = name.toLowerCase()
    const cur = count.get(k)
    if (cur) cur.n += w
    else count.set(k, { name, n: w })
  }
  for (const i of items) for (const x of i.ownTags) bump(x)
  for (const s of sources) for (const x of s.tags ?? []) bump(x, 2)
  const ex = new Set(exclude.map((x) => x.toLowerCase()))
  const used = [...count.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).map((x) => x.name)
  const out: string[] = []
  for (const name of [...used, ...defaults]) {
    const k = name.toLowerCase()
    if (ex.has(k) || out.some((x) => x.toLowerCase() === k)) continue
    out.push(name)
    if (out.length >= limit) break
  }
  return out
}

/** All tags in use (own + source defaults), sorted by frequency. */
export function tagsInUse(items: readonly FeedViewItem[]): Array<{ tag: string; count: number }> {
  const m = new Map<string, { tag: string; count: number }>()
  for (const i of items) for (const t of i.tags) {
    const k = t.toLowerCase()
    const cur = m.get(k)
    if (cur) cur.count++
    else m.set(k, { tag: t, count: 1 })
  }
  return [...m.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

export type SourceHealth = 'checking' | 'ok' | 'error' | 'paused' | 'pending' | 'needs-x'

export function sourceHealth(s: FeedSource): SourceHealth {
  if (s.checking) return 'checking'
  if (s.paused) return 'paused'
  if (s.lastStatus === 'ok') return 'ok'
  if (s.lastStatus === 'error') return 'error'
  if (s.lastStatus === 'unsupported') return 'needs-x'
  return 'pending'
}

export function sourceHost(s: Pick<FeedSource, 'url'>): string | null {
  try {
    return new URL(s.url).hostname
  } catch {
    return null
  }
}
