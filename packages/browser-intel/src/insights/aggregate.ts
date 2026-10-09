/**
 * Metrics aggregation for the insight engine (requirement E, part 1).
 *
 * `aggregateMetrics` reads the visit facts and the URL dimension into the
 * single {@link InsightMetrics} shape the synthesis prompt and the deterministic
 * candidate engine both consume. Every number comes from SQL over
 * `fact_visits`/`dim_urls` or from the precomputed `timeline_*` rollups; nothing
 * is inferred or imputed.
 *
 * Window semantics: the lookback window (`windowDays`) scopes visit-derived
 * metrics — visits, distinct URLs/domains, searches, duration, histograms,
 * top-domain/top-search lists and the activity span. Bookmarks are durable user
 * intent rather than window-bound behaviour, so the bookmark totals and the
 * top-bookmarks list are counted over the whole database.
 *
 * `deriveSlotCandidates` is the floor the model may refine: a pure function of
 * the metrics that emits at most one candidate per canonical slot, each grounded
 * in observed evidence. It never fabricates a domain, query or count.
 */

import type { IntelligenceStore } from '../db/repositories.ts'
import { PROFILE_SLOT_IDS } from '../types.ts'
import type { DomainCount, InsightMetrics, SlotCandidate } from '../types.ts'

export const DEFAULT_METRICS_WINDOW_DAYS = 30
export const DEFAULT_DAILY_LIMIT = 400
/** Monthly rollups reach back two years by default; enough to see a trend. */
export const DEFAULT_MONTHLY_LIMIT = 24
const DAY_MS = 86_400_000

export interface AggregateMetricsOptions {
  /** Lookback window in days for visit-derived metrics (default 30). */
  windowDays?: number
  /** Clock override (epoch ms). */
  now?: number
  /** Row cap for the daily rollup window (default 400). */
  dailyLimit?: number
}

/** The metrics before the deterministic candidates are attached. */
export type MetricsDraft = Omit<InsightMetrics, 'candidates'>

/** Clamp a value into `[0, 1]`, tolerating NaN. */
export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

interface CountRow {
  total: number | bigint | null
}
interface ValueRow {
  value: number | bigint | null
}
interface HistRow {
  bucket: number | bigint | null
  total: number | bigint | null
}
interface DomainRow {
  domain: string
  visits: number | bigint | null
  bookmarks: number | bigint | null
}
interface SearchRow {
  query: string
  total: number | bigint | null
}
interface BookmarkRow {
  url: string
  title: string | null
  visits: number | bigint | null
}

function toNumber(value: number | bigint | null | undefined): number {
  if (value === null || value === undefined) return 0
  return typeof value === 'bigint' ? Number(value) : value
}

function count(store: IntelligenceStore, sql: string, ...bindings: Array<string | number>): number {
  const row = store.db.prepare(sql).get(...bindings) as CountRow | undefined
  return toNumber(row?.total)
}

/**
 * Aggregate the store into {@link InsightMetrics}.
 *
 * All reads are `SELECT`-only; the function is safe to run against a database a
 * concurrent reader (the stats poll, an unfurl worker) is also using.
 */
