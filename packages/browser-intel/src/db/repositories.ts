/**
 * Typed access layer for the intelligence database.
 *
 * Every SQL statement the pipeline runs lives here; acquisition, the Hindsight
 * bridge, the unfurl worker and the insight engine only call these methods.
 * That keeps one place to reason about idempotency (re-ingesting the same
 * profile must not duplicate facts), one place to reason about WAL behaviour,
 * and one place to change when `schema.sql` changes.
 *
 * `store.db` is exposed for read-only analytics queries (histograms, top-N
 * lists) that would otherwise bloat this file into a query catalogue; writes
 * must go through the methods.
 */

import { existsSync, statSync } from 'node:fs'

import { DatabaseSync, type NativeSqliteStatement } from '@rox/shared/utils/sqlite-runtime'

import { openIntelligenceDatabase, type OpenIntelligenceDatabaseOptions } from './database.ts'
import type {
  BookmarkRecord,
  BrowserVendorId,
  IntelligenceStats,
  ProfileSlotRecord,
  ProfileState,
  ScannedBrowserProfile,
  TimelineBucket,
  TimelineRollupResult,
  UnfurlResult,
  VisitRecord,
} from '../types.ts'
import { describeUrl } from '../url.ts'

/** Attempt budget before a URL is parked as `error` instead of retried forever. */
export const DEFAULT_MAX_UNFURL_ATTEMPTS = 3

/** Stamped on every `unfurl_details` row so decoder changes stay auditable. */
export const UNFURL_VERSION = '1.0.0'

type Statement = NativeSqliteStatement

/** Values SQLite can bind; mirrors `SqliteValue` in `@rox/shared/utils/sqlite-runtime`. */
type SqliteBinding = string | number | bigint | null | Uint8Array

/**
 * Single boundary for SQLite result shapes.
 *
 * `schema.sql` is the declared source of truth for these shapes and the schema
 * tests exercise every column; the cast is confined to these two helpers so no
 * method fabricates an unchecked shape at its own call site.
 */
function readRow<T>(statement: Statement, ...bindings: SqliteBinding[]): T | undefined {
  return statement.get(...bindings) as T | undefined
}

function readRows<T>(statement: Statement, ...bindings: SqliteBinding[]): T[] {
  return statement.all(...bindings) as T[]
}

type CountRow = { total: number | bigint }
type IdRow = { id: number | bigint }
type ValueRow = { v: number | bigint | null }

export interface BrowserProfileRow {
  id: number
  profileId: string
  vendor: BrowserVendorId
  family: string
  displayName: string
  name: string
  path: string
  lastUsedAt: number | null
  state: ProfileState
  stores: Record<string, string | null>
  detectedAt: number
  lastScannedAt: number | null
  lastStagedAt: number | null
  lastIngestedAt: number | null
  visitCount: number
  bookmarkCount: number
}

export interface PendingUrlRow {
  id: number
  url: string
  host: string | null
  domain: string | null
  attempts: number
}

export interface InsertVisitsResult {
  inserted: number
  skipped: number
  /** Distinct URLs touched (inserted or refreshed) by this batch. */
  urls: number
}

export interface UpsertUrlsResult {
  seen: number
  inserted: number
}

interface ProfileRowShape {
  id: number | bigint
  profile_id: string
  vendor: string
  family: string
  display_name: string
  name: string
  path: string
  last_used_at: number | bigint | null
  state: string
  stores_json: string
  detected_at: number | bigint
  last_scanned_at: number | bigint | null
  last_staged_at: number | bigint | null
  last_ingested_at: number | bigint | null
  visit_count: number | bigint
  bookmark_count: number | bigint
}

interface BucketRowShape {
  period: string
  visits: number | bigint
  unique_urls: number | bigint
  unique_domains: number | bigint
  bookmarks: number | bigint
  searches: number | bigint
  total_duration_ms: number | bigint
  top_domain: string | null
}

interface SlotRowShape {
  slot: string
  value_json: string
  confidence: number
  evidence_json: string
  model: string | null
  version: number | bigint
  updated_at: number | bigint
}

