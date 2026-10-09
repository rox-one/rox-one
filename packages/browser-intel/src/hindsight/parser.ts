/**
 * Hindsight SQLite output reader.
 *
 * Hindsight writes one `timeline` table holding every artifact it correlated;
 * ROX consumes only the URL visit rows (`type = 'url'`) and bookmark rows
 * (`type LIKE 'bookmark%'`) and ignores the rest. The table is selected with
 * `SELECT *` and every column is read defensively by name, so a Hindsight
 * release that adds, renames or drops a column degrades to a `null` field
 * instead of throwing — the pipeline must keep ingesting after a tool upgrade.
 *
 * Verified against a real pyhindsight 2026.06 run:
 * - `timestamp` is a space-separated naive UTC string (`2026-07-13 02:47:27.938`).
 * - `visit_duration` is the string `'None'` when absent, else a `str(timedelta)`.
 * - `transition` is a compound friendly string (`link; Navigation Chain Start; …`).
 * - `profile` is the absolute staged directory path.
 */

import { basename, extname } from 'node:path'

import { DatabaseSync } from '@rox/shared/utils/sqlite-runtime'

import { deriveSearchQuery } from '../url.ts'
import type { BookmarkRecord, VisitRecord } from '../types.ts'

export interface ParseHindsightOptions {
  /** Caller-supplied profile id; falls back to the row's `profile` column. */
  profileId?: string
}

export interface HindsightParseResult {
  visits: VisitRecord[]
  bookmarks: BookmarkRecord[]
  /** Distinct non-null `timeline.profile` values. */
  profiles: string[]
  /** Rows that mapped to neither a visit nor a bookmark (or were malformed). */
  skipped: number
}

function asString(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  return null
}

function asInt(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : null
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null
  }
  return null
}

/**
 * Convert a Python `str(timedelta)` (`[D day[s], ]H:MM:SS[.ffffff]`, hours may
 * exceed 24) into milliseconds, or `null` for the `'None'` sentinel Hindsight
 * writes when a visit recorded no duration. The sub-millisecond microsecond
 * digits are truncated (`0:03:12.345678` -> `192345`).
 */
export function parseTimedeltaMs(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : null
  if (typeof value !== 'string') return null
  let text = value.trim()
  if (text.length === 0 || text === 'None') return null

  let days = 0
  const withTime = /^(\d+)\s+days?,\s*(.+)$/.exec(text)
  if (withTime) {
    days = Number(withTime[1])
    text = withTime[2]!
  } else {
    const daysOnly = /^(\d+)\s+days?$/.exec(text)
    if (daysOnly) {
      days = Number(daysOnly[1])
      text = '0:00:00'
    }
  }

  const parts = text.split(':')
  if (parts.length !== 3) return null
  const hours = Number(parts[0])
  const minutes = Number(parts[1])
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
  const [secondsText, fraction = ''] = parts[2]!.split('.')
  const seconds = Number(secondsText)
  if (!Number.isFinite(seconds)) return null

  const micros = Number((fraction + '000000').slice(0, 6))
  return ((days * 24 + hours) * 60 + minutes) * 60_000 + seconds * 1000 + Math.floor(micros / 1000)
}

/**
 * Parse a Hindsight timestamp as UTC.
 *
 * Hindsight emits naive space-separated datetimes (`2026-07-13 02:47:27.938`).
 * `Date.parse` reads that space form as host-local time, so the value is
 * normalized to an explicit UTC instant first; an input that already carries a
 * zone designator is parsed untouched.
 */
function parseTimestamp(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  const hasZone = /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(trimmed)
  const normalized = hasZone ? trimmed : `${trimmed.replace(' ', 'T')}Z`
  const parsed = Date.parse(normalized)
  return Number.isNaN(parsed) ? null : parsed
}

/** Store the friendly transition verbatim, minus Hindsight's trailing `'; '`. */
function normalizeTransition(value: unknown): string | null {
  const raw = asString(value)
  if (raw === null) return null
  const trimmed = raw.replace(/(?:;\s*)+$/, '').trimEnd()
  return trimmed.length > 0 ? trimmed : null
}

/** Read the produced SQLite and map Hindsight's `timeline` into ROX records. */
export function parseHindsightSqlite(sqlitePath: string, options: ParseHindsightOptions = {}): HindsightParseResult {
  const requested = options.profileId?.trim()
  const fallbackProfileId = basename(sqlitePath, extname(sqlitePath))

  const db = new DatabaseSync(sqlitePath, { readOnly: true })
  try {
    let rows: Record<string, unknown>[]
    try {
      rows = db.prepare('SELECT * FROM timeline').all() as Record<string, unknown>[]
    } catch (error) {
      throw new Error(
        `Cannot read Hindsight timeline from ${sqlitePath}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    const visits: VisitRecord[] = []
    const bookmarks: BookmarkRecord[] = []
    const profiles = new Set<string>()
    let skipped = 0

    for (const row of rows) {
      const rowProfile = asString(row.profile)
      if (rowProfile) profiles.add(rowProfile)
      const profileId = requested && requested.length > 0 ? requested : (rowProfile ?? fallbackProfileId)

      const type = asString(row.type)
      if (!type) {
        skipped += 1
        continue
      }
      const kind = type.toLowerCase()

      if (kind.startsWith('bookmark')) {
        const url = asString(row.url)
        if (!url) {
          skipped += 1
          continue
        }
        bookmarks.push({ profileId, url, title: asString(row.title), addedAt: parseTimestamp(row.timestamp) })
        continue
      }

      if (kind === 'url') {
        const url = asString(row.url)
        const visitTime = parseTimestamp(row.timestamp)
        if (!url || visitTime === null) {
          skipped += 1
          continue
        }
        visits.push({
          profileId,
          url,
          title: asString(row.title),
          visitTime,
          transitionType: normalizeTransition(row.transition),
          visitDuration: parseTimedeltaMs(row.visit_duration),
          visitSource: asString(row.visit_source),
          visitCount: asInt(row.visit_count),
          typedCount: asInt(row.typed_count),
          isBookmark: false,
          // Hindsight's timeline does not surface Chrome's keyword_search_terms,
          // so the phrase is recovered from the visited URL instead.
          searchQuery: deriveSearchQuery(url),
        })
        continue
      }

      skipped += 1
    }

    return { visits, bookmarks, profiles: [...profiles], skipped }
  } finally {
    db.close()
  }
}