export function aggregateMetrics(store: IntelligenceStore, options: AggregateMetricsOptions = {}): InsightMetrics {
  const windowDays = options.windowDays ?? DEFAULT_METRICS_WINDOW_DAYS
  const now = options.now ?? Date.now()
  const since = windowDays > 0 ? now - windowDays * DAY_MS : 0

  const totalVisits = count(store, 'SELECT COUNT(*) AS total FROM fact_visits WHERE visit_time >= ?', since)
  const totalUrls = count(
    store,
    'SELECT COUNT(DISTINCT url_id) AS total FROM fact_visits WHERE visit_time >= ?',
    since,
  )
  const totalDomains = count(
    store,
    `SELECT COUNT(DISTINCT u.domain) AS total
       FROM fact_visits v JOIN dim_urls u ON u.id = v.url_id
      WHERE v.visit_time >= ? AND u.domain IS NOT NULL AND u.domain <> ''`,
    since,
  )
  const totalSearches = count(
    store,
    `SELECT COUNT(*) AS total FROM fact_visits
      WHERE visit_time >= ? AND search_query IS NOT NULL AND search_query <> ''`,
    since,
  )
  const totalDurationMs = toNumber(
    (store.db
      .prepare('SELECT COALESCE(SUM(visit_duration), 0) AS value FROM fact_visits WHERE visit_time >= ?')
      .get(since) as ValueRow | undefined)?.value,
  )
  const activeDays = count(
    store,
    `SELECT COUNT(DISTINCT strftime('%Y-%m-%d', visit_time / 1000, 'unixepoch')) AS total
       FROM fact_visits WHERE visit_time >= ?`,
    since,
  )
  const totalBookmarks = count(store, 'SELECT COUNT(*) AS total FROM fact_visits WHERE is_bookmark = 1')

  const firstVisitRow = store.db
    .prepare('SELECT MIN(visit_time) AS value FROM fact_visits WHERE visit_time >= ?')
    .get(since) as ValueRow | undefined
  const lastVisitRow = store.db
    .prepare('SELECT MAX(visit_time) AS value FROM fact_visits WHERE visit_time >= ?')
    .get(since) as ValueRow | undefined
  const firstRaw = firstVisitRow?.value
  const lastRaw = lastVisitRow?.value
  const firstVisitAt = firstRaw === null || firstRaw === undefined ? null : toNumber(firstRaw)
  const lastVisitAt = lastRaw === null || lastRaw === undefined ? null : toNumber(lastRaw)

  const hourlyHistogram = histogram(store, '%H', 24, since)
  const weekdayHistogram = histogram(store, '%w', 7, since)

  const topDomains = topDomainCounts(store, since)
  const topSearches = topSearchCounts(store, since)
  const topBookmarks = topBookmarkList(store)
  const daily = store.readTimeline('daily', options.dailyLimit ?? DEFAULT_DAILY_LIMIT)
  const monthly = store.readTimeline('monthly', DEFAULT_MONTHLY_LIMIT)

  const draft: MetricsDraft = {
    generatedAt: now,
    windowDays,
    totalVisits,
    totalUrls,
    totalDomains,
    totalBookmarks,
    totalSearches,
    totalDurationMs,
    activeDays,
    firstVisitAt,
    lastVisitAt,
    hourlyHistogram,
    weekdayHistogram,
    topDomains,
    topSearches,
    topBookmarks,
    daily,
    monthly,
  }
  return { ...draft, candidates: deriveSlotCandidates(draft) }
}

function histogram(store: IntelligenceStore, format: string, bins: number, since: number): number[] {
  const rows = store.db
    .prepare(
      `SELECT CAST(strftime('${format}', visit_time / 1000, 'unixepoch') AS INTEGER) AS bucket, COUNT(*) AS total
         FROM fact_visits WHERE visit_time >= ? GROUP BY bucket`,
    )
    .all(since) as unknown as HistRow[]
  const result = new Array<number>(bins).fill(0)
  for (const row of rows) {
    const bucket = toNumber(row.bucket)
    if (bucket < 0 || bucket >= bins) continue
    result[bucket] = (result[bucket] ?? 0) + toNumber(row.total)
  }
  return result
}

function topDomainCounts(store: IntelligenceStore, since: number, limit = 12): DomainCount[] {
  const rows = store.db
    .prepare(
      `SELECT u.domain AS domain,
              COUNT(*) AS visits,
              COUNT(DISTINCT CASE WHEN v.is_bookmark = 1 THEN v.url_id END) AS bookmarks
         FROM fact_visits v JOIN dim_urls u ON u.id = v.url_id
        WHERE v.visit_time >= ? AND u.domain IS NOT NULL AND u.domain <> ''
        GROUP BY u.domain
        ORDER BY visits DESC, domain ASC
        LIMIT ?`,
    )
    .all(since, limit) as unknown as DomainRow[]
  return rows.map((row) => ({
    domain: row.domain,
    visits: toNumber(row.visits),
    bookmarkCount: toNumber(row.bookmarks),
  }))
}

function topSearchCounts(store: IntelligenceStore, since: number, limit = 20): Array<{ query: string; count: number }> {
  const rows = store.db
    .prepare(
      `SELECT search_query AS query, COUNT(*) AS total
         FROM fact_visits
        WHERE visit_time >= ? AND search_query IS NOT NULL AND search_query <> ''
        GROUP BY search_query
        ORDER BY total DESC, query ASC
        LIMIT ?`,
    )
    .all(since, limit) as unknown as SearchRow[]
  return rows.map((row) => ({ query: row.query, count: toNumber(row.total) }))
}

function topBookmarkList(store: IntelligenceStore, limit = 12): Array<{ url: string; title: string | null; visits: number }> {
  const rows = store.db
    .prepare(
      `SELECT u.raw_url AS url,
              u.visit_count AS visits,
              (SELECT f.title FROM fact_visits f WHERE f.url_id = u.id ORDER BY f.visit_time DESC LIMIT 1) AS title
         FROM dim_urls u
        WHERE u.id IN (SELECT DISTINCT v.url_id FROM fact_visits v WHERE v.is_bookmark = 1)
        ORDER BY visits DESC, url ASC
        LIMIT ?`,
    )
    .all(limit) as unknown as BookmarkRow[]
  const seen = new Set<string>()
  const result: Array<{ url: string; title: string | null; visits: number }> = []
  for (const row of rows) {
    if (seen.has(row.url)) continue
    seen.add(row.url)
    result.push({ url: row.url, title: row.title, visits: toNumber(row.visits) })
  }
  return result
}