interface PendingUrlRowShape {
  id: number | bigint
  url: string
  host: string | null
  domain: string | null
  unfurl_attempts: number | bigint
}

interface VendorCountRowShape {
  vendor: string
  total: number | bigint
}

function toNumber(value: number | bigint | null | undefined): number | null {
  if (value === null || value === undefined) return null
  return typeof value === 'bigint' ? Number(value) : value
}

function parseJsonColumn<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export type IntelligenceStoreOptions = OpenIntelligenceDatabaseOptions

export class IntelligenceStore {
  readonly db: DatabaseSync
  #closed = false

  constructor(dbPath: string, options: IntelligenceStoreOptions = {}) {
    this.db = openIntelligenceDatabase(dbPath, options)
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.db.close()
  }

  #transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = work()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        // A failed rollback must not mask the original error.
      }
      throw error
    }
  }

  /** `SELECT COUNT(*)` for one prepared statement. */
  #count(statement: Statement, ...bindings: SqliteBinding[]): number {
    return toNumber(readRow<CountRow>(statement, ...bindings)?.total) ?? 0
  }

  // -------------------------------------------------------------------------
  // Profiles
  // -------------------------------------------------------------------------

  upsertProfiles(profiles: readonly ScannedBrowserProfile[], now: number = Date.now()): number {
    if (profiles.length === 0) return 0
    return this.#transaction(() => {
      for (const profile of profiles) {
        this.db
          .prepare(
            `INSERT INTO browser_profiles
               (profile_id, vendor, family, display_name, name, path, last_used_at, state, stores_json, detected_at, last_scanned_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(profile_id) DO UPDATE SET
               vendor = excluded.vendor,
               family = excluded.family,
               display_name = excluded.display_name,
               name = excluded.name,
               path = excluded.path,
               last_used_at = COALESCE(excluded.last_used_at, browser_profiles.last_used_at),
               state = excluded.state,
               stores_json = excluded.stores_json,
               last_scanned_at = excluded.last_scanned_at`,
          )
          .run(
            profile.profileId,
            profile.vendor,
            profile.family,
            profile.displayName,
            profile.name,
            profile.path,
            profile.lastUsedAt,
            profile.state,
            JSON.stringify(profile.stores),
            now,
            now,
          )
      }
      return profiles.length
    })
  }

  listProfiles(): BrowserProfileRow[] {
    const rows = readRows<ProfileRowShape>(
      this.db.prepare('SELECT * FROM browser_profiles ORDER BY last_scanned_at DESC, id ASC'),
    )
    return rows.map((row) => ({
      id: toNumber(row.id) ?? 0,
      profileId: row.profile_id,
      vendor: row.vendor as BrowserVendorId,
      family: row.family,
      displayName: row.display_name,
      name: row.name,
      path: row.path,
      lastUsedAt: toNumber(row.last_used_at),
      state: row.state as ProfileState,
      stores: parseJsonColumn<Record<string, string | null>>(row.stores_json, {}),
      detectedAt: toNumber(row.detected_at) ?? 0,
      lastScannedAt: toNumber(row.last_scanned_at),
      lastStagedAt: toNumber(row.last_staged_at),
      lastIngestedAt: toNumber(row.last_ingested_at),
      visitCount: toNumber(row.visit_count) ?? 0,
      bookmarkCount: toNumber(row.bookmark_count) ?? 0,
    }))
  }

  /**
   * Drop profiles that no longer exist on disk.
   *
   * Only called with a *successful* scan result; an empty `activeIds` from a
   * failed scan would otherwise wipe the historical inventory.
   */
  pruneProfilesExcept(activeIds: readonly string[]): number {
    if (activeIds.length === 0) return 0
    const placeholders = activeIds.map(() => '?').join(', ')
    const result = this.db
      .prepare(`DELETE FROM browser_profiles WHERE profile_id NOT IN (${placeholders})`)
      .run(...activeIds)
    return Number(result.changes)
  }

  recordProfileStage(profileId: string, at: number = Date.now()): void {
    this.db.prepare('UPDATE browser_profiles SET last_staged_at = ? WHERE profile_id = ?').run(at, profileId)
  }

  recordProfileIngest(profileId: string, counts: { visits: number; bookmarks: number }, at: number = Date.now()): void {
    this.db
      .prepare(
        `UPDATE browser_profiles
            SET last_ingested_at = ?,
                visit_count = visit_count + ?,
                bookmark_count = bookmark_count + ?
          WHERE profile_id = ?`,
      )
      .run(at, counts.visits, counts.bookmarks, profileId)
  }

  // -------------------------------------------------------------------------
  // URLs
  // -------------------------------------------------------------------------

  /** Insert unseen URLs as `pending` and refresh `last_seen_at` for known ones. */
  upsertUrls(urls: readonly string[], now: number = Date.now()): UpsertUrlsResult {
    if (urls.length === 0) return { seen: 0, inserted: 0 }
    const select = this.db.prepare('SELECT id FROM dim_urls WHERE url = ?')
    const insert = this.db.prepare(
      `INSERT INTO dim_urls
         (url, raw_url, scheme, host, domain, path, query, fragment, unfurl_status, first_seen_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
       ON CONFLICT(url) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
    )
    return this.#transaction(() => {
      let inserted = 0
      let seen = 0
      for (const url of urls) {
        const parts = describeUrl(url)
        if (!parts) continue
        seen += 1
        const isNew = readRow<IdRow>(select, parts.normalizedUrl) === undefined
        insert.run(
          parts.normalizedUrl,
          parts.rawUrl,
          parts.scheme,
          parts.host,
          parts.domain,
          parts.path,
          parts.query,
          parts.fragment,
          now,
          now,
        )
        if (isNew) inserted += 1
      }
      return { seen, inserted }
    })
  }

  /**
   * Next batch of URLs awaiting unfurl.
   *
   * `maxAttempts` keeps a permanently failing decoder from being retried on
   * every run: rows parked as `error` leave this selection.
   */
  claimPendingUrls(limit: number, maxAttempts: number = DEFAULT_MAX_UNFURL_ATTEMPTS): PendingUrlRow[] {
    const rows = readRows<PendingUrlRowShape>(
      this.db.prepare(
        `SELECT id, url, host, domain, unfurl_attempts
           FROM dim_urls
          WHERE unfurl_status = 'pending' AND unfurl_attempts < ?
          ORDER BY id ASC
          LIMIT ?`,
      ),
      maxAttempts,
      limit,
    )
    return rows.map((row) => ({
      id: toNumber(row.id) ?? 0,
      url: row.url,
      host: row.host,
      domain: row.domain,
      attempts: toNumber(row.unfurl_attempts) ?? 0,
    }))
  }

  countPendingUrls(maxAttempts: number = DEFAULT_MAX_UNFURL_ATTEMPTS): number {
    return this.#count(
      this.db.prepare(`SELECT COUNT(*) AS total FROM dim_urls WHERE unfurl_status = 'pending' AND unfurl_attempts < ?`),
      maxAttempts,
    )
  }

  /** Persist a completed unfurl: graph + decoded AST and the status flip. */
  saveUnfurl(result: UnfurlResult, now: number = Date.now()): void {
    const detail = {
      url: result.url,
      normalizedUrl: result.normalizedUrl,
      depth: result.depth,
      truncated: result.truncated,
      nodes: result.graph.nodes.map((node) => ({
        id: node.id,
        dataType: node.dataType,
        key: node.key,
        decoder: node.decoder,
      })),
      edges: result.graph.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        decoder: edge.decoder,
      })),
    }
    const cpuMs = Math.max(0, Math.round(result.cpuMs))
    this.#transaction(() => {
      this.db
        .prepare(
          `INSERT INTO unfurl_details
             (url_id, decoded_json, graph_json, tokens_json, timestamps_json, identifiers_json,
              node_count, edge_count, token_count, depth, truncated, cpu_ms, unfurl_version, decoded_at, error)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(url_id) DO UPDATE SET
             decoded_json = excluded.decoded_json,
             graph_json = excluded.graph_json,
             tokens_json = excluded.tokens_json,
             timestamps_json = excluded.timestamps_json,
             identifiers_json = excluded.identifiers_json,
             node_count = excluded.node_count,
             edge_count = excluded.edge_count,
             token_count = excluded.token_count,
             depth = excluded.depth,
             truncated = excluded.truncated,
             cpu_ms = excluded.cpu_ms,
             unfurl_version = excluded.unfurl_version,
             decoded_at = excluded.decoded_at,
             error = excluded.error`,
        )
        .run(
          result.urlId,
          JSON.stringify(detail),
          JSON.stringify(result.graph),
          JSON.stringify(result.tokens),
          JSON.stringify(result.timestamps),
          JSON.stringify(result.identifiers),
          result.graph.nodes.length,
          result.graph.edges.length,
          result.tokens.length,
          result.depth,
          result.truncated ? 1 : 0,
          cpuMs,
          UNFURL_VERSION,
          now,
          result.error,
        )
      this.db
        .prepare(
          `UPDATE dim_urls
              SET unfurl_status = ?, unfurl_attempts = unfurl_attempts + 1,
                  unfurl_error = ?, unfurl_cpu_ms = ?
            WHERE id = ?`,
        )
        .run(result.error ? 'error' : 'done', result.error, cpuMs, result.urlId)
    })
  }

  /** Record a decoder failure; the URL stays pending until the attempt budget is spent. */
  failUnfurl(urlId: number, message: string, maxAttempts: number = DEFAULT_MAX_UNFURL_ATTEMPTS): void {
    const row = readRow<{ unfurl_attempts: number | bigint }>(
      this.db.prepare('SELECT unfurl_attempts FROM dim_urls WHERE id = ?'),
      urlId,
    )
    const attempts = (toNumber(row?.unfurl_attempts) ?? 0) + 1
    const status = attempts >= maxAttempts ? 'error' : 'pending'
    this.db
      .prepare('UPDATE dim_urls SET unfurl_status = ?, unfurl_attempts = ?, unfurl_error = ? WHERE id = ?')
      .run(status, attempts, message.slice(0, 2000), urlId)
  }

  // -------------------------------------------------------------------------
  // Visits
  // -------------------------------------------------------------------------

  /**
   * Insert visits, resolving (and enqueueing) their URLs.
   *
   * Idempotent: the `(profile_id, url_id, visit_time, transition_type)` unique
   * index turns a repeated ingest of the same profile into a no-op.
   */
  insertVisits(records: readonly VisitRecord[], now: number = Date.now()): InsertVisitsResult {
    if (records.length === 0) return { inserted: 0, skipped: 0, urls: 0 }
    const selectUrl = this.db.prepare('SELECT id FROM dim_urls WHERE url = ?')
    const insertUrl = this.db.prepare(
      `INSERT INTO dim_urls
         (url, raw_url, scheme, host, domain, path, query, fragment, unfurl_status, first_seen_at, last_seen_at,
          visit_count, bookmark_count, search_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, 1, ?, ?)
       ON CONFLICT(url) DO UPDATE SET
         last_seen_at = excluded.last_seen_at,
         visit_count = dim_urls.visit_count + 1,
         bookmark_count = dim_urls.bookmark_count + excluded.bookmark_count,
         search_count = dim_urls.search_count + excluded.search_count`,
    )
    const insertVisit = this.db.prepare(
      `INSERT OR IGNORE INTO fact_visits
         (profile_id, url_id, visit_time, visit_time_utc, transition_type, visit_duration, visit_source,
          visit_count, typed_count, search_query, is_bookmark, title, source, ingested_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    return this.#transaction(() => {
      const touchedUrls = new Set<number>()
      let inserted = 0
      let skipped = 0
      for (const record of records) {
        const parts = describeUrl(record.url)
        if (!parts) {
          skipped += 1
          continue
        }
        const isBookmark = record.isBookmark ? 1 : 0
        const hasSearch = record.searchQuery ? 1 : 0
        insertUrl.run(
          parts.normalizedUrl,
          parts.rawUrl,
          parts.scheme,
          parts.host,
          parts.domain,
          parts.path,
          parts.query,
          parts.fragment,
          now,
          now,
          isBookmark,
          hasSearch,
        )
        const urlId = toNumber(readRow<IdRow>(selectUrl, parts.normalizedUrl)?.id) ?? 0
        if (urlId <= 0) {
          skipped += 1
          continue
        }
        touchedUrls.add(urlId)
        const result = insertVisit.run(
          record.profileId,
          urlId,
          record.visitTime,
          record.visitTime > 0 ? new Date(record.visitTime).toISOString() : null,
          record.transitionType,
          record.visitDuration,
          record.visitSource,
          record.visitCount,
          record.typedCount,
          record.searchQuery,
          isBookmark,
          record.title,
          'hindsight',
          now,
        )
        if (Number(result.changes) > 0) inserted += 1
        else skipped += 1
      }
      return { inserted, skipped, urls: touchedUrls.size }
    })
  }

  /**
   * Flag the matching visits as bookmarks.
   *
   * Hindsight reports bookmarks as their own timeline rows; the flag belongs on
   * the visit facts so a bookmark query never needs a second join.
   */
  markBookmarks(records: readonly BookmarkRecord[], now: number = Date.now()): number {
    if (records.length === 0) return 0
    const findUrl = this.db.prepare('SELECT id FROM dim_urls WHERE url = ?')
    const updateVisits = this.db.prepare('UPDATE fact_visits SET is_bookmark = 1 WHERE profile_id = ? AND url_id = ?')
    const updateUrl = this.db.prepare('UPDATE dim_urls SET bookmark_count = bookmark_count + 1 WHERE id = ?')
    const insertUrl = this.db.prepare(
      `INSERT INTO dim_urls
         (url, raw_url, scheme, host, domain, path, query, fragment, unfurl_status, first_seen_at, last_seen_at, bookmark_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, 1)
       ON CONFLICT(url) DO UPDATE SET bookmark_count = dim_urls.bookmark_count + 1`,
    )
    return this.#transaction(() => {
      let marked = 0
      const seen = new Set<number>()
      for (const record of records) {
        const parts = describeUrl(record.url)
        if (!parts) continue
        let row = readRow<IdRow>(findUrl, parts.normalizedUrl)
        if (!row) {
          insertUrl.run(
            parts.normalizedUrl,
            parts.rawUrl,
            parts.scheme,
            parts.host,
            parts.domain,
            parts.path,
            parts.query,
            parts.fragment,
            now,
            now,
          )
          row = readRow<IdRow>(findUrl, parts.normalizedUrl)
        }
        const urlId = toNumber(row?.id) ?? 0
        if (urlId <= 0 || seen.has(urlId)) continue
        seen.add(urlId)
        const result = updateVisits.run(record.profileId, urlId)
        if (Number(result.changes) === 0) {
          // A bookmark with no surviving visit still belongs in the dimension.
          updateUrl.run(urlId)
        }
        marked += 1
      }
      return marked
    })
  }

  // -------------------------------------------------------------------------
  // Timeline rollups
  // -------------------------------------------------------------------------

  /** Recompute daily/monthly/yearly aggregations from `fact_visits`. */
  rebuildTimeline(now: number = Date.now()): TimelineRollupResult {
    const periodExpression: Record<'daily' | 'monthly' | 'yearly', string> = {
      daily: "strftime('%Y-%m-%d', visit_time / 1000, 'unixepoch')",
      monthly: "strftime('%Y-%m', visit_time / 1000, 'unixepoch')",
      yearly: "strftime('%Y', visit_time / 1000, 'unixepoch')",
    }
    const tables: Record<'daily' | 'monthly' | 'yearly', string> = {
      daily: 'timeline_daily',
      monthly: 'timeline_monthly',
      yearly: 'timeline_yearly',
    }
    const columns: Record<'daily' | 'monthly' | 'yearly', string> = {
      daily: 'day',
      monthly: 'month',
      yearly: 'year',
    }
    const rollup: TimelineRollupResult = { daily: 0, monthly: 0, yearly: 0 }
    for (const granularity of ['daily', 'monthly', 'yearly'] as const) {
      const table = tables[granularity]
      const column = columns[granularity]
      const expression = periodExpression[granularity]
      this.#transaction(() => {
        this.db.exec(`DELETE FROM ${table}`)
        this.db.exec(
          `INSERT INTO ${table}
             (${column}, visits, unique_urls, unique_domains, bookmarks, searches, total_duration_ms, computed_at)
           SELECT ${expression} AS period,
                  COUNT(*),
                  COUNT(DISTINCT f.url_id),
                  COUNT(DISTINCT u.domain),
                  SUM(f.is_bookmark),
                  SUM(CASE WHEN f.search_query IS NOT NULL AND f.search_query <> '' THEN 1 ELSE 0 END),
                  SUM(COALESCE(f.visit_duration, 0)),
                  ${Math.round(now)}
             FROM fact_visits f
             JOIN dim_urls u ON u.id = f.url_id
            WHERE f.visit_time > 0 AND ${expression} IS NOT NULL
            GROUP BY period`,
        )
        this.db.exec(
          `UPDATE ${table} SET top_domain = (
             SELECT u.domain
               FROM fact_visits f
               JOIN dim_urls u ON u.id = f.url_id
              WHERE ${expression} = ${table}.${column} AND f.visit_time > 0 AND u.domain IS NOT NULL
              GROUP BY u.domain
              ORDER BY COUNT(*) DESC, u.domain ASC
              LIMIT 1
           )`,
        )
      })
      rollup[granularity] = this.#count(this.db.prepare(`SELECT COUNT(*) AS total FROM ${table}`))
    }
    return rollup
  }

  readTimeline(granularity: 'daily' | 'monthly' | 'yearly', limit = 400): TimelineBucket[] {
    const table =
      granularity === 'daily' ? 'timeline_daily' : granularity === 'monthly' ? 'timeline_monthly' : 'timeline_yearly'
    const column = granularity === 'daily' ? 'day' : granularity === 'monthly' ? 'month' : 'year'
    const rows = readRows<BucketRowShape>(
      this.db.prepare(
        `SELECT ${column} AS period, visits, unique_urls, unique_domains, bookmarks, searches, total_duration_ms, top_domain
           FROM ${table}
          ORDER BY ${column} DESC
          LIMIT ?`,
      ),
      limit,
    )
    return rows.map((row) => ({
      period: row.period,
      visits: toNumber(row.visits) ?? 0,
      uniqueUrls: toNumber(row.unique_urls) ?? 0,
      uniqueDomains: toNumber(row.unique_domains) ?? 0,
      bookmarks: toNumber(row.bookmarks) ?? 0,
      searches: toNumber(row.searches) ?? 0,
      totalDurationMs: toNumber(row.total_duration_ms) ?? 0,
      topDomain: row.top_domain,
    }))
  }

  // -------------------------------------------------------------------------
  // Semantic slots
  // -------------------------------------------------------------------------

  upsertSlots(slots: readonly ProfileSlotRecord[], now: number = Date.now()): number {
    if (slots.length === 0) return 0
    return this.#transaction(() => {
      for (const slot of slots) {
        this.db
          .prepare(
            `INSERT INTO user_profile_slots (slot, value_json, confidence, source, evidence_json, model, version, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(slot) DO UPDATE SET
               value_json = excluded.value_json,
               confidence = excluded.confidence,
               source = excluded.source,
               evidence_json = excluded.evidence_json,
               model = excluded.model,
               version = user_profile_slots.version + 1,
               updated_at = excluded.updated_at`,
          )
          .run(
            slot.slot,
            JSON.stringify(slot.value ?? null),
            slot.confidence,
            'synthesis',
            JSON.stringify(slot.evidence ?? []),
            slot.model,
            slot.version,
            now,
          )
      }
      return slots.length
    })
  }

  readSlots(): ProfileSlotRecord[] {
    const rows = readRows<SlotRowShape>(
      this.db.prepare('SELECT * FROM user_profile_slots ORDER BY confidence DESC, slot ASC'),
    )
    return rows.map((row) => ({
      slot: row.slot,
      value: parseJsonColumn<unknown>(row.value_json, null),
      confidence: row.confidence,
      evidence: parseJsonColumn<unknown>(row.evidence_json, []),
      model: row.model,
      version: toNumber(row.version) ?? 1,
      updatedAt: toNumber(row.updated_at) ?? 0,
    }))
  }

  hasSlots(): boolean {
    return this.#count(this.db.prepare('SELECT COUNT(*) AS total FROM user_profile_slots')) > 0
  }

  // -------------------------------------------------------------------------
  // Meta + stats
  // -------------------------------------------------------------------------

  setMeta(key: string, value: string, now: number = Date.now()): void {
    this.db
      .prepare(
        `INSERT INTO intelligence_meta (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, value, now)
  }

  getMeta(key: string): string | null {
    return readRow<{ value: string }>(this.db.prepare('SELECT value FROM intelligence_meta WHERE key = ?'), key)?.value ?? null
  }

  readStats(dbPath?: string): IntelligenceStats {
    const vendors = readRows<VendorCountRowShape>(
      this.db.prepare('SELECT vendor, COUNT(*) AS total FROM browser_profiles GROUP BY vendor ORDER BY total DESC'),
    )
    let dbBytes: number | null = null
    if (dbPath && existsSync(dbPath)) {
      try {
        dbBytes = statSync(dbPath).size
      } catch {
        dbBytes = null
      }
    }
    const maxOf = (sql: string): number | null =>
      toNumber(readRow<ValueRow>(this.db.prepare(sql))?.v ?? null)
    return {
      profiles: this.#count(this.db.prepare('SELECT COUNT(*) AS total FROM browser_profiles')),
      profilesByVendor: vendors.map((row) => ({ vendor: row.vendor, count: toNumber(row.total) ?? 0 })),
      urls: this.#count(this.db.prepare('SELECT COUNT(*) AS total FROM dim_urls')),
      urlsPending: this.#count(
        this.db.prepare("SELECT COUNT(*) AS total FROM dim_urls WHERE unfurl_status = 'pending'"),
      ),
      urlsUnfurled: this.#count(this.db.prepare("SELECT COUNT(*) AS total FROM dim_urls WHERE unfurl_status = 'done'")),
      urlsFailed: this.#count(this.db.prepare("SELECT COUNT(*) AS total FROM dim_urls WHERE unfurl_status = 'error'")),
      visits: this.#count(this.db.prepare('SELECT COUNT(*) AS total FROM fact_visits')),
      bookmarks: this.#count(this.db.prepare('SELECT COUNT(*) AS total FROM fact_visits WHERE is_bookmark = 1')),
      searches: this.#count(
        this.db.prepare("SELECT COUNT(*) AS total FROM fact_visits WHERE search_query IS NOT NULL AND search_query <> ''"),
      ),
      firstVisitAt: maxOf('SELECT MIN(visit_time) AS v FROM fact_visits'),
      lastVisitAt: maxOf('SELECT MAX(visit_time) AS v FROM fact_visits'),
      unfurlDetails: this.#count(this.db.prepare('SELECT COUNT(*) AS total FROM unfurl_details')),
      slots: this.#count(this.db.prepare('SELECT COUNT(*) AS total FROM user_profile_slots')),
      dbBytes,
      lastIngestAt: maxOf('SELECT MAX(last_ingested_at) AS v FROM browser_profiles'),
      lastUnfurlAt: maxOf('SELECT MAX(decoded_at) AS v FROM unfurl_details'),
    }
  }
}