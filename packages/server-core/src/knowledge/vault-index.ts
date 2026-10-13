/**
 * Local vault SQLite index (Issue 06 / W1-B).
 *
 * Canonical notes stay on disk as Markdown. This file is a rebuildable projection:
 * `{notesRoot}/.craft/vault-index.sqlite`. A missing or corrupt index is recovered
 * by scanning the vault; rebuild never writes `.md` files.
 *
 * bun:sqlite is lazy-required so Electron/Node loads fail-soft (same contract as
 * source-index / memory FTS).
 */
import { createHash } from 'node:crypto'
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  unlinkSync,
  type Dirent,
  type Stats,
} from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import type { Database } from 'bun:sqlite'
import { isImportProvenancedRelativePath } from '@rox/shared/config'
import {
  buildVaultInsights,
  extractNamedEntities,
  type VaultCatalogEntry,
  type VaultInsights,
} from '@rox/shared/knowledge/vault-insights'
import {
  noteIdFromRelativePath,
  parseVaultMarkdown,
  stripMdExtension,
  toSlashPath,
  type ParsedVaultNote,
} from './vault-markdown.ts'

type DatabaseCtor = new (path: string) => Database
let cachedCtor: DatabaseCtor | null | undefined

function getDatabaseCtor(): DatabaseCtor | null {
  if (cachedCtor === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      cachedCtor = require('bun:sqlite').Database as DatabaseCtor
    } catch {
      cachedCtor = null
    }
  }
  return cachedCtor ?? null
}

export const VAULT_INDEX_SCHEMA_VERSION = 1
export const VAULT_INDEX_REL = join('.craft', 'vault-index.sqlite')
const SKIP_DIRS = new Set(['assets', 'templates', '.craft', '.git'])
const MAX_NOTES = 4_000
const MAX_NOTE_BYTES = 2 * 1024 * 1024
const REFRESH_BATCH = 200
const RETAINED_CONTENT_BYTES = 64 * 1024 * 1024
const CATALOG_NEEDLE_LIMIT = 16
// Recursive fs.watch misses some atomic renames (notably on Linux), so a
// trusted watcher still gets a periodic full stat diff.
const WATCH_BACKSTOP_MS = 60_000

export interface VaultWikiLink {
  target: string
  alias?: string
  heading?: string
  line: number
  preview: string
}

export interface VaultDocumentSummary {
  id: string
  title: string
  relativePath: string
  tags: string[]
  aliases: string[]
  properties: Record<string, unknown>
  links: VaultWikiLink[]
  assetRefs: string[]
  updatedAt: number
  createdAt: number
  size: number
  hash: string
}

export interface VaultBacklink {
  noteId: string
  title: string
  relativePath: string
  line: number
  preview: string
}

export interface VaultTaskHit {
  documentId: string
  title: string
  line: number
  checked: boolean
  text: string
}

export interface VaultRebuildResult {
  ok: boolean
  dbPath: string
  indexed: number
  unchanged: number
  skipped: number
  truncated: boolean
  recovered: boolean
  available: boolean
}

export interface VaultHealth {
  ok: boolean
  available: boolean
  dbPath: string
  schemaVersion: number | null
  documentCount: number
  recovered: boolean
  indexed: number
  unchanged: number
  skipped: number
  truncated: boolean
}

const lastRebuildByRoot = new Map<string, VaultRebuildResult>()

function rememberRebuild(notesRoot: string, result: VaultRebuildResult): VaultRebuildResult {
  lastRebuildByRoot.set(resolve(notesRoot), result)
  return result
}

export type { VaultInsights }

const handles = new Map<string, { db: Database; fts: boolean }>()

export function isVaultIndexAvailable(): boolean {
  return getDatabaseCtor() !== null
}

export function vaultIndexPath(notesRoot: string): string {
  return join(resolve(notesRoot), VAULT_INDEX_REL)
}

export function closeAllVaultIndexes(): void {
  for (const handle of handles.values()) {
    try {
      handle.db.close()
    } catch {
      /* already closed */
    }
  }
  handles.clear()
  for (const state of refreshStates.values()) {
    state.trusted = false
    state.fullScan = true
  }
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function linePreview(content: string, line: number): string {
  return (content.split(/\r?\n/)[line - 1] ?? '').trim()
}

function parseProperties(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw) as unknown
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>
    }
  } catch {
    /* ignore */
  }
  return {}
}

function parseStringList(raw: string): string[] {
  try {
    const value = JSON.parse(raw) as unknown
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
  } catch {
    /* ignore */
  }
  return []
}

function isSqliteDatabaseFile(dbPath: string): boolean {
  if (!existsSync(dbPath)) return false
  let fd: number | null = null
  try {
    fd = openSync(dbPath, 'r')
    const header = Buffer.alloc(16)
    const bytes = readSync(fd, header, 0, header.length, 0)
    return header.subarray(0, bytes).toString('utf8').startsWith('SQLite format 3')
  } catch {
    return false
  } finally {
    if (fd !== null) closeSync(fd)
  }
}

function unlinkIndexFiles(dbPath: string): void {
  for (const extra of ['', '-wal', '-shm']) {
    const candidate = `${dbPath}${extra}`
    if (existsSync(candidate)) {
      try {
        unlinkSync(candidate)
      } catch {
        try {
          rmSync(candidate, { force: true })
        } catch {
          /* ignore */
        }
      }
    }
  }
}

function closeHandle(notesRoot: string): void {
  const key = resolve(notesRoot)
  const handle = handles.get(key)
  if (!handle) return
  try {
    handle.db.close()
  } catch {
    /* ignore */
  }
  handles.delete(key)
}