// ---------------------------------------------------------------------------
// Deterministic slot candidates
// ---------------------------------------------------------------------------

interface TechnologyFamily {
  family: string
  domains: readonly string[]
}

/** Domain evidence mapped to technology families for `tech_stack`. */
const TECH_FAMILIES: readonly TechnologyFamily[] = [
  {
    family: 'developer tooling',
    domains: [
      'github.com',
      'gitlab.com',
      'bitbucket.org',
      'stackoverflow.com',
      'stackexchange.com',
      'npmjs.com',
      'developer.mozilla.org',
      'docs.python.org',
      'pkg.go.dev',
      'crates.io',
      'hub.docker.com',
      'developer.apple.com',
    ],
  },
  {
    family: 'cloud infrastructure',
    domains: [
      'aws.amazon.com',
      'console.aws.amazon.com',
      'cloud.google.com',
      'console.cloud.google.com',
      'portal.azure.com',
      'vercel.com',
      'netlify.com',
      'cloudflare.com',
      'digitalocean.com',
      'supabase.com',
      'fly.io',
      'render.com',
    ],
  },
  {
    family: 'AI tooling',
    domains: [
      'chatgpt.com',
      'chat.openai.com',
      'claude.ai',
      'gemini.google.com',
      'perplexity.ai',
      'huggingface.co',
      'openrouter.ai',
      'cursor.com',
      'anthropic.com',
    ],
  },
  {
    family: 'design tooling',
    domains: ['figma.com', 'dribbble.com', 'behance.net', 'canva.com', 'framer.com', 'sketch.com'],
  },
  {
    family: 'office/productivity',
    domains: [
      'docs.google.com',
      'drive.google.com',
      'notion.so',
      'slack.com',
      'atlassian.net',
      'linear.app',
      'office.com',
      'airtable.com',
      'asana.com',
      'trello.com',
    ],
  },
]

/** Domains that signal entertainment/social browsing for `humor_slots`. */
const ENTERTAINMENT_DOMAINS: readonly string[] = [
  'youtube.com',
  'youtu.be',
  'reddit.com',
  'twitter.com',
  'x.com',
  'instagram.com',
  'facebook.com',
  'tiktok.com',
  'twitch.tv',
  'netflix.com',
  '9gag.com',
  'vk.com',
  'pikabu.ru',
  'tumblr.com',
  'spotify.com',
]

/** Substrings that mark a search as a problem/pain signal (EN + RU). */
const PAIN_MARKERS: readonly string[] = [
  'error',
  'issue',
  'how to',
  'how do i',
  'fix',
  'broken',
  'fails',
  'crash',
  'не работает',
  'ошибка',
  'проблема',
]

/** Minimum visits before a domain counts as "high revisit" for pain points. */
const HIGH_REVISIT_THRESHOLD = 3

function domainMatchesEntry(domain: string, entry: string): boolean {
  const d = domain.toLowerCase()
  const e = entry.toLowerCase()
  return d === e || d.endsWith(`.${e}`)
}

function classifyFamily(domain: string): string | null {
  for (const { family, domains } of TECH_FAMILIES) {
    if (domains.some((entry) => domainMatchesEntry(domain, entry))) return family
  }
  return null
}

const CYRILLIC = /[\u0400-\u04ff]/

/**
 * Derive deterministic {@link SlotCandidate}s from metrics alone.
 *
 * Returns at most one candidate per {@link PROFILE_SLOT_IDS} entry, in the
 * canonical order. A slot with no supporting evidence in the metrics is
 * omitted rather than guessed; `steer_policy` is always emitted because it is a
 * fixed conservative default parameterised by the observed activity window.
 */
export function deriveSlotCandidates(metrics: MetricsDraft): SlotCandidate[] {
  const bySlot: Partial<Record<string, SlotCandidate>> = {}
  const tech = techStackCandidate(metrics)
  if (tech) bySlot[tech.slot] = tech
  const pain = painPointsCandidate(metrics)
  if (pain) bySlot[pain.slot] = pain
  const communication = communicationCandidate(metrics)
  if (communication) bySlot[communication.slot] = communication
  const humor = humorCandidate(metrics)
  if (humor) bySlot[humor.slot] = humor
  const steer = steerPolicyCandidate(metrics)
  bySlot[steer.slot] = steer

  const ordered: SlotCandidate[] = []
  for (const slot of PROFILE_SLOT_IDS) {
    const candidate = bySlot[slot]
    if (candidate) ordered.push(candidate)
  }
  return ordered
}

