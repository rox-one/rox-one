/**
 * Лента background service: persists «Источники ленты» and fetched items in
 * {configDir}/feed-state.json and polls due sources.
 *
 * Poll order per source: direct/derived feed URL → RSS/Atom autodiscovery on
 * the page → page-diff fallback (readable text hash + added lines). X
 * profiles and the «Подписки» home timeline go through XSubscriptionsAdapter
 * (official API, user token) — never through browser cookies.
 */
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'path'
import {
  FEED_DEFAULT_INTERVAL_MIN,
  FEED_MIN_INTERVAL_MIN,
  addedLines,
  isFeedColor,
  normalizeFeedTags,
  detectFeedSource,
  discoverFeedLinks,
  pageText,
  pageTitle,
  parseFeed,
  textHash,
  type FeedAddSourceOptions,
  type FeedAnnotationPatch,
  type FeedItem,
  type FeedItemAnnotation,
  type FeedPreviewResult,
  type FeedSource,
  type FeedSourcePatch,
  type ParsedFeed,
  type XConnectionStatus,
} from '@rox/shared/feed'
import { fetchText, type FetchLike } from './fetcher'
import { notConnectedXAdapter, type XPost, type XSubscriptionsAdapter } from './x-adapter'

export const FEED_STATE_FILE = 'feed-state.json'
export const FEED_MAX_SOURCES = 200
export const FEED_ITEMS_PER_SOURCE = 100
export const FEED_MAX_NEWS_ITEMS = 1500
export const FEED_MAX_SUBSCRIPTION_ITEMS = 400
export const FEED_X_INTERVAL_MIN = 15
export const FEED_MAX_ANNOTATIONS = 5000
export const FEED_STATE_VERSION = 2
const PREVIEW_ITEMS = 5
const PAGE_TEXT_CAP = 20_000

interface StoredSource extends FeedSource {
  etag?: string
  lastModified?: string
  pageHash?: string
  pageText?: string
}

/**
 * v1 → v2: adds `annotations` (tags/color/star/read per item id) and optional
 * source fields (color, tags, paused, lastOkAt). v1 files load unchanged; a
 * v1 reader keeps sources/items intact and only drops `annotations`.
 */
interface FeedState {
  version: typeof FEED_STATE_VERSION
  sources: StoredSource[]
  items: FeedItem[]
  annotations: Record<string, FeedItemAnnotation>
  x?: { lastFetchAt?: number; sinceId?: string; lastError?: string }
}

function cleanAnnotation(a: unknown): FeedItemAnnotation | null {
  if (!a || typeof a !== 'object') return null
  const r = a as Record<string, unknown>
  const out: FeedItemAnnotation = {}
  const tags = normalizeFeedTags(r.tags)
  if (tags.length) out.tags = tags
  if (isFeedColor(r.color)) out.color = r.color
  if (r.starred === true) out.starred = true
  if (typeof r.readAt === 'number' && Number.isFinite(r.readAt)) out.readAt = r.readAt
  return Object.keys(out).length ? out : null
}

function cleanSource(s: StoredSource): StoredSource {
  const out = { ...s }
  if (out.color !== undefined && !isFeedColor(out.color)) delete out.color
  if (out.tags !== undefined) {
    const tags = normalizeFeedTags(out.tags)
    if (tags.length) out.tags = tags
    else delete out.tags
  }
  if (out.paused !== undefined && out.paused !== true) delete out.paused
  delete out.checking
  return out
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
  /** Called only after a durable state commit. */
  onChange?: () => void
  /** Ephemeral polling progress, independent of durable state commits. */
  onStatusChange?: () => void
  logger?: FeedServiceLogger
  tickMs?: number
  /** Native actor custody supplies guarded storage instead of the device-global file. */
  persistence?: { read(): unknown; write(state: unknown): void }
  /** Request-owned native operations explicitly refresh within their permission fence. */
  autoPollOnAdd?: boolean
}

export type AddSourceResult =
  | { ok: true; source: FeedSource }
  | { ok: false; error: 'invalid-url' | 'duplicate' | 'too-many' }

function publicSource(s: StoredSource, checking = false): FeedSource {
  const { etag: _e, lastModified: _l, pageHash: _h, pageText: _t, checking: _c, ...rest } = s
  return checking ? { ...rest, checking: true } : rest
}

