/**
 * Rox History — durable clipboard history store.
 *
 * Electron-free by design: it only needs a directory, so it is exercised on a
 * temporary directory in tests. The sqlite driver is the runtime-neutral
 * `DatabaseSync` adapter (Bun `bun:sqlite`, Electron/Node `node:sqlite`).
 * When that runtime is missing the constructor throws a typed error which the
 * handler module reports once as "unavailable" — the process never crashes.
 */

import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from '@rox/shared/utils/sqlite-runtime'
import type {
  ClipCounts,
  ClipEntryDetail,
  ClipEntryKind,
  ClipEntrySummary,
  ClipImageFormat,
  ClipListQuery,
  ClipListResult,
  ClipSettings,
  ClipStats,
} from '@rox/shared/clipboard-history'

const SCHEMA_VERSION = 1
const DEFAULT_PAGE_SIZE = 50
const PREVIEW_LENGTH = 200
/** The search runs synchronously on the main thread; a huge query must not stall it. */
const MAX_QUERY_LENGTH = 256

export const MAX_TEXT_BYTES = 1024 * 1024
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024
export const MAX_TAG_COUNT = 8
export const MAX_TAG_LENGTH = 32
export const THUMB_MAX_WIDTH = 240
export const THUMB_MAX_HEIGHT = 160

/** Tag vocabulary that is captured but never surfaced as a filter chip (donor parity). */
export const HIDDEN_TAGS: Record<string, true> = { code: true, otp: true, token: true, log: true }

export const DEFAULT_CLIP_SETTINGS: ClipSettings = {
  captureEnabled: true,
  captureImages: true,
  retentionDays: 30,
  maxEntries: 2000,
  hideSensitive: true,
  globalShortcutEnabled: false,
  globalShortcut: 'CommandOrControl+Shift+V',
}

const ACCEPTED_RETENTION_DAYS = [1, 7, 30, 180] as const
const MIN_ENTRIES = 100
const MAX_ENTRIES = 20_000

export type { ClipImageFormat }

const IMAGE_MIME: Record<ClipImageFormat, string> = { png: 'image/png', gif: 'image/gif', jpg: 'image/jpeg' }

/** Thrown when the SQLite runtime itself cannot be loaded (fail-soft entry point). */
export class ClipboardHistoryUnavailableError extends Error {
  constructor(message = 'Clipboard history storage is unavailable', cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'ClipboardHistoryUnavailableError'
  }
}

/** Thrown when an existing database carries a schema version this build does not own. */
export class ClipboardHistorySchemaError extends Error {
  constructor(version: number) {
    super(`unsupported clipboard history schema version: ${version}`)
    this.name = 'ClipboardHistorySchemaError'
  }
}

/** Thrown when a capture payload violates an explicit bound; callers treat it as "skip". */
export class ClipEntryRejectedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ClipEntryRejectedError'
  }
}

export interface ClipEntryInput {
  kind: ClipEntryKind
  /** UTF-8 text for `kind === 'text'`. */
  text?: string
  /** Encoded image bytes for `kind === 'image'`. */
  imageBytes?: Buffer
  imageFormat?: ClipImageFormat
  imageWidth?: number
  imageHeight?: number
  /** PNG thumbnail (≤ 240×160) stored inline as a BLOB. */
  thumbnailPng?: Buffer
}

export interface InsertResult {
  id: number
  inserted: boolean
}

export interface PruneResult {
  expired: number
  trimmed: number
}

/** The subset of the store the clipboard monitor needs (keeps the monitor testable). */
export interface ClipboardEntrySink {
  insertOrResurface(entry: ClipEntryInput): InsertResult
  getSettings(): ClipSettings
}

type SqlValue = string | number | bigint | null | Uint8Array

interface EntryRow {
  id: number
  kind: string
  text_content: string | null
  image_path: string | null
  image_thumb: Uint8Array | null
  image_format: string | null
  image_width: number | null
  image_height: number | null
  image_byte_size: number | null
  char_count: number | null
  created_at: string
  is_starred: number
}

function asNumber(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'bigint') return Number(value)
  return 0
}

