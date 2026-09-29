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
}

export const FEED_INTERVALS_MIN: readonly number[] = [15, 30, 60, 180, 720, 1440] as const
export const FEED_DEFAULT_INTERVAL_MIN = 60
export const FEED_MIN_INTERVAL_MIN = 5
