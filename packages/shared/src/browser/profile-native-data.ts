/** Native browser history/bookmarks. All database queries run against temporary snapshots. */
import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { DatabaseSync } from '../utils/sqlite-runtime.ts'
import { parseBookmarks, type DiscoveredProfile, type IndexedItem } from './profile-import.ts'

export interface NativeBrowserData {
  history?: IndexedItem[]
  bookmarks?: IndexedItem[]
}
const ITEM_LIMIT = 50_000

function items(rows: readonly { url?: unknown; title?: unknown }[], kind: IndexedItem['kind']): IndexedItem[] {
  const seen = new Set<string>()
  const result: IndexedItem[] = []
  for (const row of rows) {
    if (typeof row.url !== 'string' || seen.has(row.url)) continue
    try { if (!['http:', 'https:'].includes(new URL(row.url).protocol)) continue } catch { continue }
    seen.add(row.url)
    result.push({ kind, url: row.url, title: typeof row.title === 'string' ? row.title : '' })
    if (result.length === ITEM_LIMIT) break
  }
  return result
}

function signature(path: string): string {
  if (!existsSync(path)) return 'absent'
  const stat = statSync(path)
  return `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`
}

/** Copy the database and WAL as one stable interval; never open or modify the live DB. */
export function withBrowserDatabaseSnapshot<T>(
  path: string,
  read: (database: DatabaseSync) => T,
  temporaryRoot = tmpdir(),
): T {
  const directory = mkdtempSync(join(temporaryRoot, 'rox-browser-data-'))
  chmodSync(directory, 0o700)
  const snapshot = join(directory, basename(path))
  try {
    const sourceFiles = [path, `${path}-wal`, `${path}-shm`]
    let stable = false
    for (let attempt = 0; attempt < 3 && !stable; attempt++) {
      const before = sourceFiles.map(signature)
      for (let index = 0; index < sourceFiles.length; index++) {
        const source = sourceFiles[index]!
        const target = index === 0 ? snapshot : `${snapshot}${index === 1 ? '-wal' : '-shm'}`
        if (before[index] === 'absent') { rmSync(target, { force: true }); continue }
        copyFileSync(source, target)
        chmodSync(target, 0o600)
      }
      stable = sourceFiles.every((source, index) => signature(source) === before[index])
    }
    if (!stable) throw new Error('browser-data-snapshot-busy')
    const database = new DatabaseSync(snapshot, { readOnly: true })
    try { return read(database) } finally { database.close() }
  } catch (error) {
    if (error instanceof Error && error.message === 'browser-data-snapshot-busy') throw error
    throw new Error('browser-data-read-failed')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

function xmlText(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity: string) => {
    if (entity.startsWith('#')) {
      const code = entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10)
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
    }
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[entity] ?? ''
  })
}

/** The non-secret Safari bookmark plist format; no external XML resources are resolved. */
export function parseSafariBookmarks(raw: string): IndexedItem[] {
  let root: unknown
  if (raw.trim().startsWith('{')) root = JSON.parse(raw)
  else {
    const content = raw.match(/<plist\b[^>]*>([\s\S]*?)<\/plist>/)?.[1]
    if (!content) throw new Error('browser-bookmarks-format-unsupported')
    const tokens = content.match(/<(?:key|string|integer|real|date|data)>[\s\S]*?<\/(?:key|string|integer|real|date|data)>|<(?:dict|array)>|<\/(?:dict|array)>|<(?:true|false)\s*\/>|<(?:string|dict|array)\s*\/>/g) ?? []
    let cursor = 0
    const parse = (depth: number): unknown => {
      if (depth > 128) throw new Error('browser-bookmarks-format-unsupported')
      const token = tokens[cursor++] ?? ''
      if (token === '<dict>') {
        const record: Record<string, unknown> = {}
        while (tokens[cursor] && tokens[cursor] !== '</dict>') {
          const key = tokens[cursor++]?.match(/^<key>([\s\S]*)<\/key>$/)?.[1]
          if (key === undefined) throw new Error('browser-bookmarks-format-unsupported')
          record[xmlText(key)] = parse(depth + 1)
        }
        if (tokens[cursor++] !== '</dict>') throw new Error('browser-bookmarks-format-unsupported')
        return record
      }
      if (token === '<array>') {
        const values: unknown[] = []
        while (tokens[cursor] && tokens[cursor] !== '</array>') values.push(parse(depth + 1))
        if (tokens[cursor++] !== '</array>') throw new Error('browser-bookmarks-format-unsupported')
        return values
      }
      if (/^<string>/.test(token)) return xmlText(token.slice(8, -9))
      return null
    }
    root = parse(0)
  }
  const rows: Record<string, unknown>[] = []
  const visit = (value: unknown, depth: number) => {
    if (!value || typeof value !== 'object' || depth > 128 || rows.length >= ITEM_LIMIT) return
    const node = value as { Children?: unknown[]; URLString?: string; URIDictionary?: { title?: string } }
    if (node.URLString) rows.push({ url: node.URLString, title: node.URIDictionary?.title })
    for (const child of node.Children ?? []) visit(child, depth + 1)
  }
  visit(root, 0)
  return items(rows, 'bookmark')
}