function techStackCandidate(metrics: MetricsDraft): SlotCandidate | null {
  const familyVisits: Record<string, number> = {}
  const evidence: string[] = []
  let matchedVisits = 0
  for (const entry of metrics.topDomains) {
    const family = classifyFamily(entry.domain)
    if (!family) continue
    familyVisits[family] = (familyVisits[family] ?? 0) + entry.visits
    matchedVisits += entry.visits
    if (evidence.length < 5) evidence.push(`${entry.domain} (${entry.visits} visits) → ${family}`)
  }
  const families = Object.entries(familyVisits)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([family]) => family)
  if (families.length === 0) return null
  const share = metrics.totalVisits > 0 ? matchedVisits / metrics.totalVisits : 0
  const confidence = clamp01(0.4 + 0.1 * families.length + 0.2 * share)
  return {
    slot: 'tech_stack',
    value: { families },
    confidence,
    evidence: evidence.slice(0, 5),
  }
}

function painPointsCandidate(metrics: MetricsDraft): SlotCandidate | null {
  const problemQueries = metrics.topSearches.filter((entry) =>
    PAIN_MARKERS.some((marker) => entry.query.toLowerCase().includes(marker)),
  )
  const revisitDomains = metrics.topDomains.filter((entry) => entry.visits >= HIGH_REVISIT_THRESHOLD)
  if (problemQueries.length === 0 && revisitDomains.length === 0) return null
  const evidence: string[] = []
  for (const entry of problemQueries.slice(0, 3)) evidence.push(`search "${entry.query}" ×${entry.count}`)
  for (const entry of revisitDomains.slice(0, 2)) evidence.push(`revisited ${entry.domain} (${entry.visits} visits)`)
  const confidence = clamp01(0.3 + 0.15 * problemQueries.length + 0.05 * revisitDomains.length)
  return {
    slot: 'pain_points_acute',
    value: {
      queries: problemQueries.map((entry) => entry.query),
      domains: revisitDomains.map((entry) => entry.domain),
    },
    confidence,
    evidence: evidence.slice(0, 5),
  }
}

function communicationCandidate(metrics: MetricsDraft): SlotCandidate | null {
  if (metrics.topSearches.length === 0) return null
  const total = metrics.topSearches.length
  let cyrillicCount = 0
  let lengthSum = 0
  for (const entry of metrics.topSearches) {
    if (CYRILLIC.test(entry.query)) cyrillicCount += 1
    lengthSum += entry.query.length
  }
  const cyrillicShare = cyrillicCount / total
  const avgLength = lengthSum / total
  const value = cyrillicShare > 0.5 ? 'russian-dominant' : cyrillicShare > 0.1 ? 'bilingual' : 'latin-dominant'
  const evidence = [
    `search queries sampled: ${total}`,
    `cyrillic share: ${Math.round(cyrillicShare * 100)}%`,
    `average query length: ${avgLength.toFixed(1)} chars`,
  ]
  const confidence = clamp01(0.4 + 0.03 * total + 0.15 * Math.abs(cyrillicShare - 0.5))
  return { slot: 'communication_archetype', value, confidence, evidence }
}

function humorCandidate(metrics: MetricsDraft): SlotCandidate | null {
  const matches = metrics.topDomains.filter((entry) =>
    ENTERTAINMENT_DOMAINS.some((candidate) => domainMatchesEntry(entry.domain, candidate)),
  )
  if (matches.length === 0) return null
  const evidence = matches.slice(0, 5).map((entry) => `${entry.domain} (${entry.visits} visits)`)
  const confidence = clamp01(0.3 + 0.12 * matches.length)
  return {
    slot: 'humor_slots',
    value: { domains: matches.map((entry) => entry.domain) },
    confidence,
    evidence,
  }
}

function steerPolicyCandidate(metrics: MetricsDraft): SlotCandidate {
  const value = 'concise-direct: answer first with minimal preamble; confirm before long autonomous runs'
  const evidence = [
    `activity window: ${metrics.windowDays} days`,
    `active days: ${metrics.activeDays}`,
    `visits observed: ${metrics.totalVisits}`,
  ]
  const confidence = clamp01(0.35 + 0.2 * Math.min(1, metrics.activeDays / 10))
  return { slot: 'steer_policy', value, confidence, evidence }
}