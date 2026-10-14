/**
 * Home widgets' network bridge. Every widget fetch goes through the main
 * process (cache, per-host rate limits, offline handling); shared API keys
 * stay in main and never reach the renderer.
 */
export const HOME_FETCH_CHANNELS = Object.freeze({
  FETCH: '__home-fetch:fetch',
  SEARCH: '__home-fetch:search',
  STATUS: '__home-fetch:status',
})

export type HomeFetchFormat = 'text' | 'json'

export interface HomeFetchRequest {
  url: string
  as: HomeFetchFormat
  /** Serve from cache when younger than this (ms). Clamped to 30 s … 24 h. */
  maxAgeMs?: number
  /** Skip a fresh cache entry (still rate-limited). */
  force?: boolean
}

export type HomeFetchErrorReason =
  | 'invalid'
  | 'blocked'
  | 'offline'
  | 'rate-limited'
  | 'timeout'
  | 'too-large'
  | 'http'
  | 'network'
  | 'no-key'

export interface HomeFetchCached<T> {
  data: T
  fetchedAt: number
}

export type HomeFetchResult<T = unknown> =
  | { status: 'ok'; data: T; fetchedAt: number; fromCache: boolean; stale: boolean }
  | { status: 'error'; reason: HomeFetchErrorReason; httpStatus?: number; retryAfterMs?: number; cached?: HomeFetchCached<T> }

export interface HomeSearchRequest {
  query: string
  numResults?: number
}

export interface HomeSearchHit {
  title: string
  url: string
  snippet?: string
  publishedDate?: string
}

export interface HomeFetchStatus {
  online: boolean
  searchAvailable: boolean
}

export interface HomeFetchApi {
  fetch<T = unknown>(request: HomeFetchRequest): Promise<HomeFetchResult<T>>
  search(request: HomeSearchRequest): Promise<HomeFetchResult<HomeSearchHit[]>>
  status(): Promise<HomeFetchStatus>
}

export const HOME_FETCH_LIMITS = Object.freeze({
  minMaxAgeMs: 30_000,
  defaultMaxAgeMs: 5 * 60_000,
  maxMaxAgeMs: 24 * 60 * 60_000,
  maxUrlLength: 2048,
  maxQueryLength: 500,
  maxSearchResults: 20,
})

const FETCH_KEYS = new Set(['url', 'as', 'maxAgeMs', 'force'])

/** Strict request validation (shared by preload and main). Returns null when invalid. */
export function parseHomeFetchRequest(input: unknown): HomeFetchRequest | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const v = input as Record<string, unknown>
  if (Object.keys(v).some((k) => !FETCH_KEYS.has(k))) return null
  if (typeof v.url !== 'string' || v.url.length > HOME_FETCH_LIMITS.maxUrlLength) return null
  if (v.as !== 'text' && v.as !== 'json') return null
  if (v.maxAgeMs !== undefined && (typeof v.maxAgeMs !== 'number' || !Number.isFinite(v.maxAgeMs))) return null
  if (v.force !== undefined && typeof v.force !== 'boolean') return null
  let url: URL
  try {
    url = new URL(v.url)
  } catch {
    return null
  }
  // https only: no Home widget needs plain http, and the main-process guard rejects it anyway.
  if (url.protocol !== 'https:' || url.username || url.password) return null
  return {
    url: url.toString(),
    as: v.as,
    ...(v.maxAgeMs !== undefined ? { maxAgeMs: v.maxAgeMs } : {}),
    ...(v.force ? { force: true } : {}),
  }
}

export function parseHomeSearchRequest(input: unknown): HomeSearchRequest | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const v = input as Record<string, unknown>
  if (Object.keys(v).some((k) => k !== 'query' && k !== 'numResults')) return null
  if (typeof v.query !== 'string') return null
  const query = v.query.trim()
  if (!query || query.length > HOME_FETCH_LIMITS.maxQueryLength) return null
  if (v.numResults !== undefined && (typeof v.numResults !== 'number' || !Number.isInteger(v.numResults))) return null
  const numResults = Math.min(HOME_FETCH_LIMITS.maxSearchResults, Math.max(1, (v.numResults as number | undefined) ?? 8))
  return { query, numResults }
}