function urlKey(url: string): string {
  return url.replace(/\/$/, '').toLowerCase()
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
  onStatusChange?: () => void

  constructor(private readonly opts: FeedServiceOptions) {
    this.file = join(opts.configDir, FEED_STATE_FILE)
    this.fetchImpl = opts.fetch ?? fetch
    this.now = opts.now ?? Date.now
    this.getX = opts.getXAdapter ?? (async () => notConnectedXAdapter)
    this.log = opts.logger
    this.onChange = opts.onChange
    this.onStatusChange = opts.onStatusChange
  }

  // ── persistence ──────────────────────────────────────────────────────────
  private load(): FeedState {
    if (this.state) return this.state
    let st: FeedState = { version: FEED_STATE_VERSION, sources: [], items: [], annotations: {} }
    try {
      if (this.opts.persistence || existsSync(this.file)) {
        const raw = (this.opts.persistence ? this.opts.persistence.read() : JSON.parse(readFileSync(this.file, 'utf-8'))) as Partial<Omit<FeedState, 'version'>> & { version?: number } | null
        if (!raw || typeof raw !== 'object') { this.state = st; return st }
        const annotations: Record<string, FeedItemAnnotation> = {}
        if (raw.annotations && typeof raw.annotations === 'object') {
          for (const [id, a] of Object.entries(raw.annotations)) {
            const clean = cleanAnnotation(a)
            if (clean) annotations[id] = clean
          }
        }
        st = {
          version: FEED_STATE_VERSION,
          sources: Array.isArray(raw.sources) ? raw.sources.filter((s) => s && typeof s.id === 'string' && typeof s.url === 'string').map(cleanSource) : [],
          items: Array.isArray(raw.items) ? raw.items.filter((i) => i && typeof i.id === 'string' && typeof i.at === 'number') : [],
          annotations,
          ...(raw.x ? { x: raw.x } : {}),
        }
      }
    } catch (e) {
      if (this.opts.persistence) throw e
      this.log?.warn(`feed: unreadable ${FEED_STATE_FILE}, starting empty (${e instanceof Error ? e.message : e})`)
    }
    this.state = st
    return st
  }

  private cloneState(): FeedState {
    return structuredClone(this.load())
  }

  private persist(next: FeedState): void {
    if (this.opts.persistence) { this.opts.persistence.write(next); this.state = next; return }
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.${process.pid}.${randomUUID()}.tmp`
    try {
      writeFileSync(tmp, JSON.stringify(next), 'utf-8')
      renameSync(tmp, this.file)
    } catch (e) {
      try { rmSync(tmp, { force: true }) } catch { /* preserve the write failure */ }
      throw e
    }
    this.state = next
  }

  private changed(next: FeedState): void {
    this.persist(next)
    try {
      this.onChange?.()
    } catch {
      // listener errors never break polling
    }
  }

  private statusChanged(): void {
    try {
      this.onStatusChange?.()
    } catch {
      // listener errors never break polling
    }
  }

  // ── queries ──────────────────────────────────────────────────────────────
  listSources(): FeedSource[] {
    return this.load().sources.map((s) => publicSource(s, this.busy.has(s.id)))
  }

  listAnnotations(): Record<string, FeedItemAnnotation> {
    return { ...this.load().annotations }
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
    const next = this.cloneState()
    if (next.x) next.x = {}
    this.changed(next)
  }

  // ── mutations ────────────────────────────────────────────────────────────
  addSource(input: string, intervalMinOrOpts?: number | FeedAddSourceOptions): AddSourceResult {
    const opts: FeedAddSourceOptions = typeof intervalMinOrOpts === 'number' ? { intervalMin: intervalMinOrOpts } : intervalMinOrOpts ?? {}
    const det = detectFeedSource(input)
    if (!det) return { ok: false, error: 'invalid-url' }
    const st = this.load()
    if (st.sources.length >= FEED_MAX_SOURCES) return { ok: false, error: 'too-many' }
    if (this.isDuplicate(det.url)) return { ok: false, error: 'duplicate' }
    const now = this.now()
    const title = typeof opts.title === 'string' ? opts.title.trim().slice(0, 200) : ''
    const tags = normalizeFeedTags(opts.tags)
    const source: StoredSource = {
      id: `src-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      url: det.url,
      kind: det.kind,
      ...(title ? { title } : det.title ? { title: det.title } : {}),
      ...(isFeedColor(opts.color) ? { color: opts.color } : {}),
      ...(tags.length ? { tags } : {}),
      ...(det.feedUrl ? { feedUrl: det.feedUrl } : {}),
      ...(det.handle ? { handle: det.handle } : {}),
      intervalMin: clampInterval(opts.intervalMin),
      addedAt: now,
      lastStatus: 'pending',
    }
    const next = this.cloneState()
    next.sources.push(source)
    this.changed(next)
    if (this.opts.autoPollOnAdd !== false) void this.pollSource(source.id).catch((e) => {
      this.log?.warn(`feed: ${source.url} failed: ${e instanceof Error ? e.message : e}`)
    })
    return { ok: true, source: publicSource(source) }
  }

  removeSource(id: string): boolean {
    const next = this.cloneState()
    const before = next.sources.length
    next.sources = next.sources.filter((s) => s.id !== id)
    if (next.sources.length === before) return false
    const gone = new Set(next.items.filter((i) => i.sourceId === id).map((i) => i.id))
    next.items = next.items.filter((i) => i.sourceId !== id)
    for (const itemId of Object.keys(next.annotations)) if (gone.has(itemId) || itemId.startsWith(`news:${id}:`)) delete next.annotations[itemId]
    this.changed(next)
    return true
  }

  isDuplicate(url: string): boolean {
    const key = urlKey(url)
    return this.load().sources.some((s) => urlKey(s.url) === key)
  }

  updateSource(id: string, patch: FeedSourcePatch): FeedSource | null {
    const next = this.cloneState()
    const s = next.sources.find((x) => x.id === id)
    if (!s) return null
    if (patch.intervalMin !== undefined) s.intervalMin = clampInterval(patch.intervalMin)
    if (typeof patch.title === 'string') s.title = patch.title.trim().slice(0, 200) || s.title
    if (patch.color === null) delete s.color
    else if (isFeedColor(patch.color)) s.color = patch.color
    if (patch.tags !== undefined) {
      const tags = normalizeFeedTags(patch.tags)
      if (tags.length) s.tags = tags
      else delete s.tags
    }
    if (patch.paused === true) s.paused = true
    else if (patch.paused === false) delete s.paused
    this.changed(next)
    return publicSource(s, this.busy.has(s.id))
  }
  /** Tags / color / star / read for one or more items (any tab). */
  annotate(ids: readonly string[], patch: FeedAnnotationPatch): number {
    const next = this.cloneState()
    const now = this.now()
    let n = 0
    for (const raw of ids.slice(0, 2000)) {
      if (typeof raw !== 'string' || !raw || raw.length > 500) continue
      const cur: FeedItemAnnotation = { ...(next.annotations[raw] ?? {}) }
      if (patch.tags !== undefined) {
        const tags = normalizeFeedTags(patch.tags)
        if (tags.length) cur.tags = tags
        else delete cur.tags
      }
      if (patch.color === null) delete cur.color
      else if (isFeedColor(patch.color)) cur.color = patch.color
      if (patch.starred === true) cur.starred = true
      else if (patch.starred === false) delete cur.starred
      if (patch.read === true) cur.readAt = cur.readAt ?? now
      else if (patch.read === false) delete cur.readAt
      if (Object.keys(cur).length) next.annotations[raw] = cur
      else delete next.annotations[raw]
      n++
    }
    this.capAnnotations(next)
    if (n) this.changed(next)
    return n
  }

  private capAnnotations(st: FeedState): void {
    const ids = Object.keys(st.annotations)
    if (ids.length <= FEED_MAX_ANNOTATIONS) return
    const weight = (a: FeedItemAnnotation) => (a.tags?.length || a.color || a.starred ? 1 : 0)
    ids.sort((a, b) => weight(st.annotations[b]!) - weight(st.annotations[a]!) || (st.annotations[b]!.readAt ?? 0) - (st.annotations[a]!.readAt ?? 0))
    for (const id of ids.slice(FEED_MAX_ANNOTATIONS)) delete st.annotations[id]
  }

  /**
   * Dry run for the add-source flow: resolves the input the same way the
   * poller does (direct/derived feed → autodiscovery → page) and returns the
   * first items. Nothing is persisted.
   */
  async preview(input: string): Promise<FeedPreviewResult> {
    const det = detectFeedSource(input)
    if (!det) return { ok: false, error: 'invalid-url' }
    const duplicate = this.isDuplicate(det.url)
    try {
      if (det.kind === 'x') {
        if (!det.handle) return { ok: false, error: 'x-no-handle', kind: 'x', url: det.url, duplicate }
        const x = await this.getX()
        if (!x.connected) return { ok: false, error: 'x-not-connected', kind: 'x', url: det.url, duplicate }
        const posts = await x.userPosts(det.handle)
        return {
          ok: true, kind: 'x', url: det.url, title: det.title, via: 'x', itemCount: posts.length, duplicate,
          items: posts.slice(0, PREVIEW_ITEMS).map((p) => ({ title: clip(p.text, 200) ?? '', url: `https://x.com/${det.handle}/status/${p.id}`, ...(p.createdAt ? { at: p.createdAt } : {}) })),
        }
      }
      const target = det.feedUrl ?? det.url
      const res = await fetchText(target, {}, this.fetchImpl)
      if (res.status >= 400) return { ok: false, error: `http-${res.status}`, kind: det.kind, url: det.url, duplicate }
      let feed = parseFeed(res.text)
      let feedUrl = det.feedUrl
      let via: 'feed' | 'autodiscovery' | 'page' = 'feed'
      if (feed && !feedUrl) feedUrl = target
      if (!feed && !det.feedUrl) {
        for (const link of discoverFeedLinks(res.text, res.finalUrl).slice(0, 3)) {
          try {
            const r2 = await fetchText(link, {}, this.fetchImpl)
            const f2 = r2.status < 400 ? parseFeed(r2.text) : null
            if (f2) { feed = f2; feedUrl = link; via = 'autodiscovery'; break }
          } catch {
            // next candidate
          }
        }
      }
      if (feed) {
        const kind = det.kind === 'unknown' || det.kind === 'rss' || det.kind === 'atom' ? feed.format : det.kind
        const now = this.now()
        return {
          ok: true, kind, url: det.url, title: det.title ?? feed.title, feedUrl, via, itemCount: feed.items.length, duplicate,
          items: feed.items.slice(0, PREVIEW_ITEMS).map((it) => ({
            title: clip(it.title, 200) ?? it.url ?? '',
            ...(it.url ? { url: it.url } : {}),
            ...(it.at && it.at <= now + 86_400_000 ? { at: it.at } : {}),
            ...(it.summary ? { summary: clip(it.summary, 240) } : {}),
          })),
        }
      }
      if (det.feedUrl) return { ok: false, error: 'not-a-feed', kind: det.kind, url: det.url, duplicate }
      const looksHtml = /html/i.test(res.contentType) || /<html[\s>]/i.test(res.text.slice(0, 4096))
      if (!looksHtml) return { ok: false, error: 'unrecognized-content', kind: det.kind, url: det.url, duplicate }
      const lines = pageText(res.text).split('\n').map((l) => l.trim()).filter((l) => l.length > 24).slice(0, 3)
      return {
        ok: true, kind: det.kind === 'youtube' ? 'youtube' : 'page', url: det.url, title: pageTitle(res.text), via: 'page', itemCount: 0, duplicate,
        items: lines.map((l) => ({ title: clip(l, 200) ?? l })),
      }
    } catch (e) {
      const msg = e instanceof Error ? (e.name === 'AbortError' ? 'timeout' : e.message) : String(e)
      return { ok: false, error: msg.slice(0, 300), kind: det.kind, url: det.url, duplicate }
    }
  }

  async refresh(id?: string): Promise<void> {
    if (id) {
      if (id === 'x') await this.pollX()
      else await this.pollSource(id)
      return
    }
    for (const s of [...this.load().sources]) if (!s.paused) await this.pollSource(s.id)
    await this.pollX()
  }

  // ── scheduling ───────────────────────────────────────────────────────────
  start(): void {
    if (this.timer) return
    const tick = () => {
      void this.tick().catch((e) => {
        this.log?.warn(`feed: background tick failed: ${e instanceof Error ? e.message : e}`)
      })
    }
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
      for (const s of [...this.load().sources]) if (!s.paused && this.isDue(s, now)) await this.pollSource(s.id)
      const last = this.load().x?.lastFetchAt ?? 0
      if (now - last >= FEED_X_INTERVAL_MIN * 60_000) await this.pollX()
    } finally {
      this.ticking = false
    }
  }

  // ── polling ──────────────────────────────────────────────────────────────
  private ingest(st: FeedState, source: StoredSource, items: FeedItem[]): number {
    const have = new Set(st.items.map((item) => item.id))
    const fresh: FeedItem[] = []
    for (const item of items) {
      if (have.has(item.id)) continue
      have.add(item.id)
      fresh.push(item)
    }
    if (fresh.length) {
      st.items.push(...fresh)
      const mine = st.items.filter((i) => i.sourceId === source.id).sort((a, b) => b.at - a.at)
      const drop = new Set(mine.slice(FEED_ITEMS_PER_SOURCE).map((i) => i.id))
      st.items = st.items.filter((i) => !drop.has(i.id))
      this.capItems(st)
    }
    source.itemCount = st.items.filter((i) => i.sourceId === source.id).length
    return fresh.length
  }

  private capItems(st: FeedState): void {
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
    const base = this.cloneState()
    const staged = structuredClone(base)
    const source = staged.sources.find((s) => s.id === id)
    if (!source) return
    this.busy.add(id)
    this.statusChanged()
    try {
      await this.pollSourceInner(source, staged)
      source.lastStatus = 'ok'
      source.lastOkAt = this.now()
      delete source.lastError
    } catch (e) {
      const msg = e instanceof Error ? (e.name === 'AbortError' ? 'timeout' : e.message) : String(e)
      if (msg === 'x-not-connected') source.lastStatus = 'unsupported'
      else {
        source.lastStatus = 'error'
        this.log?.warn(`feed: ${source.url} failed: ${msg}`)
      }
      source.lastError = msg.slice(0, 300)
    }

    source.lastFetchAt = this.now()
    this.busy.delete(id)
    this.statusChanged()
    const current = this.cloneState()
    const currentSource = current.sources.find((s) => s.id === id)
    if (!currentSource) return
    const stagedSource = staged.sources.find((s) => s.id === id)!
    currentSource.kind = stagedSource.kind
    if (!currentSource.title && stagedSource.title) currentSource.title = stagedSource.title
    currentSource.feedUrl = stagedSource.feedUrl
    currentSource.etag = stagedSource.etag
    currentSource.lastModified = stagedSource.lastModified
    currentSource.pageHash = stagedSource.pageHash
    currentSource.pageText = stagedSource.pageText
    currentSource.lastStatus = stagedSource.lastStatus
    currentSource.lastOkAt = stagedSource.lastOkAt
    currentSource.lastError = stagedSource.lastError
    currentSource.lastFetchAt = stagedSource.lastFetchAt
    const existingIds = new Set(current.items.map((item) => item.id))
    const baseIds = new Set(base.items.map((item) => item.id))
    const stagedIds = new Set(staged.items.map((item) => item.id))
    current.items = current.items.filter((item) => item.sourceId !== id || !baseIds.has(item.id) || stagedIds.has(item.id))
    for (const item of staged.items) {
      if (!baseIds.has(item.id) && !existingIds.has(item.id)) {
        current.items.push(item)
        existingIds.add(item.id)
      }
    }
    this.capItems(current)
    currentSource.itemCount = current.items.filter((item) => item.sourceId === id).length
    this.changed(current)
  }

  private async pollSourceInner(source: StoredSource, st: FeedState): Promise<void> {
    if (source.kind === 'x') {
      if (!source.handle) throw new Error('x-no-handle')
      const x = await this.getX()
      if (!x.connected) throw new Error('x-not-connected')
      const posts = await x.userPosts(source.handle)
      this.ingest(st, source, posts.map((p) => xPostToItem(p, 'news', this.now(), source)))
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
      this.ingest(st, source, this.feedItems(source, feed))
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
      this.ingest(st, source, [{
        id: `news:${source.id}:page-${hash}`,
        tab: 'news',
        kind: 'page-change',
        title: source.title ?? source.url,
        ...(added.length ? { summary: added.join(' · ') } : {}),
        at: now,
        url: res.finalUrl || source.url,
        sourceId: source.id,
        sourceTitle: source.title ?? source.url,
        ref: { type: 'source' as const, id: source.id },
      }])
    }
    source.pageHash = hash
    source.pageText = text.slice(0, PAGE_TEXT_CAP)
    source.itemCount = st.items.filter((i) => i.sourceId === source.id).length
  }

  async pollX(): Promise<void> {
    const x = await this.getX()
    if (!x.connected || this.busy.has('x')) return
    this.busy.add('x')
    let posts: XPost[] = []
    let failure: string | null = null
    try {
      const sinceId = this.load().x?.sinceId
      posts = await x.homeTimeline(sinceId ? { sinceId } : {})
    } catch (e) {
      failure = (e instanceof Error ? e.message : String(e)).slice(0, 300)
      this.log?.warn(`feed: X timeline failed: ${failure}`)
    }

    const current = this.cloneState()
    const meta = (current.x ??= {})
    if (failure) meta.lastError = failure
    else {
      const have = new Set(current.items.map((item) => item.id))
      for (const post of posts) {
        const item = xPostToItem(post, 'subscriptions', this.now())
        if (have.has(item.id)) continue
        have.add(item.id)
        current.items.push(item)
      }
      this.capItems(current)
      if (posts[0]) meta.sinceId = posts[0].id
      delete meta.lastError
    }
    meta.lastFetchAt = this.now()
    this.busy.delete('x')
    this.changed(current)
  }
}