function contentHash(kind: ClipEntryKind, payload: Buffer): string {
  return createHash('sha256').update(Buffer.concat([Buffer.from(`${kind}\u0000`, 'utf8'), payload])).digest('hex')
}

/** Trim / lowercase / dedupe; drop empties; cap count and length. */
export function normalizeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>()
  for (const raw of tags) {
    const tag = raw.trim().toLowerCase().slice(0, MAX_TAG_LENGTH)
    if (tag) seen.add(tag)
    if (seen.size >= MAX_TAG_COUNT) break
  }
  return [...seen].sort()
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, character => `\\${character}`)
}

function textPreview(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length > PREVIEW_LENGTH ? collapsed.slice(0, PREVIEW_LENGTH) : collapsed
}

export class ClipboardHistoryStore implements ClipboardEntrySink {
  readonly dir: string
  readonly imagesDir: string
  readonly databasePath: string
  private readonly db: DatabaseSync
  private readonly now: () => Date
  private closed = false

  constructor(options: { dir: string; now?: () => Date }) {
    this.dir = options.dir
    this.imagesDir = join(options.dir, 'images')
    this.databasePath = join(options.dir, 'history.db')
    this.now = options.now ?? (() => new Date())
    try {
      // The store is secrets-adjacent: keep the directory (and the WAL/SHM files it
      // will host) private to the user. Best-effort — a filesystem that cannot carry
      // POSIX modes must not stop the store from opening. `mkdir` only applies the
      // mode to a *new* directory, so an existing (pre-upgrade) store is repaired
      // here as well.
      mkdirSync(this.dir, { recursive: true, mode: 0o700 })
      mkdirSync(this.imagesDir, { recursive: true, mode: 0o700 })
      try { chmodSync(this.dir, 0o700) } catch { /* mode not supported here */ }
      try { chmodSync(this.imagesDir, 0o700) } catch { /* mode not supported here */ }
      this.db = new DatabaseSync(this.databasePath)
      try { chmodSync(this.databasePath, 0o600) } catch { /* mode not supported here */ }
    } catch (error) {
      throw new ClipboardHistoryUnavailableError('Clipboard history storage could not be opened', error)
    }
    try {
      this.migrate()
    } catch (error) {
      try { this.db.close() } catch { /* already closed */ }
      throw error
    }
  }