export function readNativeBrowserData(
  profile: Pick<DiscoveredProfile, 'family' | 'path'>,
  categories: { history: boolean; bookmarks: boolean },
  options: { temporaryRoot?: string } = {},
): NativeBrowserData {
  const result: NativeBrowserData = {}
  if (!categories.history && !categories.bookmarks) return result
  if (profile.family === 'chromium') {
    const historyPath = join(profile.path, 'History')
    if (categories.history && existsSync(historyPath)) {
      result.history = withBrowserDatabaseSnapshot(historyPath, database => items(database.prepare(
        `SELECT url, title FROM urls WHERE visit_count > 0 ORDER BY last_visit_time DESC LIMIT ${ITEM_LIMIT}`,
      ).all(), 'history'), options.temporaryRoot)
    }
    const bookmarkPath = join(profile.path, 'Bookmarks')
    if (categories.bookmarks && existsSync(bookmarkPath)) {
      const raw = readFileSync(bookmarkPath, 'utf8')
      JSON.parse(raw) // Do not report corrupt native files as an empty successful import.
      result.bookmarks = items(parseBookmarks(raw), 'bookmark')
    }
  } else if (profile.family === 'firefox') {
    const placesPath = join(profile.path, 'places.sqlite')
    if (existsSync(placesPath)) {
      const data = withBrowserDatabaseSnapshot(placesPath, database => {
        const data: NativeBrowserData = {}
        if (categories.history) data.history = items(database.prepare(
          `SELECT url, title FROM moz_places WHERE visit_count > 0 ORDER BY last_visit_date DESC LIMIT ${ITEM_LIMIT}`,
        ).all(), 'history')
        if (categories.bookmarks) data.bookmarks = items(database.prepare(
          `SELECT p.url AS url, COALESCE(b.title, p.title) AS title FROM moz_bookmarks b JOIN moz_places p ON p.id = b.fk WHERE b.type = 1 ORDER BY b.dateAdded DESC LIMIT ${ITEM_LIMIT}`,
        ).all(), 'bookmark')
        return data
      }, options.temporaryRoot)
      Object.assign(result, data)
    }
  } else if (profile.family === 'safari') {
    const historyPath = join(profile.path, 'History.db')
    if (categories.history && existsSync(historyPath)) {
      result.history = withBrowserDatabaseSnapshot(historyPath, database => items(database.prepare(
        `SELECT i.url AS url, v.title AS title FROM history_visits v JOIN history_items i ON i.id = v.history_item ORDER BY v.visit_time DESC LIMIT ${ITEM_LIMIT}`,
      ).all(), 'history'), options.temporaryRoot)
    }
    const bookmarksPath = join(profile.path, 'Bookmarks.plist')
    if (categories.bookmarks && existsSync(bookmarksPath)) {
      const raw = readFileSync(bookmarksPath)
      const jsonOrXml = raw.subarray(0, 8).toString() === 'bplist00'
        ? process.platform === 'darwin'
          ? execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '--', bookmarksPath], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
          : null
        : raw.toString('utf8')
      if (jsonOrXml === null) throw new Error('browser-bookmarks-format-unsupported')
      result.bookmarks = parseSafariBookmarks(jsonOrXml)
    }
  }
  return result
}
