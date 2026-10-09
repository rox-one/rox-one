import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DatabaseSync } from '@rox/shared/utils/sqlite-runtime'

import { parseHindsightSqlite, parseTimedeltaMs } from '../parser.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'rox-browser-intel-hindsight-'))
  roots.push(root)
  return root
}

/** Exact `timeline` schema Hindsight emits, verbatim from its source. */
const TIMELINE_COLUMNS =
  'type, timestamp, url, title, value, interpretation, profile, source_item, visit_source, visit_id, ' +
  'from_visit, opener_visit, visit_duration, visit_count, typed_count, url_hidden, transition, interrupt_reason, ' +
  'danger_type, opened, etag, last_modified, http_headers, mime_type, referrer, tab_url, download_source, hash, guid, body_sha256'

type Row = {
  type: string
  timestamp?: string
  url?: string
  title?: string
  profile?: string
  transition?: string
  visit_source?: string
  visit_count?: number
  typed_count?: number
  visit_duration?: string
}

function createTimelineDb(path: string, rows: Row[]): void {
  const db = new DatabaseSync(path)
  db.exec(`CREATE TABLE timeline (${TIMELINE_COLUMNS})`)
  const insert = db.prepare(
    `INSERT INTO timeline (type, timestamp, url, title, profile, transition, visit_source, visit_count, typed_count, visit_duration)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  for (const row of rows) {
    insert.run(
      row.type,
      row.timestamp ?? null,
      row.url ?? null,
      row.title ?? null,
      row.profile ?? null,
      row.transition ?? null,
      row.visit_source ?? null,
      row.visit_count ?? null,
      row.typed_count ?? null,
      row.visit_duration ?? null,
    )
  }
  db.close()
}

const URL_ROWS: Row[] = [
  {
    type: 'url',
    timestamp: '2026-07-13 02:47:27.938',
    url: 'https://www.google.com/search?q=hello+world',
    title: 'hello world - Google Search',
    profile: '/staged/default',
    transition: 'link; Navigation Chain Start; Navigation Chain End; ',
    visit_source: 'BROWSED',
    visit_count: 4,
    typed_count: 2,
    visit_duration: '0:03:12.345678',
  },
  // Unparseable timestamp -> skipped.
  { type: 'url', timestamp: 'not-a-date', url: 'https://broken.test/', profile: '/staged/default' },
  // Absent duration is the literal string 'None'; typed transition has no chain.
  {
    type: 'url',
    timestamp: '2026-07-13 03:00:00',
    url: 'https://example.com/page',
    profile: '/staged/default',
    transition: 'typed; ',
    visit_duration: 'None',
  },
  // >24h duration.
  {
    type: 'url',
    timestamp: '2026-07-13 03:05:00',
    url: 'https://long.example.com/',
    profile: '/staged/default',
    visit_duration: '25:00:00.500000',
  },
  {
    type: 'bookmark',
    timestamp: '2026-07-13T04:05:06Z',
    url: 'https://example.com/',
    title: 'Example',
    profile: '/staged/default',
  },
  // Non-visit, non-bookmark artifact -> skipped.
  { type: 'cookie (created)', timestamp: '2026-07-13 05:00:00', profile: '/staged/default' },
]

describe('parseTimedeltaMs', () => {
  test('truncates microseconds to milliseconds and treats None as absent', () => {
    expect(parseTimedeltaMs('0:03:12.345678')).toBe(192345)
    expect(parseTimedeltaMs('0:33:21.724256')).toBe(2001724)
    expect(parseTimedeltaMs('5:32:44.950558')).toBe(19964950)
    expect(parseTimedeltaMs('25:00:00.500000')).toBe(90000500)
    expect(parseTimedeltaMs('1 day, 2:03:04.5')).toBe(26 * 3_600_000 + 3 * 60_000 + 4000 + 500)
    expect(parseTimedeltaMs('None')).toBeNull()
    expect(parseTimedeltaMs('')).toBeNull()
    expect(parseTimedeltaMs(null)).toBeNull()
    expect(parseTimedeltaMs(undefined)).toBeNull()
  })
})

describe('parseHindsightSqlite', () => {
  test('maps url rows, bookmark rows and counts the rest as skipped', () => {
    const root = tempRoot()
    const dbPath = join(root, 'out.sqlite')
    createTimelineDb(dbPath, URL_ROWS)

    const parsed = parseHindsightSqlite(dbPath, { profileId: 'chromium:/staged/default' })

    expect(parsed.visits).toHaveLength(3)
    expect(parsed.bookmarks).toHaveLength(1)
    expect(parsed.skipped).toBe(2)
    expect(parsed.profiles).toEqual(['/staged/default'])

    const search = parsed.visits[0]!
    expect(search.url).toBe('https://www.google.com/search?q=hello+world')
    // Space-separated naive UTC must parse as UTC, not host-local time.
    expect(search.visitTime).toBe(1783910847938)
    expect(search.visitDuration).toBe(192345)
    expect(search.transitionType).toBe('link; Navigation Chain Start; Navigation Chain End')
    expect(search.visitSource).toBe('BROWSED')
    expect(search.visitCount).toBe(4)
    expect(search.typedCount).toBe(2)
    expect(search.searchQuery).toBe('hello world')
    expect(search.isBookmark).toBe(false)
    expect(search.profileId).toBe('chromium:/staged/default')

    const typed = parsed.visits[1]!
    expect(typed.visitDuration).toBeNull()
    expect(typed.transitionType).toBe('typed')
    expect(typed.searchQuery).toBeNull()

    expect(parsed.visits[2]!.visitDuration).toBe(90000500)

    const bookmark = parsed.bookmarks[0]!
    expect(bookmark.url).toBe('https://example.com/')
    expect(bookmark.title).toBe('Example')
    expect(bookmark.addedAt).toBe(Date.parse('2026-07-13T04:05:06Z'))
    expect(bookmark.profileId).toBe('chromium:/staged/default')
  })

  test('falls back to the row profile when no caller id is supplied', () => {
    const root = tempRoot()
    const dbPath = join(root, 'out.sqlite')
    createTimelineDb(dbPath, URL_ROWS.slice(0, 1))

    const parsed = parseHindsightSqlite(dbPath)
    expect(parsed.visits[0]!.profileId).toBe('/staged/default')
  })

  test('is independent of the host timezone', () => {
    const root = tempRoot()
    const dbPath = join(root, 'out.sqlite')
    createTimelineDb(dbPath, URL_ROWS.slice(0, 1))

    const savedTz = process.env.TZ
    try {
      for (const tz of ['UTC', 'Europe/Moscow']) {
        process.env.TZ = tz
        const parsed = parseHindsightSqlite(dbPath)
        expect(parsed.visits[0]!.visitTime).toBe(1783910847938)
      }
    } finally {
      if (savedTz === undefined) delete process.env.TZ
      else process.env.TZ = savedTz
    }
  })

  test('tolerates an unknown column and a missing transition column', () => {
    const root = tempRoot()
    const dbPath = join(root, 'drift.sqlite')
    const db = new DatabaseSync(dbPath)
    db.exec('CREATE TABLE timeline (type TEXT, timestamp TEXT, url TEXT, title TEXT, profile TEXT, zeta TEXT)')
    db.prepare('INSERT INTO timeline (type, timestamp, url, title, profile, zeta) VALUES (?, ?, ?, ?, ?, ?)').run(
      'url',
      '2026-07-13 02:47:27.938',
      'https://example.com/',
      'Example',
      '/staged/default',
      'drifted',
    )
    db.close()

    const parsed = parseHindsightSqlite(dbPath, { profileId: 'chromium:/x' })
    expect(parsed.visits).toHaveLength(1)
    expect(parsed.visits[0]!.transitionType).toBeNull()
    expect(parsed.visits[0]!.visitDuration).toBeNull()
    expect(parsed.visits[0]!.visitTime).toBe(1783910847938)
  })
})