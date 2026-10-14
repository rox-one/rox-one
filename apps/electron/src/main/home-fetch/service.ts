/**
 * Home fetch service (main process): cache + stale-while-error, in-flight
 * dedupe, per-host token buckets and 429/503 back-off, a global concurrency
 * cap, timeouts, body-size limits and offline handling. Pure apart from the
 * injected `fetch`, clock and online probe, so it is unit-tested directly.
 */
import {
  HOME_FETCH_LIMITS,
  type HomeFetchFormat,
  type HomeFetchRequest,
  type HomeFetchResult,
  type HomeSearchHit,
  type HomeSearchRequest,
} from '../../shared/home-fetch'

export interface HomeFetchDeps {
  fetch: typeof globalThis.fetch
  now: () => number
  isOnline: () => boolean
  getExaKey: () => string | undefined
  /** Defaults below; overridable for tests. */
  timeoutMs?: number
  maxBodyBytes?: number
  maxCacheEntries?: number
  maxCacheBytes?: number
  bucketCapacity?: number
  bucketRefillMs?: number
  maxConcurrent?: number
}

interface CacheEntry {
  data: unknown
  fetchedAt: number
  bytes: number
}

interface Bucket {
  tokens: number
  updatedAt: number
  blockedUntil: number
}

const USER_AGENT = 'RoxHome/1.0 (+https://rox.one)'
const EXA_SEARCH_URL = 'https://api.exa.ai/search'
const SEARCH_MAX_AGE_MS = 10 * 60_000
const MAX_BACKOFF_MS = 10 * 60_000

export class HomeFetchService {
  private readonly cache = new Map<string, CacheEntry>()
  private cacheBytes = 0
  private readonly inflight = new Map<string, Promise<HomeFetchResult>>()
  private readonly buckets = new Map<string, Bucket>()
  private active = 0
  private readonly queue: Array<() => void> = []
  private readonly opts: Required<Omit<HomeFetchDeps, 'fetch' | 'now' | 'isOnline' | 'getExaKey'>>

  constructor(private readonly deps: HomeFetchDeps) {
    this.opts = {
      timeoutMs: deps.timeoutMs ?? 15_000,
      maxBodyBytes: deps.maxBodyBytes ?? 5 * 1024 * 1024,
      maxCacheEntries: deps.maxCacheEntries ?? 300,
      maxCacheBytes: deps.maxCacheBytes ?? 32 * 1024 * 1024,
      bucketCapacity: deps.bucketCapacity ?? 6,
      bucketRefillMs: deps.bucketRefillMs ?? 2_000,
      maxConcurrent: deps.maxConcurrent ?? 6,
    }
  }

  status() {
    return { online: this.deps.isOnline(), searchAvailable: !!this.deps.getExaKey() }
  }

  async fetch(request: HomeFetchRequest): Promise<HomeFetchResult> {
    const key = cacheKey(request.as, request.url)
    const maxAge = clamp(request.maxAgeMs ?? HOME_FETCH_LIMITS.defaultMaxAgeMs, HOME_FETCH_LIMITS.minMaxAgeMs, HOME_FETCH_LIMITS.maxMaxAgeMs)
    const hit = this.cacheGet(key)
    if (hit && !request.force && this.deps.now() - hit.fetchedAt < maxAge) {
      return { status: 'ok', data: hit.data, fetchedAt: hit.fetchedAt, fromCache: true, stale: false }
    }
    const pending = this.inflight.get(key)
    if (pending) return pending
    const run = this.load(key, request.url, request.as, () => this.request(request.url, request.as, {}))
    this.inflight.set(key, run)
    try {
      return await run
    } finally {
      this.inflight.delete(key)
    }
  }

