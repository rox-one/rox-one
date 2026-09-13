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
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import type { Database } from 'bun:sqlite'
import { isImportProvenancedRelativePath } from '@craft-agent/shared/config'
import {
  buildVaultInsights,
  extractNamedEntities,
  type VaultCatalogEntry,
  type VaultInsights,
} from '@craft-agent/shared/knowledge/vault-insights'
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
  try {
    const header = readFileSync(dbPath).subarray(0, 16).toString('utf8')
    return header.startsWith('SQLite format 3')
  } catch {
    return false
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

function walkMarkdownFiles(notesRoot: string): { files: string[]; truncated: boolean; skipped: number } {
  const root = resolve(notesRoot)
  const files: string[] = []
  let truncated = false
  let skipped = 0
  if (!existsSync(root)) return { files, truncated, skipped }

  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop()!
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      skipped++
      continue
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const abs = join(dir, entry.name)
      const rel = toSlashPath(relative(root, abs))
      if (isImportProvenancedRelativePath(rel)) continue
      if (entry.isDirectory()) {
        const top = rel.split('/')[0] ?? rel
        if (SKIP_DIRS.has(top)) continue
        stack.push(abs)
        continue
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue
      if (files.length >= MAX_NOTES) {
        truncated = true
        return { files, truncated, skipped }
      }
      files.push(abs)
    }
  }
  return { files, truncated, skipped }
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

function reindexNamedEntities(db: Database, notesRoot: string): void {
  db.exec('DELETE FROM entity_mentions')
  db.exec('DELETE FROM entities')
  const catalog = loadCatalog(db)
  const rows = db
    .query<{ id: string; relative_path: string; properties_json: string }, []>(
      'SELECT id, relative_path, properties_json FROM documents',
    )
    .all()
  const insertEntity = db.query('INSERT OR REPLACE INTO entities(id, name, kind) VALUES (?, ?, ?)')
  const insertMention = db.query(
    'INSERT INTO entity_mentions(entity_id, document_id, line, evidence) VALUES (?, ?, ?, ?)',
  )
  const root = resolve(notesRoot)
  for (const row of rows) {
    let content = ''
    try {
      content = readFileSync(join(root, row.relative_path), 'utf8')
    } catch {
      continue
    }
    const entities = extractNamedEntities(row.id, content, catalog, parseProperties(row.properties_json))
    for (const entity of entities) {
      insertEntity.run(entity.id, entity.name, entity.kind)
      insertMention.run(entity.id, entity.documentId, entity.line, entity.evidence)
    }
  }
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

function upsertDocument(
  db: Database,
  notesRoot: string,
  absPath: string,
): 'indexed' | 'unchanged' | 'skipped' {
  let st
  try {
    st = statSync(absPath)
  } catch {
    return 'skipped'
  }
  if (st.size > MAX_NOTE_BYTES) return 'skipped'

  const relativePath = toSlashPath(relative(resolve(notesRoot), absPath))
  const id = noteIdFromRelativePath(relativePath)
  const existing = db
    .query<{ hash: string; mtime: number; size: number }, [string]>('SELECT hash, mtime, size FROM documents WHERE id = ?')
    .get(id)
  if (existing && existing.mtime === st.mtimeMs && existing.size === st.size) return 'unchanged'

  let content: string
  try {
    content = readFileSync(absPath, 'utf8')
  } catch {
    return 'skipped'
  }
  const hash = hashText(content)
  if (existing?.hash === hash && existing.size === st.size) return 'unchanged'

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

function rebuildInto(db: Database, notesRoot: string, clear: boolean): Omit<VaultRebuildResult, 'ok' | 'dbPath' | 'recovered' | 'available'> {
  const walk = walkMarkdownFiles(notesRoot)
  if (clear) {
    db.exec('DELETE FROM documents')
    db.exec('DELETE FROM entities')
  }
  const seen = new Set<string>()
  let indexed = 0
  let unchanged = 0
  let skipped = walk.skipped
  const tx = db.transaction(() => {
    for (const abs of walk.files) {
      const id = noteIdFromRelativePath(toSlashPath(relative(resolve(notesRoot), abs)))
      seen.add(id)
      const result = upsertDocument(db, notesRoot, abs)
      if (result === 'indexed') indexed++
      else if (result === 'unchanged') unchanged++
      else skipped++
    }
    const rows = db.query<{ id: string }, []>('SELECT id FROM documents').all()
    for (const row of rows) {
      if (seen.has(row.id)) continue
      db.query('DELETE FROM documents WHERE id = ?').run(row.id)
    }
    reindexNamedEntities(db, notesRoot)
  })
  tx()
  return { indexed, unchanged, skipped, truncated: walk.truncated }
}

export function rebuildVaultIndex(notesRoot: string): VaultRebuildResult {
  const dbPath = vaultIndexPath(notesRoot)
  const empty: VaultRebuildResult = {
    ok: false,
    dbPath,
    indexed: 0,
    unchanged: 0,
    skipped: 0,
    truncated: false,
    recovered: false,
    available: isVaultIndexAvailable(),
  }
  closeHandle(notesRoot)
  unlinkIndexFiles(dbPath)
  const opened = openDb(notesRoot, true)
  if (!opened) return empty
  try {
    const stats = rebuildInto(opened.db, notesRoot, true)
    return rememberRebuild(notesRoot, { ok: true, dbPath, recovered: true, available: true, ...stats })
  } catch {
    return rememberRebuild(notesRoot, { ...empty, recovered: opened.recovered, available: true })
  }
}

export function ensureVaultIndex(notesRoot: string): VaultRebuildResult {
  const dbPath = vaultIndexPath(notesRoot)
  const empty: VaultRebuildResult = {
    ok: false,
    dbPath,
    indexed: 0,
    unchanged: 0,
    skipped: 0,
    truncated: false,
    recovered: false,
    available: isVaultIndexAvailable(),
  }
  const missingOrCorrupt = !existsSync(dbPath) || !isSqliteDatabaseFile(dbPath)
  let opened = missingOrCorrupt ? null : openDb(notesRoot, false)
  let recovered = missingOrCorrupt
  if (!opened) {
    closeHandle(notesRoot)
    unlinkIndexFiles(dbPath)
    opened = openDb(notesRoot, true)
    recovered = true
  }
  if (!opened) return empty
  try {
    const stats = rebuildInto(opened.db, notesRoot, false)
    return rememberRebuild(notesRoot, { ok: true, dbPath, recovered: recovered || opened.recovered, available: true, ...stats })
  } catch {
    closeHandle(notesRoot)
    const rebuilt = rebuildVaultIndex(notesRoot)
    return rememberRebuild(notesRoot, { ...rebuilt, recovered: true })
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