  private migrate(): void {
    // secure_delete keeps deleted payload bytes out of the file's free pages — the
    // store is secrets-adjacent, so a plain DELETE must not leave them recoverable.
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA secure_delete=ON;')
    const version = asNumber((this.db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined)?.user_version ?? 0)
    if (version !== 0 && version !== SCHEMA_VERSION) throw new ClipboardHistorySchemaError(version)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS clip_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        text_content TEXT,
        text_search TEXT,
        image_path TEXT,
        image_thumb BLOB,
        image_format TEXT,
        image_width INTEGER, image_height INTEGER, image_byte_size INTEGER,
        content_hash TEXT NOT NULL,
        char_count INTEGER,
        created_at TEXT NOT NULL,
        is_starred INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_clip_entries_created ON clip_entries(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_clip_entries_hash ON clip_entries(content_hash);
      CREATE INDEX IF NOT EXISTS idx_clip_entries_starred ON clip_entries(is_starred);
      CREATE TABLE IF NOT EXISTS clip_tags (
        entry_id INTEGER NOT NULL REFERENCES clip_entries(id) ON DELETE CASCADE,
        tag TEXT NOT NULL,
        PRIMARY KEY (entry_id, tag)
      );
      CREATE INDEX IF NOT EXISTS idx_clip_tags_tag ON clip_tags(tag);
      CREATE TABLE IF NOT EXISTS clip_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `)
    if (version === 0) this.db.exec(`PRAGMA user_version=${SCHEMA_VERSION}`)
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('clipboard history store is closed')
  }

  /** Insert a new entry, or bump `created_at` when the same content resurfaces. */
  insertOrResurface(entry: ClipEntryInput): InsertResult {
    this.assertOpen()
    if (entry.kind === 'text') return this.insertText(entry)
    if (entry.kind === 'image') return this.insertImage(entry)
    throw new ClipEntryRejectedError('unknown clipboard entry kind')
  }

  private insertText(entry: ClipEntryInput): InsertResult {
    const text = entry.text ?? ''
    if (text.length === 0) throw new ClipEntryRejectedError('clipboard text is empty')
    const byteLength = Buffer.byteLength(text, 'utf8')
    if (byteLength > MAX_TEXT_BYTES) throw new ClipEntryRejectedError('clipboard text exceeds 1 MiB')
    const hash = contentHash('text', Buffer.from(text, 'utf8'))
    const existing = this.existingId(hash)
    if (existing !== null) {
      this.touch(existing)
      return { id: existing, inserted: false }
    }
    const result = this.db.prepare(`
      INSERT INTO clip_entries (kind, text_content, text_search, content_hash, char_count, created_at, is_starred)
      VALUES ('text', ?, ?, ?, ?, ?, 0)
    `).run(text, text.toLowerCase(), hash, text.length, this.timestamp())
    return { id: asNumber(result.lastInsertRowid), inserted: true }
  }

  private insertImage(entry: ClipEntryInput): InsertResult {
    const bytes = entry.imageBytes
    if (!bytes || bytes.length === 0) throw new ClipEntryRejectedError('clipboard image is empty')
    if (bytes.length > MAX_IMAGE_BYTES) throw new ClipEntryRejectedError('clipboard image exceeds 20 MiB')
    if (!entry.imageFormat) throw new ClipEntryRejectedError('clipboard image format is required')
    const hash = contentHash('image', bytes)
    const existing = this.existingId(hash)
    if (existing !== null) {
      this.touch(existing)
      return { id: existing, inserted: false }
    }
    const relativePath = join('images', `${hash}.${entry.imageFormat}`)
    const absolutePath = join(this.dir, relativePath)
    const createdFile = !existsSync(absolutePath)
    if (createdFile) writeFileSync(absolutePath, bytes, { mode: 0o600 })
    const width = typeof entry.imageWidth === 'number' ? entry.imageWidth : null
    const height = typeof entry.imageHeight === 'number' ? entry.imageHeight : null
    const insert = this.db.prepare(`
      INSERT INTO clip_entries (kind, image_path, image_thumb, image_format, image_width, image_height, image_byte_size, content_hash, created_at, is_starred)
      VALUES ('image', ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `)
    try {
      const result = insert.run(relativePath, entry.thumbnailPng ?? null, entry.imageFormat, width, height, bytes.length, hash, this.timestamp())
      return { id: asNumber(result.lastInsertRowid), inserted: true }
    } catch (error) {
      // The row never landed: drop the file this call just wrote so it does not
      // accumulate unreferenced.
      if (createdFile) this.removeImageFile(relativePath)
      throw error
    }
  }

  private existingId(hash: string): number | null {
    const row = this.db.prepare('SELECT id FROM clip_entries WHERE content_hash = ? ORDER BY id LIMIT 1').get(hash)
    return row ? asNumber(row.id) : null
  }

  private touch(id: number): void {
    this.db.prepare('UPDATE clip_entries SET created_at = ? WHERE id = ?').run(this.timestamp(), id)
  }

  private timestamp(): string {
    return this.now().toISOString()
  }

  private tagsFor(entryId: number): string[] {
    const rows = this.db.prepare('SELECT tag FROM clip_tags WHERE entry_id = ? ORDER BY tag').all(entryId)
    return rows.map(row => String(row.tag))
  }

  private toSummary(row: EntryRow): ClipEntrySummary {
    const kind: ClipEntryKind = row.kind === 'image' ? 'image' : 'text'
    const format = row.image_format === 'png' || row.image_format === 'gif' || row.image_format === 'jpg' ? row.image_format : null
    const thumb = row.image_thumb ? Buffer.from(row.image_thumb) : null
    return {
      id: asNumber(row.id),
      kind,
      preview: kind === 'text' ? textPreview(row.text_content ?? '') : (format ? format.toUpperCase() : ''),
      text: kind === 'text' ? row.text_content : null,
      charCount: row.char_count === null ? null : asNumber(row.char_count),
      imageFormat: format,
      imageWidth: row.image_width === null ? null : asNumber(row.image_width),
      imageHeight: row.image_height === null ? null : asNumber(row.image_height),
      imageByteSize: row.image_byte_size === null ? null : asNumber(row.image_byte_size),
      thumbDataUrl: thumb ? `data:image/png;base64,${thumb.toString('base64')}` : null,
      tags: this.tagsFor(asNumber(row.id)),
      starred: row.is_starred === 1,
      createdAt: row.created_at,
      sourceApp: null,
    }
  }

  list(query: ClipListQuery = {}): ClipListResult {
    this.assertOpen()
    const where: string[] = []
    const params: SqlValue[] = []
    const rawQuery = typeof query.q === 'string' ? query.q.trim().toLowerCase().slice(0, MAX_QUERY_LENGTH) : ''
    if (rawQuery) {
      where.push(`text_search LIKE ? ESCAPE '\\'`)
      params.push(`%${escapeLike(rawQuery)}%`)
    }
    if (query.kind === 'text' || query.kind === 'image') {
      where.push('kind = ?')
      params.push(query.kind)
    }
    if (query.format === 'png' || query.format === 'gif' || query.format === 'jpg') {
      where.push('image_format = ?')
      params.push(query.format)
    }
    if (query.starredOnly) where.push('is_starred = 1')
    const tag = typeof query.tag === 'string' ? query.tag.trim().toLowerCase() : ''
    if (tag) {
      where.push('EXISTS (SELECT 1 FROM clip_tags t WHERE t.entry_id = clip_entries.id AND t.tag = ?)')
      params.push(tag)
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const limit = Number.isFinite(query.limit) && (query.limit ?? 0) > 0 ? Math.min(Math.floor(query.limit as number), 500) : DEFAULT_PAGE_SIZE
    const offset = Number.isFinite(query.offset) && (query.offset ?? 0) > 0 ? Math.floor(query.offset as number) : 0

    const total = asNumber(this.db.prepare(`SELECT COUNT(*) AS c FROM clip_entries ${clause}`).get(...params)?.c)
    const rows = this.db.prepare(`
      SELECT id, kind, text_content, image_path, image_thumb, image_format, image_width, image_height,
             image_byte_size, char_count, created_at, is_starred
      FROM clip_entries ${clause}
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as unknown as EntryRow[]
    const entries = rows.map(row => this.toSummary(row))
    return { entries, total, counts: this.counts(), hasMore: offset + entries.length < total }
  }

  private counts(): ClipCounts {
    const scalar = (suffix = ''): number =>
      asNumber(this.db.prepare(`SELECT COUNT(*) AS c FROM clip_entries ${suffix}`).get()?.c)
    return {
      total: scalar(),
      starred: scalar('WHERE is_starred = 1'),
      text: scalar(`WHERE kind = 'text'`),
      image: scalar(`WHERE kind = 'image'`),
    }
  }

  get(id: number): ClipEntryDetail | null {
    this.assertOpen()
    const row = this.db.prepare(`
      SELECT id, kind, text_content, image_path, image_thumb, image_format, image_width, image_height,
             image_byte_size, char_count, created_at, is_starred
      FROM clip_entries WHERE id = ?
    `).get(id) as unknown as EntryRow | undefined
    if (!row) return null
    const summary = this.toSummary(row)
    let imageDataUrl: string | null = null
    if (summary.kind === 'image' && row.image_path && summary.imageFormat) {
      const absolutePath = join(this.dir, row.image_path)
      if (existsSync(absolutePath)) {
        imageDataUrl = `data:${IMAGE_MIME[summary.imageFormat]};base64,${readFileSync(absolutePath).toString('base64')}`
      }
    }
    return { ...summary, imageDataUrl }
  }

  setStarred(id: number, starred: boolean): void {
    this.assertOpen()
    this.db.prepare('UPDATE clip_entries SET is_starred = ? WHERE id = ?').run(starred ? 1 : 0, id)
  }

  setTags(id: number, tags: readonly string[]): void {
    this.assertOpen()
    const normalized = normalizeTags(tags)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare('DELETE FROM clip_tags WHERE entry_id = ?').run(id)
      const insert = this.db.prepare('INSERT OR IGNORE INTO clip_tags (entry_id, tag) VALUES (?, ?)')
      for (const tag of normalized) insert.run(id, tag)
      this.db.exec('COMMIT')
    } catch (error) {
      try { this.db.exec('ROLLBACK') } catch { /* already ended */ }
      throw error
    }
  }

  /** Delete a row and its image file (tags cascade). */
  delete(id: number): void {
    this.assertOpen()
    const row = this.db.prepare('SELECT image_path FROM clip_entries WHERE id = ?').get(id) as { image_path?: string | null } | undefined
    this.db.prepare('DELETE FROM clip_entries WHERE id = ?').run(id)
    if (row?.image_path) this.removeImageFile(row.image_path)
  }

  /** Remove every entry (optionally keeping starred ones); orphaned image files are deleted. */
  clear(keepStarred: boolean): number {
    this.assertOpen()
    const clause = keepStarred ? 'WHERE is_starred = 0' : ''
    const paths = (this.db.prepare(`SELECT image_path FROM clip_entries ${clause}`).all() as { image_path?: string | null }[])
      .map(row => row.image_path)
      .filter((path): path is string => typeof path === 'string' && path.length > 0)
    const result = this.db.prepare(`DELETE FROM clip_entries ${clause}`).run()
    for (const path of paths) this.removeImageFile(path)
    return asNumber(result.changes)
  }

  tagCounts(): { tag: string; count: number }[] {
    this.assertOpen()
    const rows = this.db.prepare('SELECT tag, COUNT(*) AS c FROM clip_tags GROUP BY tag ORDER BY c DESC, tag').all() as { tag: string; c: number }[]
    return rows
      .filter(row => !HIDDEN_TAGS[row.tag])
      .map(row => ({ tag: String(row.tag), count: asNumber(row.c) }))
  }

  stats(): ClipStats {
    this.assertOpen()
    const aggregate = this.db.prepare(`
      SELECT
        SUM(CASE WHEN kind = 'text' THEN length(CAST(text_content AS BLOB)) ELSE COALESCE(image_byte_size, 0) END) AS bytes,
        MIN(created_at) AS oldest
      FROM clip_entries
    `).get() as { bytes?: number | null; oldest?: string | null } | undefined
    const counts = this.counts()
    const imageRows = this.db.prepare('SELECT image_path FROM clip_entries WHERE kind = \'image\'').all() as { image_path?: string | null }[]
    let storageBytes = 0
    for (const row of imageRows) {
      if (!row.image_path) continue
      try { storageBytes += statSync(join(this.dir, row.image_path)).size } catch { /* file already gone */ }
    }
    return {
      total: counts.total,
      starred: counts.starred,
      text: counts.text,
      image: counts.image,
      bytes: asNumber(aggregate?.bytes),
      storageBytes,
      oldestAt: aggregate?.oldest ?? null,
    }
  }

  getSettings(): ClipSettings {
    this.assertOpen()
    const rows = this.db.prepare('SELECT key, value FROM clip_settings').all() as { key: string; value: string }[]
    const stored = new Map(rows.map(row => [row.key, row.value]))
    return {
      ...DEFAULT_CLIP_SETTINGS,
      ...this.readSettings(stored),
    }
  }

  private readSettings(stored: Map<string, string>): Partial<ClipSettings> {
    const patch: Partial<ClipSettings> = {}
    const bool = (key: keyof ClipSettings): boolean | undefined => {
      const value = stored.get(key)
      if (value === undefined) return undefined
      return value === 'true'
    }
    const captureEnabled = bool('captureEnabled'); if (captureEnabled !== undefined) patch.captureEnabled = captureEnabled
    const captureImages = bool('captureImages'); if (captureImages !== undefined) patch.captureImages = captureImages
    const hideSensitive = bool('hideSensitive'); if (hideSensitive !== undefined) patch.hideSensitive = hideSensitive
    const globalShortcutEnabled = bool('globalShortcutEnabled'); if (globalShortcutEnabled !== undefined) patch.globalShortcutEnabled = globalShortcutEnabled
    const retention = Number(stored.get('retentionDays'))
    if (stored.has('retentionDays')) patch.retentionDays = ACCEPTED_RETENTION_DAYS.includes(retention as typeof ACCEPTED_RETENTION_DAYS[number]) ? retention : DEFAULT_CLIP_SETTINGS.retentionDays
    const maxEntries = Number(stored.get('maxEntries'))
    if (stored.has('maxEntries')) patch.maxEntries = Number.isFinite(maxEntries) ? Math.min(Math.max(Math.floor(maxEntries), MIN_ENTRIES), MAX_ENTRIES) : DEFAULT_CLIP_SETTINGS.maxEntries
    const shortcut = stored.get('globalShortcut')
    if (shortcut !== undefined) patch.globalShortcut = shortcut.trim().slice(0, 64) || DEFAULT_CLIP_SETTINGS.globalShortcut
    return patch
  }

  saveSettings(patch: Partial<ClipSettings>): ClipSettings {
    this.assertOpen()
    const current = this.getSettings()
    const next: ClipSettings = {
      captureEnabled: typeof patch.captureEnabled === 'boolean' ? patch.captureEnabled : current.captureEnabled,
      captureImages: typeof patch.captureImages === 'boolean' ? patch.captureImages : current.captureImages,
      hideSensitive: typeof patch.hideSensitive === 'boolean' ? patch.hideSensitive : current.hideSensitive,
      globalShortcutEnabled: typeof patch.globalShortcutEnabled === 'boolean' ? patch.globalShortcutEnabled : current.globalShortcutEnabled,
      retentionDays: patch.retentionDays !== undefined && ACCEPTED_RETENTION_DAYS.includes(patch.retentionDays as typeof ACCEPTED_RETENTION_DAYS[number])
        ? patch.retentionDays
        : patch.retentionDays !== undefined ? DEFAULT_CLIP_SETTINGS.retentionDays : current.retentionDays,
      maxEntries: patch.maxEntries !== undefined && Number.isFinite(patch.maxEntries)
        ? Math.min(Math.max(Math.floor(patch.maxEntries), MIN_ENTRIES), MAX_ENTRIES)
        : current.maxEntries,
      globalShortcut: typeof patch.globalShortcut === 'string'
        ? (patch.globalShortcut.trim().slice(0, 64) || DEFAULT_CLIP_SETTINGS.globalShortcut)
        : current.globalShortcut,
    }
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const upsert = this.db.prepare('INSERT INTO clip_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      for (const [key, value] of Object.entries(next)) upsert.run(key, String(value))
      this.db.exec('COMMIT')
    } catch (error) {
      try { this.db.exec('ROLLBACK') } catch { /* already ended */ }
      throw error
    }
    return next
  }

  /** Delete expired non-starred rows, then trim non-starred rows beyond `maxEntries`. */
  prune(now: Date = this.now()): PruneResult {
    this.assertOpen()
    const settings = this.getSettings()
    const cutoff = new Date(now.getTime() - settings.retentionDays * 86_400_000).toISOString()
    const expired = this.collectAndDelete('WHERE is_starred = 0 AND created_at < ?', [cutoff])
    const trimmed = this.collectAndDelete(`
      WHERE is_starred = 0 AND id NOT IN (
        SELECT id FROM clip_entries WHERE is_starred = 0 ORDER BY created_at DESC, id DESC LIMIT ?
      )
    `, [settings.maxEntries])
    return { expired, trimmed }
  }

  private collectAndDelete(clause: string, params: SqlValue[]): number {
    const paths = (this.db.prepare(`SELECT image_path FROM clip_entries ${clause}`).all(...params) as { image_path?: string | null }[])
      .map(row => row.image_path)
      .filter((path): path is string => typeof path === 'string' && path.length > 0)
    const result = this.db.prepare(`DELETE FROM clip_entries ${clause}`).run(...params)
    for (const path of paths) this.removeImageFile(path)
    return asNumber(result.changes)
  }

  private removeImageFile(relativePath: string): void {
    try { unlinkSync(join(this.dir, relativePath)) } catch { /* already gone */ }
  }

  close(): void {
    if (this.closed) return
    this.db.close()
    this.closed = true
  }
}