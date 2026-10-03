/**
 * Лента (feed) — shared types for the feed:list aggregator.
 *
 * Items are typed by tab: agent actions (sessions + automation runs), team
 * activity (local-first team model, assembled in the renderer), news (user
 * sources polled in the background) and subscriptions (X home timeline, only
 * when the user entered an X API token).
 */

export type FeedTab = 'agents' | 'team' | 'news' | 'subscriptions'

export const FEED_TABS: readonly FeedTab[] = ['agents', 'team', 'news', 'subscriptions'] as const

export type FeedItemKind =
  | 'session'
  | 'automation-run'
  | 'team-activity'
  | 'news'
  | 'page-change'
  | 'x-post'

export type FeedItemStatus = 'ok' | 'error' | 'running' | 'waiting'

export interface FeedItemRef {
  type: 'session' | 'automation' | 'source' | 'note' | 'task' | 'message' | 'mapNode'
  id: string
  workspaceId?: string
  parentId?: string
}

export interface FeedItem {
  /** Stable id, unique across tabs (prefixed by origin). */
  id: string
  tab: FeedTab
  kind: FeedItemKind
  title: string
  summary?: string
  /** Event time, ms epoch. */
  at: number
  status?: FeedItemStatus
  /** External link (news article, video, post, release). */
  url?: string
  /** In-app object the item points at. */
  ref?: FeedItemRef
  sourceId?: string
  sourceTitle?: string
  author?: string
  /** Error text for failed automation runs / fetches. */
  error?: string
  /** Session produced by an automation run, when there is one. */
  sessionId?: string
  /** Automation id for runs (retry target). */
  automationId?: string
}

/** Color labels for items and sources (Лента). */
export type FeedColor = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'violet' | 'gray'

export const FEED_COLORS: readonly FeedColor[] = ['red', 'orange', 'yellow', 'green', 'blue', 'violet', 'gray'] as const

export function isFeedColor(v: unknown): v is FeedColor {
  return typeof v === 'string' && (FEED_COLORS as readonly string[]).includes(v)
}

/** User annotations on a feed item, keyed by item id (any tab). */
export interface FeedItemAnnotation {
  tags?: string[]
  color?: FeedColor
  starred?: boolean
  /** Read time, ms epoch. */
  readAt?: number
}

/** Patch for feed:items:annotate. `null` clears color; tags replace the list. */
export interface FeedAnnotationPatch {
  tags?: string[]
  color?: FeedColor | null
  starred?: boolean
  read?: boolean
}

export const FEED_MAX_TAGS = 12
export const FEED_MAX_TAG_LENGTH = 32

/** Trim, collapse spaces, drop leading '#', dedupe case-insensitively, cap count and length. */
export function normalizeFeedTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of tags) {
    if (typeof raw !== 'string') continue
    const v = raw.replace(/\s+/g, ' ').trim().replace(/^#+\s*/, '').slice(0, FEED_MAX_TAG_LENGTH)
    const key = v.toLowerCase()
    if (!v || seen.has(key)) continue
    seen.add(key)
    out.push(v)
    if (out.length >= FEED_MAX_TAGS) break
  }
  return out
}

/** Detected source type. `page` = no feed found, tracked by page diff. */
export type FeedSourceKind = 'rss' | 'atom' | 'youtube' | 'github' | 'x' | 'page' | 'unknown'

export type FeedSourceStatus = 'pending' | 'ok' | 'error' | 'unsupported'

export interface FeedSource {
  id: string
  /** URL as entered (normalized to https://…). */
  url: string
  kind: FeedSourceKind
  title?: string
  /** Resolved RSS/Atom URL (direct, derived, or autodiscovered). */
  feedUrl?: string
  /** X handle for kind === 'x'. */
  handle?: string
  intervalMin: number
  addedAt: number
  lastFetchAt?: number
  lastStatus: FeedSourceStatus
  /** Error code or message for the last failed fetch. */
  lastError?: string
  itemCount?: number
  /** Last successful fetch, ms epoch. */
  lastOkAt?: number
  /** User color label; items inherit it unless they have their own. */
  color?: FeedColor
  /** Default tags applied (virtually) to every item of the source. */
  tags?: string[]
  /** Paused sources are not polled in the background. */
  paused?: boolean
  /** A fetch is in flight right now (not persisted). */
  checking?: boolean
}

/** Patch for feed:sources:update. `null` clears color. */
export interface FeedSourcePatch {
  intervalMin?: number
  title?: string
  color?: FeedColor | null
  tags?: string[]
  paused?: boolean
}

/** Options for feed:sources:add beyond the URL. */
export interface FeedAddSourceOptions {
  intervalMin?: number
  title?: string
  color?: FeedColor
  tags?: string[]
}

/** feed:sources:preview — dry-run fetch before saving a source. */
export interface FeedPreviewItem {
  title: string
  url?: string
  at?: number
  summary?: string
}

export type FeedPreviewResult =
  | {
      ok: true
      kind: FeedSourceKind
      url: string
      title?: string
      feedUrl?: string
      /** How the items were found. */
      via: 'feed' | 'autodiscovery' | 'page' | 'x'
      itemCount: number
      items: FeedPreviewItem[]
      duplicate: boolean
    }
  | {
      ok: false
      error: string
      kind?: FeedSourceKind
      url?: string
      duplicate?: boolean
    }

export type XConnectionState = 'not-connected' | 'connected' | 'error'

export interface XConnectionStatus {
  state: XConnectionState
  username?: string
  message?: string
  lastFetchAt?: number
}

export interface FeedListResult {
  items: FeedItem[]
  sources: FeedSource[]
  x: XConnectionStatus
  generatedAt: number
  /** Tags/colors/star/read per item id. Absent on older servers. */
  annotations?: Record<string, FeedItemAnnotation>
  /** Native scope capability; read-only actors never schedule a write refresh. */
  refreshAllowed?: boolean
}

export const FEED_INTERVALS_MIN: readonly number[] = [15, 30, 60, 180, 720, 1440] as const
export const FEED_DEFAULT_INTERVAL_MIN = 60
export const FEED_MIN_INTERVAL_MIN = 5
