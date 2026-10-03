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

function parseSafariXml(raw: string): unknown {
  const unsupported = (): never => { throw new Error('browser-bookmarks-format-unsupported') }
  let cursor = 0
  const whitespace = () => {
    while (cursor < raw.length && ' \t\r\n\ufeff'.includes(raw[cursor]!)) cursor++
  }
  const comment = () => {
    const end = raw.indexOf('-->', cursor + 4)
    if (end === -1) unsupported()
    cursor = end + 3
  }
  const misc = (header = false) => {
    while (cursor < raw.length) {
      whitespace()
      if (raw.startsWith('<!--', cursor)) comment()
      else if (raw.startsWith('<?', cursor)) {
        const end = raw.indexOf('?>', cursor + 2)
        if (end === -1) unsupported()
        cursor = end + 2
      } else if (header && raw.startsWith('<!DOCTYPE', cursor)) {
        // Skip declarations, including quoted URLs/internal subsets, without resolving entities.
        cursor += 9
        let quote = '', brackets = 0, closed = false
        while (cursor < raw.length) {
          const character = raw[cursor++]!
          if (quote) { if (character === quote) quote = '' }
          else if (character === '"' || character === "'") quote = character
          else if (character === '[') brackets++
          else if (character === ']') { if (brackets === 0) unsupported(); brackets-- }
          else if (character === '>' && brackets === 0) { closed = true; break }
        }
        if (!closed) unsupported()
      } else break
    }
  }
  type Tag = { name: string; closing: boolean; empty: boolean }
  const tag = (): Tag => {
    misc()
    if (raw[cursor++] !== '<') unsupported()
    const closing = raw[cursor] === '/'
    if (closing) cursor++
    const start = cursor
    while (cursor < raw.length && raw.charCodeAt(cursor) >= 97 && raw.charCodeAt(cursor) <= 122) cursor++
    const name = raw.slice(start, cursor)
    if (!name) unsupported()
    whitespace()
    if (name === 'plist' && !closing) {
      let quote = ''
      while (cursor < raw.length && (quote || raw[cursor] !== '>')) {
        const character = raw[cursor++]!
        if (quote) { if (character === quote) quote = '' }
        else if (character === '"' || character === "'") quote = character
        else if (character === '<') unsupported()
      }
      const empty = raw[cursor - 1] === '/'
      if (raw[cursor++] !== '>') unsupported()
      return { name, closing, empty }
    }
    const empty = !closing && raw[cursor] === '/'
    if (empty) cursor++
    if (raw[cursor++] !== '>') unsupported()
    return { name, closing, empty }
  }
  const text = (opening: Tag): string => {
    if (opening.empty) return ''
    const chunks: string[] = []
    while (cursor < raw.length) {
      const end = raw.indexOf('<', cursor)
      if (end === -1) unsupported()
      chunks.push(xmlText(raw.slice(cursor, end)))
      cursor = end
      if (raw.startsWith('<!--', cursor)) comment()
      else if (raw.startsWith('<![CDATA[', cursor)) {
        const end = raw.indexOf(']]>', cursor + 9)
        if (end === -1) unsupported()
        chunks.push(raw.slice(cursor + 9, end))
        cursor = end + 3
      } else {
        if (!raw.startsWith('</', cursor)) unsupported()
        const closing = tag()
        if (!closing.closing || closing.name !== opening.name) unsupported()
        return chunks.join('')
      }
    }
    return unsupported()
  }
  const parse = (opening: Tag, depth: number): unknown => {
    if (opening.closing || depth > 128) unsupported()
    if (opening.name === 'dict') {
      const record: Record<string, unknown> = Object.create(null)
      if (opening.empty) return record
      while (true) {
        const key = tag()
        if (key.closing && key.name === 'dict') return record
        if (key.closing || key.name !== 'key') unsupported()
        record[text(key)] = parse(tag(), depth + 1)
      }
    }
    if (opening.name === 'array') {
      const values: unknown[] = []
      if (opening.empty) return values
      while (true) {
        const next = tag()
        if (next.closing && next.name === 'array') return values
        values.push(parse(next, depth + 1))
      }
    }
    if (!['string', 'integer', 'real', 'date', 'data', 'true', 'false'].includes(opening.name)) unsupported()
    const value = text(opening)
    return opening.name === 'string' ? value : null
  }
  // Every scan advances the same cursor; malformed scalar openers never restart a suffix search.
  misc(true)
  const wrapper = tag()
  if (wrapper.name !== 'plist' || wrapper.closing || wrapper.empty) unsupported()
  const root = parse(tag(), 0)
  const closing = tag()
  if (closing.name !== 'plist' || !closing.closing) unsupported()
  misc()
  if (cursor !== raw.length) unsupported()
  return root
}

/** The non-secret Safari bookmark plist format; no external XML resources are resolved. */
export function parseSafariBookmarks(raw: string): IndexedItem[] {
  const root: unknown = raw.trim().startsWith('{') ? JSON.parse(raw) : parseSafariXml(raw)
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