  async search(request: HomeSearchRequest): Promise<HomeFetchResult<HomeSearchHit[]>> {
    const apiKey = this.deps.getExaKey()
    if (!apiKey) return { status: 'error', reason: 'no-key' }
    const key = `search:${request.numResults ?? 8}:${request.query.toLowerCase()}`
    const hit = this.cacheGet(key)
    if (hit && this.deps.now() - hit.fetchedAt < SEARCH_MAX_AGE_MS) {
      return { status: 'ok', data: hit.data as HomeSearchHit[], fetchedAt: hit.fetchedAt, fromCache: true, stale: false }
    }
    const pending = this.inflight.get(key)
    if (pending) return pending as Promise<HomeFetchResult<HomeSearchHit[]>>
    const run = this.load(key, EXA_SEARCH_URL, 'json', async () => {
      const res = await this.request(EXA_SEARCH_URL, 'json', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify({ query: request.query, numResults: request.numResults ?? 8, contents: { summary: false, text: { maxCharacters: 300 } } }),
      })
      if (!res.ok) return res
      return { ...res, data: normalizeExa(res.data) }
    }) as Promise<HomeFetchResult<HomeSearchHit[]>>
    this.inflight.set(key, run as Promise<HomeFetchResult>)
    try {
      return await run
    } finally {
      this.inflight.delete(key)
    }
  }

  // -------------------------------------------------------------------------

  private async load(
    key: string,
    url: string,
    _as: HomeFetchFormat,
    perform: () => Promise<RawResult>,
  ): Promise<HomeFetchResult> {
    const cached = this.cacheGet(key)
    const withCache = (r: Extract<HomeFetchResult, { status: 'error' }>): HomeFetchResult => {
      if (!cached) return r
      return { ...r, cached: { data: cached.data, fetchedAt: cached.fetchedAt } }
    }
    if (!this.deps.isOnline()) return withCache({ status: 'error', reason: 'offline' })
    const host = hostOf(url)
    const wait = this.takeToken(host)
    if (wait > 0) return withCache({ status: 'error', reason: 'rate-limited', retryAfterMs: wait })
    await this.acquire()
    let res: RawResult
    try {
      res = await perform()
    } finally {
      this.release()
    }
    if (!res.ok) {
      if (res.httpStatus === 429 || res.httpStatus === 503) {
        const backoff = clamp(res.retryAfterMs ?? 60_000, 1_000, MAX_BACKOFF_MS)
        this.bucket(host).blockedUntil = this.deps.now() + backoff
        return withCache({ status: 'error', reason: 'rate-limited', httpStatus: res.httpStatus, retryAfterMs: backoff })
      }
      return withCache({ status: 'error', reason: res.reason, ...(res.httpStatus ? { httpStatus: res.httpStatus } : {}) })
    }
    const fetchedAt = this.deps.now()
    this.cacheSet(key, { data: res.data, fetchedAt, bytes: res.bytes })
    return { status: 'ok', data: res.data, fetchedAt, fromCache: false, stale: false }
  }

  private async request(url: string, as: HomeFetchFormat, init: RequestInit): Promise<RawResult> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs)
    try {
      const response = await this.deps.fetch(url, {
        ...init,
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'user-agent': USER_AGENT,
          accept: as === 'json' ? 'application/json' : 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html, text/plain, */*;q=0.5',
          ...(init.headers as Record<string, string> | undefined),
        },
      })
      if (!response.ok) {
        return { ok: false, reason: 'http', httpStatus: response.status, retryAfterMs: parseRetryAfter(response.headers.get('retry-after'), this.deps.now()) }
      }
      const declared = Number(response.headers.get('content-length'))
      if (Number.isFinite(declared) && declared > this.opts.maxBodyBytes) return { ok: false, reason: 'too-large' }
      const body = await readLimited(response, this.opts.maxBodyBytes)
      if (body === null) return { ok: false, reason: 'too-large' }
      if (as === 'text') return { ok: true, data: body, bytes: body.length * 2 }
      try {
        return { ok: true, data: JSON.parse(body) as unknown, bytes: body.length * 2 }
      } catch {
        return { ok: false, reason: 'invalid' }
      }
    } catch (error) {
      if (controller.signal.aborted) return { ok: false, reason: 'timeout' }
      void error
      return { ok: false, reason: this.deps.isOnline() ? 'network' : 'offline' }
    } finally {
      clearTimeout(timer)
    }
  }

  private bucket(host: string): Bucket {
    let b = this.buckets.get(host)
    if (!b) {
      b = { tokens: this.opts.bucketCapacity, updatedAt: this.deps.now(), blockedUntil: 0 }
      this.buckets.set(host, b)
    }
    return b
  }

  /** Returns 0 when a token was taken, else ms until one is available. */
  private takeToken(host: string): number {
    const b = this.bucket(host)
    const now = this.deps.now()
    if (b.blockedUntil > now) return b.blockedUntil - now
    const refill = Math.floor((now - b.updatedAt) / this.opts.bucketRefillMs)
    if (refill > 0) {
      b.tokens = Math.min(this.opts.bucketCapacity, b.tokens + refill)
      b.updatedAt += refill * this.opts.bucketRefillMs
    }
    if (b.tokens >= 1) {
      if (b.tokens === this.opts.bucketCapacity) b.updatedAt = now
      b.tokens -= 1
      return 0
    }
    return Math.max(1, this.opts.bucketRefillMs - (now - b.updatedAt))
  }

  private acquire(): Promise<void> {
    if (this.active < this.opts.maxConcurrent) {
      this.active += 1
      return Promise.resolve()
    }
    return new Promise((resolve) => this.queue.push(() => { this.active += 1; resolve() }))
  }

  private release(): void {
    this.active -= 1
    this.queue.shift()?.()
  }

  private cacheGet(key: string): CacheEntry | undefined {
    const hit = this.cache.get(key)
    if (hit) {
      this.cache.delete(key)
      this.cache.set(key, hit)
    }
    return hit
  }

  private cacheSet(key: string, entry: CacheEntry): void {
    const old = this.cache.get(key)
    if (old) {
      this.cacheBytes -= old.bytes
      this.cache.delete(key)
    }
    this.cache.set(key, entry)
    this.cacheBytes += entry.bytes
    while (this.cache.size > this.opts.maxCacheEntries || this.cacheBytes > this.opts.maxCacheBytes) {
      const oldest = this.cache.keys().next().value
      if (oldest === undefined) break
      this.cacheBytes -= this.cache.get(oldest)!.bytes
      this.cache.delete(oldest)
    }
  }
}

type RawResult =
  | { ok: true; data: unknown; bytes: number }
  | { ok: false; reason: 'invalid' | 'timeout' | 'too-large' | 'http' | 'network' | 'offline'; httpStatus?: number; retryAfterMs?: number }

function cacheKey(as: HomeFetchFormat, url: string): string {
  return `${as}:${url}`
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase()
  } catch {
    return '?'
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

export function parseRetryAfter(value: string | null, now: number): number | undefined {
  if (!value) return undefined
  const secs = Number(value)
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000)
  const at = Date.parse(value)
  return Number.isFinite(at) ? Math.max(0, at - now) : undefined
}

async function readLimited(response: Response, limit: number): Promise<string | null> {
  const reader = response.body?.getReader()
  if (!reader) {
    const text = await response.text()
    return text.length > limit ? null : text
  }
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  const all = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    all.set(c, offset)
    offset += c.byteLength
  }
  return new TextDecoder().decode(all)
}

function normalizeExa(raw: unknown): HomeSearchHit[] {
  const results = raw && typeof raw === 'object' && Array.isArray((raw as { results?: unknown }).results) ? (raw as { results: unknown[] }).results : []
  const hits: HomeSearchHit[] = []
  for (const r of results) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    if (typeof o.url !== 'string' || !/^https?:\/\//.test(o.url)) continue
    hits.push({
      title: typeof o.title === 'string' && o.title.trim() ? o.title.trim().slice(0, 300) : o.url,
      url: o.url,
      ...(typeof o.text === 'string' && o.text.trim() ? { snippet: o.text.trim().slice(0, 300) } : {}),
      ...(typeof o.publishedDate === 'string' ? { publishedDate: o.publishedDate } : {}),
    })
  }
  return hits
}
