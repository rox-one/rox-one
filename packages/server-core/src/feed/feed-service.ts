/**
 * Лента background service: persists «Источники ленты» and fetched items in
 * {configDir}/feed-state.json and polls due sources.
 *
 * Poll order per source: direct/derived feed URL → RSS/Atom autodiscovery on
 * the page → page-diff fallback (readable text hash + added lines). X
 * profiles and the «Подписки» home timeline go through XSubscriptionsAdapter
 * (official API, user token) — never through browser cookies.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import {
  FEED_DEFAULT_INTERVAL_MIN,
  FEED_MIN_INTERVAL_MIN,
  addedLines,
  detectFeedSource,
  discoverFeedLinks,
  pageText,
  pageTitle,
  parseFeed,
  textHash,
  type FeedItem,
  type FeedSource,
  type ParsedFeed,
  type XConnectionStatus,
} from '@craft-agent/shared/feed'
import { fetchText, type FetchLike } from './fetcher'
import { notConnectedXAdapter, type XPost, type XSubscriptionsAdapter } from './x-adapter'

export const FEED_STATE_FILE = 'feed-state.json'
export const FEED_MAX_SOURCES = 200
export const FEED_ITEMS_PER_SOURCE = 100
export const FEED_MAX_NEWS_ITEMS = 1500
export const FEED_MAX_SUBSCRIPTION_ITEMS = 400
export const FEED_X_INTERVAL_MIN = 15
const PAGE_TEXT_CAP = 20_000

interface StoredSource extends FeedSource {
  etag?: string
  lastModified?: string
  pageHash?: string
  pageText?: string
}

interface FeedState {
  version: 1
  sources: StoredSource[]
  items: FeedItem[]
  x?: { lastFetchAt?: number; sinceId?: string; lastError?: string }
}

export interface FeedServiceLogger {
  info(msg: string): void
  warn(msg: string): void
}

export interface FeedServiceOptions {
  configDir: string
  fetch?: FetchLike
  now?: () => number
  getXAdapter?: () => Promise<XSubscriptionsAdapter>
  onChange?: () => void
  logger?: FeedServiceLogger
  tickMs?: number
}

export type AddSourceResult =
  | { ok: true; source: FeedSource }
  | { ok: false; error: 'invalid-url' | 'duplicate' | 'too-many' }

function publicSource(s: StoredSource): FeedSource {
  const { etag: _e, lastModified: _l, pageHash: _h, pageText: _t, ...rest } = s
  return rest
}

function clip(s: string | undefined, n: number): string | undefined {
  const v = s?.replace(/\s+/g, ' ').trim()
  if (!v) return undefined
  return v.length > n ? `${v.slice(0, n - 1)}…` : v
}

function clampInterval(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : FEED_DEFAULT_INTERVAL_MIN
  return Math.min(7 * 24 * 60, Math.max(FEED_MIN_INTERVAL_MIN, v))
}

export function xPostToItem(p: XPost, tab: 'news' | 'subscriptions', now: number, source?: FeedSource): FeedItem {
  const handle = p.authorUsername
  return {
    id: tab === 'subscriptions' ? `x:${p.id}` : `news:${source?.id ?? 'x'}:x${p.id}`,
    tab,
    kind: 'x-post',
    title: clip(p.text, 140) ?? '',
    ...(p.text.length > 140 ? { summary: clip(p.text, 600) } : {}),
    at: p.createdAt ?? now,
    url: handle ? `https://x.com/${handle}/status/${p.id}` : `https://x.com/i/web/status/${p.id}`,
    ...(handle || p.authorName ? { author: p.authorName ? `${p.authorName}${handle ? ` @${handle}` : ''}` : `@${handle}` } : {}),
    ...(source ? { sourceId: source.id, sourceTitle: source.title ?? source.url, ref: { type: 'source' as const, id: source.id } } : {}),
  }
}

export class FeedService {
  private readonly file: string
  private readonly fetchImpl: FetchLike
  private readonly now: () => number
  private readonly getX: () => Promise<XSubscriptionsAdapter>
  private readonly log?: FeedServiceLogger
  private state: FeedState | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private busy = new Set<string>()
  private inflight = new Map<string, Promise<void>>()
  private ticking = false
  private xStatusCache: XConnectionStatus | null = null
  onChange?: () => void

  constructor(private readonly opts: FeedServiceOptions) {
    this.file = join(opts.configDir, FEED_STATE_FILE)
    this.fetchImpl = opts.fetch ?? fetch
    this.now = opts.now ?? Date.now
    this.getX = opts.getXAdapter ?? (async () => notConnectedXAdapter)
    this.log = opts.logger
    this.onChange = opts.onChange
  }

  // ── persistence ──────────────────────────────────────────────────────────
  private load(): FeedState {
    if (this.state) return this.state
    let st: FeedState = { version: 1, sources: [], items: [] }
    try {
      if (existsSync(this.file)) {
        const raw = JSON.parse(readFileSync(this.file, 'utf-8')) as Partial<FeedState>
        st = {
          version: 1,
          sources: Array.isArray(raw.sources) ? raw.sources.filter((s) => s && typeof s.id === 'string' && typeof s.url === 'string') : [],
          items: Array.isArray(raw.items) ? raw.items.filter((i) => i && typeof i.id === 'string' && typeof i.at === 'number') : [],
          ...(raw.x ? { x: raw.x } : {}),
        }
      }
    } catch (e) {
      this.log?.warn(`feed: unreadable ${FEED_STATE_FILE}, starting empty (${e instanceof Error ? e.message : e})`)
    }
    this.state = st
    return st
  }

  private save(): void {
    const st = this.load()
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      const tmp = `${this.file}.${process.pid}.tmp`
      writeFileSync(tmp, JSON.stringify(st), 'utf-8')
      renameSync(tmp, this.file)
    } catch (e) {
      this.log?.warn(`feed: failed to persist state (${e instanceof Error ? e.message : e})`)
    }
  }

  private changed(): void {
    this.save()
    try {
      this.onChange?.()
    } catch {
      // listener errors never break polling
    }
  }

  // ── queries ──────────────────────────────────────────────────────────────
  listSources(): FeedSource[] {
    return this.load().sources.map(publicSource)
  }

  listItems(): FeedItem[] {
    return [...this.load().items].sort((a, b) => b.at - a.at)
  }

  async xStatus(force = false): Promise<XConnectionStatus> {
    if (this.xStatusCache && !force) return this.withXMeta(this.xStatusCache)
    const x = await this.getX()
    this.xStatusCache = x.connected ? await x.status() : { state: 'not-connected' }
    return this.withXMeta(this.xStatusCache)
  }

  private withXMeta(s: XConnectionStatus): XConnectionStatus {
    const meta = this.load().x
    return { ...s, ...(meta?.lastFetchAt ? { lastFetchAt: meta.lastFetchAt } : {}), ...(s.state === 'connected' && meta?.lastError ? { message: meta.lastError } : {}) }
  }

  /** Call after the X token changed. */
  resetX(): void {
    this.xStatusCache = null
    const st = this.load()
    if (st.x) st.x = {}
  }

  // ── mutations ────────────────────────────────────────────────────────────
  addSource(input: string, intervalMin?: number): AddSourceResult {
    const det = detectFeedSource(input)
    if (!det) return { ok: false, error: 'invalid-url' }
    const st = this.load()
    if (st.sources.length >= FEED_MAX_SOURCES) return { ok: false, error: 'too-many' }
    const key = det.url.replace(/\/$/, '').toLowerCase()
    if (st.sources.some((s) => s.url.replace(/\/$/, '').toLowerCase() === key)) return { ok: false, error: 'duplicate' }
    const now = this.now()
    const source: StoredSource = {
      id: `src-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      url: det.url,
      kind: det.kind,
      ...(det.title ? { title: det.title } : {}),
      ...(det.feedUrl ? { feedUrl: det.feedUrl } : {}),
      ...(det.handle ? { handle: det.handle } : {}),
      intervalMin: clampInterval(intervalMin),
      addedAt: now,
      lastStatus: 'pending',
    }
    st.sources.push(source)
    this.changed()
    void this.pollSource(source.id)
    return { ok: true, source: publicSource(source) }
  }

  removeSource(id: string): boolean {
    const st = this.load()
    const before = st.sources.length
    st.sources = st.sources.filter((s) => s.id !== id)
    if (st.sources.length === before) return false
    st.items = st.items.filter((i) => i.sourceId !== id)
    this.changed()
    return true
  }

  updateSource(id: string, patch: { intervalMin?: number; title?: string }): FeedSource | null {
    const s = this.load().sources.find((x) => x.id === id)
    if (!s) return null
    if (patch.intervalMin !== undefined) s.intervalMin = clampInterval(patch.intervalMin)
    if (typeof patch.title === 'string') s.title = patch.title.trim().slice(0, 200) || s.title
    this.changed()
    return publicSource(s)
  }

  async refresh(id?: string): Promise<void> {
    if (id) {
      if (id === 'x') await this.pollX()
      else await this.pollSource(id)
      return
    }
    for (const s of [...this.load().sources]) await this.pollSource(s.id)
    await this.pollX()
  }

  // ── scheduling ───────────────────────────────────────────────────────────
  start(): void {
    if (this.timer) return
    const tick = () => void this.tick()
    this.timer = setInterval(tick, this.opts.tickMs ?? 60_000)
    ;(this.timer as { unref?: () => void }).unref?.()
    const first = setTimeout(tick, 5_000)
    ;(first as { unref?: () => void }).unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  isDue(s: FeedSource, now = this.now()): boolean {
    if (s.lastStatus === 'pending' || !s.lastFetchAt) return true
    return now - s.lastFetchAt >= s.intervalMin * 60_000
  }

  async tick(): Promise<void> {
    if (this.ticking) return
    this.ticking = true
    try {
      const now = this.now()
      for (const s of [...this.load().sources]) if (this.isDue(s, now)) await this.pollSource(s.id)
      const last = this.load().x?.lastFetchAt ?? 0
      if (now - last >= FEED_X_INTERVAL_MIN * 60_000) await this.pollX()
    } finally {
      this.ticking = false
    }
  }

  // ── polling ──────────────────────────────────────────────────────────────
  private ingest(source: StoredSource, items: FeedItem[]): number {
    const st = this.load()
    const have = new Set(st.items.map((i) => i.id))
    const fresh = items.filter((i) => !have.has(i.id))
    if (fresh.length) {
      st.items.push(...fresh)
      const mine = st.items.filter((i) => i.sourceId === source.id).sort((a, b) => b.at - a.at)
      const drop = new Set(mine.slice(FEED_ITEMS_PER_SOURCE).map((i) => i.id))
      st.items = st.items.filter((i) => !drop.has(i.id))
      this.capItems()
    }
    source.itemCount = st.items.filter((i) => i.sourceId === source.id).length
    return fresh.length
  }

  private capItems(): void {
    const st = this.load()
    const byTab = (tab: string, cap: number) => st.items.filter((i) => i.tab === tab).sort((a, b) => b.at - a.at).slice(cap).map((i) => i.id)
    const drop = new Set([...byTab('news', FEED_MAX_NEWS_ITEMS), ...byTab('subscriptions', FEED_MAX_SUBSCRIPTION_ITEMS)])
    if (drop.size) st.items = st.items.filter((i) => !drop.has(i.id))
  }

  private feedItems(source: StoredSource, feed: ParsedFeed): FeedItem[] {
    const now = this.now()
    return feed.items.slice(0, 40).map((it) => ({
      id: `news:${source.id}:${textHash(it.id || it.url || it.title)}`,
      tab: 'news' as const,
      kind: 'news' as const,
      title: clip(it.title, 200) ?? it.url ?? '',
      ...(it.summary ? { summary: it.summary } : {}),
      at: it.at && it.at <= now + 86_400_000 ? it.at : now,
      ...(it.url ? { url: it.url } : {}),
      ...(it.author ? { author: it.author } : {}),
      sourceId: source.id,
      sourceTitle: source.title ?? feed.title ?? source.url,
      ref: { type: 'source' as const, id: source.id },
    }))
  }

  pollSource(id: string): Promise<void> {
    const running = this.inflight.get(id)
    if (running) return running
    const p = this.pollSourceOnce(id).finally(() => this.inflight.delete(id))
    this.inflight.set(id, p)
    return p
  }

  private async pollSourceOnce(id: string): Promise<void> {
    const source = this.load().sources.find((s) => s.id === id)
    if (!source) return
    this.busy.add(id)
    try {
      await this.pollSourceInner(source)
      source.lastStatus = 'ok'
      delete source.lastError
    } catch (e) {
      const msg = e instanceof Error ? (e.name === 'AbortError' ? 'timeout' : e.message) : String(e)
      if (msg === 'x-not-connected') {
        source.lastStatus = 'unsupported'
      } else {
        source.lastStatus = 'error'
        this.log?.warn(`feed: ${source.url} failed: ${msg}`)
      }
      source.lastError = msg.slice(0, 300)
    } finally {
      source.lastFetchAt = this.now()
      this.busy.delete(id)
      // Source may have been removed while polling.
      if (this.load().sources.includes(source)) this.changed()
    }
  }

  private async pollSourceInner(source: StoredSource): Promise<void> {
    if (source.kind === 'x') {
      if (!source.handle) throw new Error('x-no-handle')
      const x = await this.getX()
      if (!x.connected) throw new Error('x-not-connected')
      const posts = await x.userPosts(source.handle)
      this.ingest(source, posts.map((p) => xPostToItem(p, 'news', this.now(), source)))
      return
    }

    const target = source.feedUrl ?? source.url
    const res = await fetchText(target, { etag: source.etag, lastModified: source.lastModified }, this.fetchImpl)
    if (res.notModified) return
    if (res.status >= 400) throw new Error(`http-${res.status}`)
    let feed = parseFeed(res.text)
    let validators = { etag: res.etag, lastModified: res.lastModified }

    if (!feed && !source.feedUrl) {
      // RSS/Atom autodiscovery on the HTML page.
      for (const link of discoverFeedLinks(res.text, res.finalUrl).slice(0, 3)) {
        try {
          const r2 = await fetchText(link, {}, this.fetchImpl)
          const f2 = r2.status < 400 ? parseFeed(r2.text) : null
          if (f2) {
            feed = f2
            source.feedUrl = link
            validators = { etag: r2.etag, lastModified: r2.lastModified }
            break
          }
        } catch {
          // try next candidate
        }
      }
      if (!source.title) source.title = pageTitle(res.text)
    }

    if (feed) {
      if (source.kind === 'unknown' || source.kind === 'page' || source.kind === 'rss' || source.kind === 'atom') source.kind = feed.format
      if (!source.title && feed.title) source.title = feed.title
      source.etag = validators.etag
      source.lastModified = validators.lastModified
      delete source.pageHash
      delete source.pageText
      this.ingest(source, this.feedItems(source, feed))
      return
    }

    if (source.feedUrl && source.feedUrl === target) throw new Error('not-a-feed')
    const looksHtml = /html/i.test(res.contentType) || /<html[\s>]/i.test(res.text.slice(0, 4096))
    if (!looksHtml) throw new Error('unrecognized-content')

    // Page-diff fallback.
    if (source.kind === 'unknown' || source.kind === 'rss' || source.kind === 'atom') source.kind = 'page'
    if (!source.title) source.title = pageTitle(res.text)
    const text = pageText(res.text)
    const hash = textHash(text)
    source.etag = res.etag
    source.lastModified = res.lastModified
    if (source.pageHash && source.pageHash !== hash) {
      const added = addedLines(source.pageText ?? '', text)
      const now = this.now()
      this.ingest(source, [{
        id: `news:${source.id}:page-${hash}`,
        tab: 'news',
        kind: 'page-change',
        title: source.title ?? source.url,
        ...(added.length ? { summary: added.join(' · ') } : {}),
        at: now,
        url: res.finalUrl || source.url,
        sourceId: source.id,
        sourceTitle: source.title ?? source.url,
        ref: { type: 'source', id: source.id },
      }])
    }
    source.pageHash = hash
    source.pageText = text.slice(0, PAGE_TEXT_CAP)
    source.itemCount = this.load().items.filter((i) => i.sourceId === source.id).length
  }

  async pollX(): Promise<void> {
    const st = this.load()
    const x = await this.getX()
    if (!x.connected) return
    if (this.busy.has('x')) return
    this.busy.add('x')
    const meta = (st.x ??= {})
    try {
      const posts = await x.homeTimeline(meta.sinceId ? { sinceId: meta.sinceId } : {})
      const now = this.now()
      const items = posts.map((p) => xPostToItem(p, 'subscriptions', now))
      const have = new Set(st.items.map((i) => i.id))
      const fresh = items.filter((i) => !have.has(i.id))
      if (fresh.length) {
        st.items.push(...fresh)
        this.capItems()
      }
      if (posts[0]) meta.sinceId = posts[0].id
      delete meta.lastError
    } catch (e) {
      meta.lastError = (e instanceof Error ? e.message : String(e)).slice(0, 300)
      this.log?.warn(`feed: X timeline failed: ${meta.lastError}`)
    } finally {
      meta.lastFetchAt = this.now()
      this.busy.delete('x')
      this.changed()
    }
  }
}