function applySchema(db: Database): boolean {
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY NOT NULL,
      relative_path TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      hash TEXT NOT NULL,
      mtime INTEGER NOT NULL DEFAULT 0,
      size INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0,
      body_text TEXT NOT NULL DEFAULT '',
      properties_json TEXT NOT NULL DEFAULT '{}',
      asset_refs_json TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS aliases (
      document_id TEXT NOT NULL,
      alias TEXT NOT NULL,
      PRIMARY KEY (document_id, alias),
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS tags (
      document_id TEXT NOT NULL,
      tag TEXT NOT NULL,
      PRIMARY KEY (document_id, tag),
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS wikilinks (
      id INTEGER PRIMARY KEY,
      source_id TEXT NOT NULL,
      target TEXT NOT NULL,
      alias TEXT,
      heading TEXT,
      line INTEGER NOT NULL,
      preview TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (source_id) REFERENCES documents(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS footnotes (
      id INTEGER PRIMARY KEY,
      document_id TEXT NOT NULL,
      footnote_id TEXT NOT NULL,
      definition INTEGER NOT NULL DEFAULT 0,
      line INTEGER NOT NULL,
      text TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS blocks (
      document_id TEXT NOT NULL,
      block_id TEXT NOT NULL,
      line INTEGER NOT NULL,
      text TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (document_id, block_id),
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'mention'
    );
    CREATE TABLE IF NOT EXISTS entity_mentions (
      id INTEGER PRIMARY KEY,
      entity_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      line INTEGER NOT NULL,
      evidence TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY,
      document_id TEXT NOT NULL,
      line INTEGER NOT NULL,
      checked INTEGER NOT NULL DEFAULT 0,
      text TEXT NOT NULL,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS session_refs (
      id INTEGER PRIMARY KEY,
      document_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      line INTEGER NOT NULL,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS calendar_refs (
      id INTEGER PRIMARY KEY,
      document_id TEXT NOT NULL,
      date TEXT NOT NULL,
      line INTEGER NOT NULL,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS wikilinks_target ON wikilinks(target);
    CREATE INDEX IF NOT EXISTS tags_tag ON tags(tag);
    CREATE INDEX IF NOT EXISTS tasks_document ON tasks(document_id);
  `)
  db.exec(`INSERT OR REPLACE INTO meta(key, value) VALUES ('schema_version', '${VAULT_INDEX_SCHEMA_VERSION}')`)

  let fts = false
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
        id UNINDEXED,
        title,
        body_text,
        content='documents',
        content_rowid='rowid'
      );
      CREATE TRIGGER IF NOT EXISTS documents_ai AFTER INSERT ON documents BEGIN
        INSERT INTO documents_fts(rowid, id, title, body_text) VALUES (new.rowid, new.id, new.title, new.body_text);
      END;
      CREATE TRIGGER IF NOT EXISTS documents_ad AFTER DELETE ON documents BEGIN
        INSERT INTO documents_fts(documents_fts, rowid, id, title, body_text)
          VALUES('delete', old.rowid, old.id, old.title, old.body_text);
      END;
      CREATE TRIGGER IF NOT EXISTS documents_au AFTER UPDATE ON documents BEGIN
        INSERT INTO documents_fts(documents_fts, rowid, id, title, body_text)
          VALUES('delete', old.rowid, old.id, old.title, old.body_text);
        INSERT INTO documents_fts(rowid, id, title, body_text) VALUES (new.rowid, new.id, new.title, new.body_text);
      END;
    `)
    fts = true
  } catch {
    fts = false
  }
  return fts
}

function integrityOk(db: Database): boolean {
  try {
    const row = db.query<{ quick_check: string }, []>('PRAGMA quick_check').get()
    const value = row ? Object.values(row)[0] : null
    return value === 'ok'
  } catch {
    return false
  }
}

function schemaVersionOf(db: Database): number | null {
  try {
    const row = db.query<{ value: string }, []>("SELECT value FROM meta WHERE key = 'schema_version'").get()
    const version = row?.value ? Number(row.value) : NaN
    return Number.isFinite(version) ? version : null
  } catch {
    return null
  }
}

function openDb(notesRoot: string, recover: boolean): { db: Database; fts: boolean; recovered: boolean } | null {
  const Ctor = getDatabaseCtor()
  if (!Ctor) return null
  const key = resolve(notesRoot)
  const cached = handles.get(key)
  if (cached) return { ...cached, recovered: false }

  const dbPath = vaultIndexPath(notesRoot)
  mkdirSync(dirname(dbPath), { recursive: true })
  const existed = existsSync(dbPath)
  const validSqlite = isSqliteDatabaseFile(dbPath)
  if (existed && !validSqlite && recover) {
    unlinkIndexFiles(dbPath)
  }

  const tryOpen = (): { db: Database; fts: boolean } | null => {
    try {
      const db = new Ctor(dbPath)
      const fts = applySchema(db)
      if (!integrityOk(db) || schemaVersionOf(db) !== VAULT_INDEX_SCHEMA_VERSION) {
        try {
          db.close()
        } catch {
          /* ignore */
        }
        return null
      }
      return { db, fts }
    } catch {
      return null
    }
  }

  let opened = tryOpen()
  let recovered = false
  if (!opened && recover) {
    unlinkIndexFiles(dbPath)
    opened = tryOpen()
    recovered = opened !== null
  }
  if (!opened) return null
  handles.set(key, opened)
  return { ...opened, recovered }
}

interface FileFingerprint {
  mtimeMs: number
  size: number
  birthtimeMs: number
  isFile: boolean
}

interface DirEntry {
  name: string
  isDirectory: boolean
  isFile: boolean
}

type IoOp =
  | { op: 'readdir'; path: string }
  | { op: 'stat'; paths: string[] }
  | { op: 'read'; paths: string[] }
  | { op: 'yield' }

/** Index work is written once as steps and driven by a sync or an async fs runner. */
type IoSteps<T> = Generator<IoOp, T, unknown>

export interface VaultIndexIoProbe {
  stat?: (absPath: string) => void
  read?: (absPath: string) => void
}

export interface VaultIndexIoForTests {
  readFile?: (path: string, encoding: BufferEncoding) => Promise<string>
  readFileSync?: (path: string, encoding: BufferEncoding) => string
}

let ioProbe: VaultIndexIoProbe | null = null
let testIo: VaultIndexIoForTests | null = null

/** Observe note stats and content reads made by index refreshes. Returns a disposer. */
export function setVaultIndexIoProbe(probe: VaultIndexIoProbe | null): () => void {
  ioProbe = probe
  return () => { if (ioProbe === probe) ioProbe = null }
}

export function setVaultIndexIoForTests(io: VaultIndexIoForTests | null): void {
  testIo = io
}

export function resetVaultIndexIoForTests(): void {
  testIo = null
}

function toDirEntry(entry: Dirent): DirEntry {
  return { name: entry.name, isDirectory: entry.isDirectory(), isFile: entry.isFile() }
}

function toFingerprint(st: Stats): FileFingerprint {
  return { mtimeMs: st.mtimeMs, size: st.size, birthtimeMs: st.birthtimeMs, isFile: st.isFile() }
}

function performSync(op: IoOp): unknown {
  switch (op.op) {
    case 'readdir':
      try {
        return readdirSync(op.path, { withFileTypes: true }).map(toDirEntry)
      } catch {
        return null
      }
    case 'stat':
      return op.paths.map((path) => {
        ioProbe?.stat?.(path)
        try {
          return toFingerprint(statSync(path))
        } catch {
          return null
        }
      })
    case 'read':
      return op.paths.map((path) => {
        ioProbe?.read?.(path)
        try {
          return (testIo?.readFileSync ?? readFileSync)(path, 'utf8')
        } catch {
          return null
        }
      })
    case 'yield':
      return undefined
  }
}

async function performAsync(op: IoOp): Promise<unknown> {
  switch (op.op) {
    case 'readdir':
      return readdir(op.path, { withFileTypes: true }).then(entries => entries.map(toDirEntry), () => null)
    case 'stat':
      return Promise.all(op.paths.map((path) => {
        ioProbe?.stat?.(path)
        return stat(path).then(toFingerprint, () => null)
      }))
    case 'read':
      return Promise.all(op.paths.map((path) => {
        ioProbe?.read?.(path)
        return (testIo?.readFile ?? readFile)(path, 'utf8').catch(() => null)
      }))
    case 'yield':
      return new Promise<void>(resolveYield => setImmediate(resolveYield))
  }
}

function runSync<T>(steps: IoSteps<T>): T {
  let step = steps.next()
  while (!step.done) step = steps.next(performSync(step.value))
  return step.value
}

async function runAsync<T>(steps: IoSteps<T>): Promise<T> {
  let step = steps.next()
  while (!step.done) step = steps.next(await performAsync(step.value))
  return step.value
}

function* walkSteps(root: string): IoSteps<{ files: string[]; truncated: boolean; skipped: number }> {
  const files: string[] = []
  let skipped = 0
  if (!existsSync(root)) return { files, truncated: false, skipped }

  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop()!
    const entries = (yield { op: 'readdir', path: dir }) as DirEntry[] | null
    if (!entries) {
      skipped++
      continue
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const abs = join(dir, entry.name)
      const rel = toSlashPath(relative(root, abs))
      if (isImportProvenancedRelativePath(rel)) continue
      if (entry.isDirectory) {
        const top = rel.split('/')[0] ?? rel
        if (SKIP_DIRS.has(top)) continue
        stack.push(abs)
        continue
      }
      if (!entry.isFile || !entry.name.toLowerCase().endsWith('.md')) continue
      if (files.length >= MAX_NOTES) return { files, truncated: true, skipped }
      files.push(abs)
    }
  }
  return { files, truncated: false, skipped }
}

function walkMarkdownFiles(notesRoot: string): { files: string[]; truncated: boolean; skipped: number } {
  return runSync(walkSteps(resolve(notesRoot)))
}

function loadCatalog(db: Database): VaultCatalogEntry[] {
  const docs = db.query<{ id: string; title: string }, []>('SELECT id, title FROM documents').all()
  const aliasRows = db.query<{ document_id: string; alias: string }, []>('SELECT document_id, alias FROM aliases').all()
  const aliases = new Map<string, string[]>()
  for (const row of aliasRows) {
    const list = aliases.get(row.document_id) ?? []
    list.push(row.alias)
    aliases.set(row.document_id, list)
  }
  return docs.map((doc) => ({ id: doc.id, title: doc.title, aliases: aliases.get(doc.id) ?? [] }))
}

interface EntityTarget {
  id: string
  relative_path: string
  properties_json: string
}

function replaceEntityMentions(db: Database, target: EntityTarget, content: string | null, catalog: VaultCatalogEntry[]): void {
  db.query('DELETE FROM entity_mentions WHERE document_id = ?').run(target.id)
  if (content === null) return
  // Upsert rather than REPLACE: a REPLACE delete cascades to other documents' mentions.
  const upsertEntity = db.query(
    'INSERT INTO entities(id, name, kind) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, kind = excluded.kind',
  )
  const insertMention = db.query(
    'INSERT INTO entity_mentions(entity_id, document_id, line, evidence) VALUES (?, ?, ?, ?)',
  )
  for (const entity of extractNamedEntities(target.id, content, catalog, parseProperties(target.properties_json))) {
    upsertEntity.run(entity.id, entity.name, entity.kind)
    insertMention.run(entity.id, entity.documentId, entity.line, entity.evidence)
  }
}

function catalogKey(entry: VaultCatalogEntry): string {
  return JSON.stringify([entry.title, [...entry.aliases].sort()])
}

/**
 * Entity extraction for a document depends on every other note's id, title and aliases.
 * When those change, re-extract only documents whose stored text mentions an affected name.
 */
function catalogDependents(
  db: Database,
  before: VaultCatalogEntry[],
  after: VaultCatalogEntry[],
  exclude: ReadonlySet<string>,
): string[] {
  const beforeById = new Map(before.map(entry => [entry.id, entry]))
  const afterById = new Map(after.map(entry => [entry.id, entry]))
  const differs = (entry: VaultCatalogEntry, other: VaultCatalogEntry | undefined) => !other || catalogKey(other) !== catalogKey(entry)
  const changed = [
    ...before.filter(entry => differs(entry, afterById.get(entry.id))),
    ...after.filter(entry => differs(entry, beforeById.get(entry.id))),
  ]
  if (changed.length === 0 || after.every(entry => exclude.has(entry.id))) return []

  const needles = new Set<string>()
  for (const entry of changed) {
    const leaf = entry.id.split('/').pop() ?? entry.id
    for (const value of [entry.title, leaf, leaf.replace(/-/g, ' '), ...entry.aliases]) {
      const needle = value.trim().toLowerCase()
      if (needle.length >= 2) needles.add(needle)
    }
  }
  const rows = db
    .query<{ id: string; body_text: string; properties_json: string }, []>(
      'SELECT id, body_text, properties_json FROM documents',
    )
    .all()
    .filter(row => !exclude.has(row.id))
  if (needles.size > CATALOG_NEEDLE_LIMIT) return rows.map(row => row.id)
  return rows
    .filter((row) => {
      const haystack = `${row.body_text}\n${row.properties_json}`.toLowerCase()
      for (const needle of needles) {
        if (haystack.includes(needle)) return true
      }
      return false
    })
    .map(row => row.id)
}

function replaceChildren(db: Database, documentId: string, parsed: ParsedVaultNote, content: string): void {
  db.query('DELETE FROM aliases WHERE document_id = ?').run(documentId)
  db.query('DELETE FROM tags WHERE document_id = ?').run(documentId)
  db.query('DELETE FROM wikilinks WHERE source_id = ?').run(documentId)
  db.query('DELETE FROM footnotes WHERE document_id = ?').run(documentId)
  db.query('DELETE FROM blocks WHERE document_id = ?').run(documentId)
  db.query('DELETE FROM entity_mentions WHERE document_id = ?').run(documentId)
  db.query('DELETE FROM tasks WHERE document_id = ?').run(documentId)
  db.query('DELETE FROM session_refs WHERE document_id = ?').run(documentId)
  db.query('DELETE FROM calendar_refs WHERE document_id = ?').run(documentId)

  const insertAlias = db.query('INSERT OR IGNORE INTO aliases(document_id, alias) VALUES (?, ?)')
  for (const alias of parsed.aliases) insertAlias.run(documentId, alias)

  const insertTag = db.query('INSERT OR IGNORE INTO tags(document_id, tag) VALUES (?, ?)')
  for (const tag of parsed.tags) insertTag.run(documentId, tag)

  const insertLink = db.query(
    'INSERT INTO wikilinks(source_id, target, alias, heading, line, preview) VALUES (?, ?, ?, ?, ?, ?)',
  )
  for (const link of parsed.links) {
    const preview = linePreview(content, link.line)
    insertLink.run(documentId, link.target, link.alias ?? null, link.heading ?? null, link.line, preview)
  }

  const insertFootnote = db.query(
    'INSERT INTO footnotes(document_id, footnote_id, definition, line, text) VALUES (?, ?, ?, ?, ?)',
  )
  for (const footnote of parsed.footnotes) {
    insertFootnote.run(documentId, footnote.footnoteId, footnote.definition ? 1 : 0, footnote.line, footnote.text)
  }

  const insertBlock = db.query(
    'INSERT OR REPLACE INTO blocks(document_id, block_id, line, text) VALUES (?, ?, ?, ?)',
  )
  for (const block of parsed.blocks) insertBlock.run(documentId, block.id, block.line, block.text)

  const insertTask = db.query(
    'INSERT INTO tasks(document_id, line, checked, text) VALUES (?, ?, ?, ?)',
  )
  for (const task of parsed.tasks) insertTask.run(documentId, task.line, task.checked ? 1 : 0, task.text)

  const insertSession = db.query(
    'INSERT INTO session_refs(document_id, session_id, line) VALUES (?, ?, ?)',
  )
  for (const ref of parsed.sessionRefs) insertSession.run(documentId, ref.sessionId, ref.line)

  const insertCalendar = db.query(
    'INSERT INTO calendar_refs(document_id, date, line) VALUES (?, ?, ?)',
  )
  for (const ref of parsed.calendarRefs) insertCalendar.run(documentId, ref.date, ref.line)
}

interface StoredDocument {
  relativePath: string
  hash: string
  mtime: number
  size: number
}

interface StatHit {
  abs: string
  id: string
  relativePath: string
  st: FileFingerprint
}

interface RefreshPlan {
  changed: StatHit[]
  unchanged: number
  skipped: number
  truncated: boolean
  /** Ids found on disk; null when only dirty paths were checked and nothing may be dropped. */
  present: Set<string> | null
}

interface RefreshMode {
  clear: boolean
  dirty: string[] | null
  epoch: number
  truncated: boolean
}

interface RefreshOutcome {
  counts: Pick<VaultRebuildResult, 'indexed' | 'unchanged' | 'skipped' | 'truncated'>
  fullScan: boolean
}

function loadStoredDocuments(db: Database): Map<string, StoredDocument> {
  const rows = db
    .query<{ id: string; relative_path: string; hash: string; mtime: number; size: number }, []>(
      'SELECT id, relative_path, hash, mtime, size FROM documents',
    )
    .all()
  return new Map(rows.map(row => [row.id, { relativePath: row.relative_path, hash: row.hash, mtime: row.mtime, size: row.size }]))
}

function sameFingerprint(prior: StoredDocument | undefined, st: FileFingerprint): boolean {
  return prior !== undefined && prior.mtime === st.mtimeMs && prior.size === st.size
}

function* fullPlanSteps(root: string, stored: Map<string, StoredDocument>): IoSteps<RefreshPlan> {
  const walk = yield* walkSteps(root)
  const present = new Set<string>()
  const changed: StatHit[] = []
  let unchanged = 0
  let skipped = walk.skipped
  for (let start = 0; start < walk.files.length; start += REFRESH_BATCH) {
    const batch = walk.files.slice(start, start + REFRESH_BATCH)
    const stats = (yield { op: 'stat', paths: batch }) as Array<FileFingerprint | null>
    batch.forEach((abs, index) => {
      const relativePath = toSlashPath(relative(root, abs))
      const id = noteIdFromRelativePath(relativePath)
      present.add(id)
      const st = stats[index]
      if (!st || st.size > MAX_NOTE_BYTES) skipped++
      else if (sameFingerprint(stored.get(id), st)) unchanged++
      else changed.push({ abs, id, relativePath, st })
    })
  }
  return { changed, unchanged, skipped, truncated: walk.truncated, present }
}

/** Checks only watcher-reported paths of known notes; anything else needs a full diff (null). */
function* dirtyPlanSteps(
  root: string,
  stored: Map<string, StoredDocument>,
  dirty: string[],
  truncated: boolean,
): IoSteps<RefreshPlan | null> {
  const targets = dirty.map(relativePath => ({ abs: join(root, relativePath), id: noteIdFromRelativePath(relativePath), relativePath }))
  if (targets.some(target => stored.get(target.id)?.relativePath !== target.relativePath)) return null
  const stats = targets.length > 0
    ? (yield { op: 'stat', paths: targets.map(target => target.abs) }) as Array<FileFingerprint | null>
    : []
  const changed: StatHit[] = []
  let skipped = 0
  for (const [index, target] of targets.entries()) {
    const st = stats[index]
    if (!st?.isFile) return null
    if (st.size > MAX_NOTE_BYTES) skipped++
    else if (!sameFingerprint(stored.get(target.id), st)) changed.push({ ...target, st })
  }
  return { changed, unchanged: stored.size - changed.length - skipped, skipped, truncated, present: null }
}

function applyDocument(db: Database, hit: StatHit, content: string, prior: StoredDocument | undefined): 'indexed' | 'unchanged' {
  const { id, relativePath, st } = hit
  const hash = hashText(content)
  if (prior?.hash === hash && prior.size === st.size) {
    db.query('UPDATE documents SET mtime = ? WHERE id = ?').run(st.mtimeMs, id)
    return 'unchanged'
  }

  const parsed = parseVaultMarkdown(content, relativePath)
  db.query(`
    INSERT INTO documents(
      id, relative_path, title, hash, mtime, size, created_at, updated_at, body_text, properties_json, asset_refs_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      relative_path = excluded.relative_path,
      title = excluded.title,
      hash = excluded.hash,
      mtime = excluded.mtime,
      size = excluded.size,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      body_text = excluded.body_text,
      properties_json = excluded.properties_json,
      asset_refs_json = excluded.asset_refs_json
  `).run(
    id,
    relativePath,
    parsed.title,
    hash,
    st.mtimeMs,
    st.size,
    st.birthtimeMs || st.mtimeMs,
    st.mtimeMs,
    parsed.body,
    JSON.stringify(parsed.properties),
    JSON.stringify(parsed.assetRefs),
  )
  replaceChildren(db, id, parsed, content)
  return 'indexed'
}

/**
 * Stat-diff the vault against stored fingerprints (or check only dirty paths), then
 * re-read and re-extract just the new/changed notes and drop deleted ones.
 */
function* refreshSteps(db: Database, notesRoot: string, mode: RefreshMode): IoSteps<RefreshOutcome> {
  const root = resolve(notesRoot)
  if (mode.clear) {
    db.exec('DELETE FROM documents')
    db.exec('DELETE FROM entities')
  }
  const stored = loadStoredDocuments(db)
  const dirtyPlan = mode.dirty ? yield* dirtyPlanSteps(root, stored, mode.dirty, mode.truncated) : null
  const plan = dirtyPlan ?? (yield* fullPlanSteps(root, stored))
  const present = plan.present
  const removedIds = present ? [...stored.keys()].filter(id => !present.has(id)) : []
  if (plan.changed.length === 0 && removedIds.length === 0) {
    return { counts: { indexed: 0, unchanged: plan.unchanged, skipped: plan.skipped, truncated: plan.truncated }, fullScan: dirtyPlan === null }
  }

  const catalogBefore = loadCatalog(db)
  let indexed = 0
  let unchanged = plan.unchanged
  let skipped = plan.skipped
  const reextract = new Set<string>()
  const retained = new Map<string, string>()
  let retainedBytes = 0
  for (let start = 0; start < plan.changed.length; start += REFRESH_BATCH) {
    const batch = plan.changed.slice(start, start + REFRESH_BATCH)
    const contents = (yield { op: 'read', paths: batch.map(hit => hit.abs) }) as Array<string | null>
    db.transaction(() => {
      batch.forEach((hit, index) => {
        const content = contents[index] ?? null
        if (content === null) {
          skipped++
          return
        }
        if (applyDocument(db, hit, content, stored.get(hit.id)) === 'unchanged') {
          unchanged++
          return
        }
        indexed++
        reextract.add(hit.id)
        if (retainedBytes + content.length > RETAINED_CONTENT_BYTES) return
        retained.set(hit.id, content)
        retainedBytes += content.length
      })
    })()
    yield { op: 'yield' }
  }
  if (removedIds.length > 0) {
    db.transaction(() => {
      for (const id of removedIds) db.query('DELETE FROM documents WHERE id = ?').run(id)
    })()
  }

  const catalog = loadCatalog(db)
  for (const id of catalogDependents(db, catalogBefore, catalog, reextract)) reextract.add(id)
  const targets = db
    .query<EntityTarget, []>('SELECT id, relative_path, properties_json FROM documents')
    .all()
    .filter(row => reextract.has(row.id))
  for (let start = 0; start < targets.length; start += REFRESH_BATCH) {
    const batch = targets.slice(start, start + REFRESH_BATCH)
    const missing = batch.filter(row => !retained.has(row.id))
    const read = missing.length > 0
      ? (yield { op: 'read', paths: missing.map(row => join(root, row.relative_path)) }) as Array<string | null>
      : []
    const contents = new Map(missing.map((row, index) => [row.id, read[index] ?? null]))
    db.transaction(() => {
      for (const row of batch) replaceEntityMentions(db, row, retained.get(row.id) ?? contents.get(row.id) ?? null, catalog)
    })()
    yield { op: 'yield' }
  }
  db.exec('DELETE FROM entities WHERE id NOT IN (SELECT entity_id FROM entity_mentions)')
  return { counts: { indexed, unchanged, skipped, truncated: plan.truncated }, fullScan: dirtyPlan === null }
}

interface VaultRefreshState {
  inFlight: Promise<VaultRebuildResult> | null
  followUp: Promise<VaultRebuildResult> | null
  markedDuringFlight: boolean
  dirty: Set<string>
  fullScan: boolean
  watchers: number
  watchEpoch: number
  trusted: boolean
  lastFullScanAt: number
  truncated: boolean
}

const refreshStates = new Map<string, VaultRefreshState>()

function refreshStateFor(notesRoot: string): VaultRefreshState {
  const key = resolve(notesRoot)
  let state = refreshStates.get(key)
  if (!state) {
    state = {
      inFlight: null,
      followUp: null,
      markedDuringFlight: false,
      dirty: new Set(),
      fullScan: true,
      watchers: 0,
      watchEpoch: 0,
      trusted: false,
      lastFullScanAt: 0,
      truncated: false,
    }
    refreshStates.set(key, state)
  }
  return state
}

function takeRefreshMode(state: VaultRefreshState, clear: boolean, forceFull: boolean): RefreshMode {
  const dirtyOnly = !clear && !forceFull && state.trusted && !state.fullScan
    && Date.now() - state.lastFullScanAt < WATCH_BACKSTOP_MS
  const mode: RefreshMode = { clear, dirty: dirtyOnly ? [...state.dirty] : null, epoch: state.watchEpoch, truncated: state.truncated }
  state.dirty = new Set()
  state.fullScan = false
  state.markedDuringFlight = false
  return mode
}

function settleRefresh(state: VaultRefreshState, mode: RefreshMode, outcome: RefreshOutcome | null): void {
  if (!outcome) {
    state.fullScan = true
    state.trusted = false
    return
  }
  if (!outcome.fullScan) return
  state.lastFullScanAt = Date.now()
  state.truncated = outcome.counts.truncated
  state.trusted = state.watchers > 0 && state.watchEpoch === mode.epoch
}

function emptyRebuildResult(notesRoot: string): VaultRebuildResult {
  return {
    ok: false,
    dbPath: vaultIndexPath(notesRoot),
    indexed: 0,
    unchanged: 0,
    skipped: 0,
    truncated: false,
    recovered: false,
    available: isVaultIndexAvailable(),
  }
}

function openForRefresh(notesRoot: string): { db: Database; recovered: boolean } | null {
  const dbPath = vaultIndexPath(notesRoot)
  const cached = handles.has(resolve(notesRoot))
  const missingOrCorrupt = !existsSync(dbPath) || (!cached && !isSqliteDatabaseFile(dbPath))
  let opened = missingOrCorrupt ? null : openDb(notesRoot, false)
  let recovered = missingOrCorrupt
  if (!opened) {
    closeHandle(notesRoot)
    unlinkIndexFiles(dbPath)
    opened = openDb(notesRoot, true)
    recovered = true
  }
  return opened ? { db: opened.db, recovered: recovered || opened.recovered } : null
}

function openForRebuild(notesRoot: string): { db: Database; recovered: boolean } | null {
  closeHandle(notesRoot)
  unlinkIndexFiles(vaultIndexPath(notesRoot))
  return openDb(notesRoot, true)
}

export function rebuildVaultIndex(notesRoot: string): VaultRebuildResult {
  const empty = emptyRebuildResult(notesRoot)
  const opened = openForRebuild(notesRoot)
  if (!opened) return empty
  const state = refreshStateFor(notesRoot)
  const mode = takeRefreshMode(state, true, true)
  try {
    const outcome = runSync(refreshSteps(opened.db, notesRoot, mode))
    settleRefresh(state, mode, outcome)
    return rememberRebuild(notesRoot, { ok: true, dbPath: empty.dbPath, recovered: true, available: true, ...outcome.counts })
  } catch {
    settleRefresh(state, mode, null)
    return rememberRebuild(notesRoot, { ...empty, recovered: opened.recovered, available: true })
  }
}

export function ensureVaultIndex(notesRoot: string): VaultRebuildResult {
  const target = openForRefresh(notesRoot)
  if (!target) return emptyRebuildResult(notesRoot)
  const state = refreshStateFor(notesRoot)
  const mode = takeRefreshMode(state, false, true)
  try {
    const outcome = runSync(refreshSteps(target.db, notesRoot, mode))
    settleRefresh(state, mode, outcome)
    return rememberRebuild(notesRoot, { ok: true, dbPath: vaultIndexPath(notesRoot), recovered: target.recovered, available: true, ...outcome.counts })
  } catch {
    settleRefresh(state, mode, null)
    closeHandle(notesRoot)
    return rememberRebuild(notesRoot, { ...rebuildVaultIndex(notesRoot), recovered: true })
  }
}

async function rebuildAsync(notesRoot: string, state: VaultRefreshState): Promise<VaultRebuildResult> {
  const empty = emptyRebuildResult(notesRoot)
  const opened = openForRebuild(notesRoot)
  if (!opened) return empty
  const mode = takeRefreshMode(state, true, true)
  try {
    const outcome = await runAsync(refreshSteps(opened.db, notesRoot, mode))
    settleRefresh(state, mode, outcome)
    return rememberRebuild(notesRoot, { ok: true, dbPath: empty.dbPath, recovered: true, available: true, ...outcome.counts })
  } catch {
    settleRefresh(state, mode, null)
    return rememberRebuild(notesRoot, { ...empty, recovered: opened.recovered, available: true })
  }
}

async function refreshAsync(notesRoot: string, state: VaultRefreshState): Promise<VaultRebuildResult> {
  const target = openForRefresh(notesRoot)
  if (!target) return emptyRebuildResult(notesRoot)
  const mode = takeRefreshMode(state, false, target.recovered)
  try {
    const outcome = await runAsync(refreshSteps(target.db, notesRoot, mode))
    settleRefresh(state, mode, outcome)
    return rememberRebuild(notesRoot, { ok: true, dbPath: vaultIndexPath(notesRoot), recovered: target.recovered, available: true, ...outcome.counts })
  } catch {
    settleRefresh(state, mode, null)
    closeHandle(notesRoot)
    return rememberRebuild(notesRoot, { ...await rebuildAsync(notesRoot, state), recovered: true })
  }
}

const ignoreOutcome = (): void => undefined

function startFlight(state: VaultRefreshState, run: () => Promise<VaultRebuildResult>): Promise<VaultRebuildResult> {
  const flight: Promise<VaultRebuildResult> = run().finally(() => {
    if (state.inFlight === flight) state.inFlight = null
  })
  state.inFlight = flight
  return flight
}

/**
 * Async, coalesced refresh: concurrent callers share one in-flight pass; a caller that
 * arrives after new dirty marks gets one shared follow-up pass.
 */
export function ensureVaultIndexAsync(notesRoot: string): Promise<VaultRebuildResult> {
  const state = refreshStateFor(notesRoot)
  if (!state.inFlight) return startFlight(state, () => refreshAsync(notesRoot, state))
  if (!state.markedDuringFlight) return state.inFlight
  state.followUp ??= state.inFlight.then(ignoreOutcome, ignoreOutcome).then(() => {
    state.followUp = null
    return ensureVaultIndexAsync(notesRoot)
  })
  return state.followUp
}

export async function rebuildVaultIndexAsync(notesRoot: string): Promise<VaultRebuildResult> {
  const state = refreshStateFor(notesRoot)
  while (state.inFlight) await state.inFlight.then(ignoreOutcome, ignoreOutcome)
  return startFlight(state, () => rebuildAsync(notesRoot, state))
}

/** Record vault-relative paths reported by a watcher; the next refresh re-checks them. */
export function markVaultPathsDirty(notesRoot: string, filenames: ReadonlyArray<string | Buffer | null | undefined>): void {
  const state = refreshStateFor(notesRoot)
  for (const filename of filenames) {
    const rel = filename ? toSlashPath(filename.toString()) : ''
    if (!rel) {
      state.fullScan = true
      continue
    }
    const top = rel.split('/')[0] ?? ''
    if (SKIP_DIRS.has(top) || rel.startsWith('.') || rel.includes('/.') || isImportProvenancedRelativePath(rel)) continue
    if (rel.toLowerCase().endsWith('.md')) state.dirty.add(rel)
    else state.fullScan = true
  }
  if (state.inFlight) state.markedDuringFlight = true
}

/**
 * Register a live recursive watcher on the vault. Once a full diff has completed with a
 * watcher attached, refreshes check only paths given to `markVaultPathsDirty`.
 * Call the returned function when the watcher closes or errors.
 */
export function attachVaultWatcher(notesRoot: string): () => void {
  const state = refreshStateFor(notesRoot)
  state.watchers++
  state.watchEpoch++
  state.trusted = false
  let attached = true
  return () => {
    if (!attached) return
    attached = false
    state.watchers--
    state.watchEpoch++
    state.trusted = false
    state.fullScan = true
  }
}

function documentIdsMatching(db: Database, fts: boolean, query: string): Set<string> | null {
  const q = query.trim()
  if (!q) return null
  const ids = new Set<string>()
  const like = `%${q.replaceAll('%', '').replaceAll('_', '')}%`
  const rows = db
    .query<{ id: string }, [string, string, string]>(
      `SELECT id FROM documents
       WHERE title LIKE ? COLLATE NOCASE
          OR body_text LIKE ? COLLATE NOCASE
          OR relative_path LIKE ? COLLATE NOCASE`,
    )
    .all(like, like, like)
  for (const row of rows) ids.add(row.id)

  const tagRows = db.query<{ document_id: string }, [string]>('SELECT document_id FROM tags WHERE tag LIKE ? COLLATE NOCASE').all(like)
  for (const row of tagRows) ids.add(row.document_id)
  const aliasRows = db.query<{ document_id: string }, [string]>('SELECT document_id FROM aliases WHERE alias LIKE ? COLLATE NOCASE').all(like)
  for (const row of aliasRows) ids.add(row.document_id)

  if (fts) {
    const terms = q.split(/[^\p{L}\p{N}_]+/u).filter(Boolean).slice(0, 12)
    const match = terms.map(term => `"${term.replaceAll('"', '')}"`).join(' OR ')
    if (match) {
      try {
        const ftsRows = db
          .query<{ id: string }, [string]>('SELECT id FROM documents_fts WHERE documents_fts MATCH ?')
          .all(match)
        for (const row of ftsRows) ids.add(row.id)
      } catch {
        /* LIKE already populated */
      }
    }
  }
  return ids
}

function loadSummaries(db: Database, ids?: Set<string>): VaultDocumentSummary[] {
  const rows = db
    .query<{
      id: string
      relative_path: string
      title: string
      hash: string
      size: number
      created_at: number
      updated_at: number
      properties_json: string
      asset_refs_json: string
    }, []>(
      `SELECT id, relative_path, title, hash, size, created_at, updated_at, properties_json, asset_refs_json
       FROM documents
       ORDER BY updated_at DESC, title COLLATE NOCASE ASC`,
    )
    .all()

  const tagRows = db.query<{ document_id: string; tag: string }, []>('SELECT document_id, tag FROM tags').all()
  const aliasRows = db.query<{ document_id: string; alias: string }, []>('SELECT document_id, alias FROM aliases').all()
  const linkRows = db
    .query<{ source_id: string; target: string; alias: string | null; heading: string | null; line: number; preview: string }, []>(
      'SELECT source_id, target, alias, heading, line, preview FROM wikilinks',
    )
    .all()

  const tags = new Map<string, string[]>()
  for (const row of tagRows) {
    const list = tags.get(row.document_id) ?? []
    list.push(row.tag)
    tags.set(row.document_id, list)
  }
  const aliases = new Map<string, string[]>()
  for (const row of aliasRows) {
    const list = aliases.get(row.document_id) ?? []
    list.push(row.alias)
    aliases.set(row.document_id, list)
  }
  const links = new Map<string, VaultWikiLink[]>()
  for (const row of linkRows) {
    const list = links.get(row.source_id) ?? []
    list.push({
      target: row.target,
      ...(row.alias ? { alias: row.alias } : {}),
      ...(row.heading ? { heading: row.heading } : {}),
      line: row.line,
      preview: row.preview,
    })
    links.set(row.source_id, list)
  }

  const out: VaultDocumentSummary[] = []
  for (const row of rows) {
    if (ids && !ids.has(row.id)) continue
    out.push({
      id: row.id,
      title: row.title,
      relativePath: row.relative_path,
      tags: (tags.get(row.id) ?? []).sort((a, b) => a.localeCompare(b)),
      aliases: (aliases.get(row.id) ?? []).sort((a, b) => a.localeCompare(b)),
      properties: parseProperties(row.properties_json),
      links: links.get(row.id) ?? [],
      assetRefs: parseStringList(row.asset_refs_json),
      updatedAt: row.updated_at,
      createdAt: row.created_at,
      size: row.size,
      hash: row.hash,
    })
  }
  return out
}

export function listVaultDocuments(notesRoot: string): VaultDocumentSummary[] {
  const opened = openDb(notesRoot, false)
  if (!opened) return []
  return loadSummaries(opened.db)
}

export function queryVaultDocuments(notesRoot: string, query: string): VaultDocumentSummary[] {
  const opened = openDb(notesRoot, false)
  if (!opened) return []
  const ids = documentIdsMatching(opened.db, opened.fts, query)
  return loadSummaries(opened.db, ids ?? undefined)
}

export function getVaultBacklinks(notesRoot: string, noteId: string): VaultBacklink[] {
  const opened = openDb(notesRoot, false)
  if (!opened) return []
  const target = opened.db
    .query<{ id: string; title: string }, [string]>('SELECT id, title FROM documents WHERE id = ?')
    .get(noteId)
  if (!target) return []
  const needles = [target.id, target.title, target.id.split('/').pop() ?? target.id]
    .map(value => stripMdExtension(value).toLowerCase())
  const rows = opened.db
    .query<{ source_id: string; title: string; relative_path: string; target: string; line: number; preview: string }, []>(
      `SELECT w.source_id, d.title, d.relative_path, w.target, w.line, w.preview
       FROM wikilinks w
       JOIN documents d ON d.id = w.source_id`,
    )
    .all()
  const out: VaultBacklink[] = []
  for (const row of rows) {
    if (row.source_id === target.id) continue
    if (!needles.includes(stripMdExtension(row.target).toLowerCase())) continue
    out.push({
      noteId: row.source_id,
      title: row.title,
      relativePath: row.relative_path,
      line: row.line,
      preview: row.preview,
    })
  }
  return out
}

export function listVaultTasks(notesRoot: string): VaultTaskHit[] {
  const opened = openDb(notesRoot, false)
  if (!opened) return []
  return opened.db
    .query<{ document_id: string; title: string; line: number; checked: number; text: string }, []>(
      `SELECT t.document_id, d.title, t.line, t.checked, t.text
       FROM tasks t
       JOIN documents d ON d.id = t.document_id
       ORDER BY d.title COLLATE NOCASE, t.line`,
    )
    .all()
    .map(row => ({
      documentId: row.document_id,
      title: row.title,
      line: row.line,
      checked: row.checked === 1,
      text: row.text,
    }))
}

export function vaultIndexHealth(notesRoot: string): VaultHealth {
  const dbPath = vaultIndexPath(notesRoot)
  const last = lastRebuildByRoot.get(resolve(notesRoot))
  const unavailable: VaultHealth = {
    ok: false,
    available: isVaultIndexAvailable(),
    dbPath,
    schemaVersion: null,
    documentCount: 0,
    recovered: last?.recovered ?? false,
    indexed: last?.indexed ?? 0,
    unchanged: last?.unchanged ?? 0,
    skipped: last?.skipped ?? 0,
    truncated: last?.truncated ?? false,
  }
  const opened = openDb(notesRoot, false)
  if (!opened) return unavailable
  const count = opened.db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM documents').get()?.n ?? 0
  return {
    ok: true,
    available: true,
    dbPath,
    schemaVersion: schemaVersionOf(opened.db),
    documentCount: count,
    recovered: last?.recovered ?? opened.recovered,
    indexed: last?.indexed ?? 0,
    unchanged: last?.unchanged ?? 0,
    skipped: last?.skipped ?? 0,
    truncated: last?.truncated ?? false,
  }
}

export function getVaultInsights(notesRoot: string, noteId: string): VaultInsights {
  const empty: VaultInsights = {
    entities: [],
    linkSuggestions: [],
    unlinkedMentions: [],
    brokenLinks: [],
    suggestedMerges: [],
    footnotes: [],
  }
  const opened = openDb(notesRoot, false)
  if (!opened) return empty
  const doc = opened.db
    .query<{ id: string; relative_path: string; properties_json: string }, [string]>(
      'SELECT id, relative_path, properties_json FROM documents WHERE id = ?',
    )
    .get(noteId)
  if (!doc) return empty
  let content = ''
  try {
    content = readFileSync(join(resolve(notesRoot), doc.relative_path), 'utf8')
  } catch {
    return empty
  }
  const linkRows = opened.db
    .query<{ target: string; alias: string | null; line: number }, [string]>(
      'SELECT target, alias, line FROM wikilinks WHERE source_id = ?',
    )
    .all(noteId)
  return buildVaultInsights({
    documentId: noteId,
    content,
    links: linkRows.map((row) => ({
      target: row.target,
      ...(row.alias ? { alias: row.alias } : {}),
      line: row.line,
    })),
    catalog: loadCatalog(opened.db),
    properties: parseProperties(doc.properties_json),
  })
}

export function hashVaultMarkdownFiles(notesRoot: string): Record<string, string> {
  const out: Record<string, string> = {}
  const { files } = walkMarkdownFiles(notesRoot)
  for (const abs of files) {
    const rel = toSlashPath(relative(resolve(notesRoot), abs))
    try {
      out[rel] = hashText(readFileSync(abs, 'utf8'))
    } catch {
      /* skip unreadable */
    }
  }
  return out
}

/** Batch fs.watch bursts before an incremental index refresh. */
export const VAULT_WATCH_DEBOUNCE_MS = 120

/**
 * Map a notes-root-relative watch filename to a document id.
 * Index internals (`.craft/`), assets, templates, and non-markdown paths are ignored.
 */
export function vaultWatchNoteIdFromFilename(filename: string | Buffer | null | undefined): string | undefined {
  if (!filename) return undefined
  const rel = toSlashPath(filename.toString())
  if (!rel) return undefined
  const top = rel.split('/')[0] ?? ''
  if (SKIP_DIRS.has(top) || rel.startsWith('.') || rel.includes('/.')) return undefined
  if (!rel.toLowerCase().endsWith('.md')) return undefined
  return noteIdFromRelativePath(rel)
}

export interface VaultWatchTickResult {
  noteIds: string[]
  rebuilt: VaultRebuildResult | null
}

/**
 * Incremental index refresh for coalesced external vault writes.
 * Canonical Markdown is never rewritten.
 */
export function applyVaultWatchTick(
  notesRoot: string,
  filenames: Array<string | Buffer | null | undefined>,
): VaultWatchTickResult {
  const noteIds = watchedNoteIds(filenames)
  markVaultPathsDirty(notesRoot, filenames)
  if (noteIds.length === 0) return { noteIds, rebuilt: null }
  return { noteIds, rebuilt: ensureVaultIndex(notesRoot) }
}

/** Async counterpart of `applyVaultWatchTick` that joins the coalesced refresh. */
export async function applyVaultWatchTickAsync(
  notesRoot: string,
  filenames: Array<string | Buffer | null | undefined>,
): Promise<VaultWatchTickResult> {
  const noteIds = watchedNoteIds(filenames)
  markVaultPathsDirty(notesRoot, filenames)
  if (noteIds.length === 0) return { noteIds, rebuilt: null }
  return { noteIds, rebuilt: await ensureVaultIndexAsync(notesRoot) }
}

function watchedNoteIds(filenames: Array<string | Buffer | null | undefined>): string[] {
  return [...new Set(
    filenames
      .map(vaultWatchNoteIdFromFilename)
      .filter((id): id is string => Boolean(id)),
  )]
}
