/**
 * Session state projection: the derived SQLite index + `sessions-index.json`
 * fast path over the canonical JSONL session files.
 *
 * JSONL stays the source of truth. Everything written here is rebuildable:
 * `rebuildWorkspace` rescans the session directory and replaces both the
 * `session_index` rows and the index file. The `session_index.header` column
 * holds each session's full first-line header JSON, so boot can hydrate session
 * metadata without touching a single JSONL file; `sessions-index.json` keeps the
 * lighter list-entry subset. The index file carries a freshness cookie
 * (entry count + max header mtime); when it no longer matches the directory,
 * readers rebuild instead of trusting the cache.
 */
import { copyFileSync, existsSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getSessionFilePath, readSessionHeader, type SessionHeader } from '@rox/shared/sessions'
import { getWorkspaceSessionsPath } from '@rox/shared/workspaces'
import { resolveConfigDir } from '@rox/shared/config/paths'
import { openStateStore, sessionIndexKey, upsertSessionIndexRow, type StateStore } from './state-store.ts'
import type { DatabaseSync } from '@rox/shared/utils/sqlite-runtime'

export interface SessionIndexEntry {
  id: string
  workspaceRootPath: string
  createdAt: number
  lastUsedAt: number
  lastMessageAt?: number
  name?: string
  isFlagged?: boolean
  sessionStatus?: string
  labels?: string[]
  hasUnread?: boolean
  lastReadMessageId?: string
  /** mtime of the session.jsonl the entry was read from — the freshness signal. */
  headerMtimeMs: number
}

export interface SessionIndexFile {
  version: 1
  generatedAt: number
  count: number
  maxHeaderMtimeMs: number
  entries: SessionIndexEntry[]
}

export const SESSION_INDEX_FILENAME = 'sessions-index.json'

export function sessionIndexFilePath(workspaceRootPath: string): string {
  return join(getWorkspaceSessionsPath(workspaceRootPath), SESSION_INDEX_FILENAME)
}

function entryFromHeader(header: SessionHeader, headerMtimeMs: number): SessionIndexEntry {
  const entry: SessionIndexEntry = {
    id: header.id,
    workspaceRootPath: header.workspaceRootPath,
    createdAt: header.createdAt,
    lastUsedAt: header.lastUsedAt,
    headerMtimeMs,
  }
  if (header.lastMessageAt !== undefined) entry.lastMessageAt = header.lastMessageAt
  if (header.name !== undefined) entry.name = header.name
  if (header.isFlagged !== undefined) entry.isFlagged = header.isFlagged
  if (header.sessionStatus !== undefined) entry.sessionStatus = header.sessionStatus
  if (header.labels !== undefined) entry.labels = header.labels
  if (header.hasUnread !== undefined) entry.hasUnread = header.hasUnread
  if (header.lastReadMessageId !== undefined) entry.lastReadMessageId = header.lastReadMessageId
  return entry
}

function sortEntries(entries: SessionIndexEntry[]): SessionIndexEntry[] {
  return entries.sort((a, b) => (b.lastUsedAt - a.lastUsedAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** One session's index entry plus the raw first-line header JSON it came from. */
interface ScannedSessionEntry {
  entry: SessionIndexEntry
  /** The full `session.jsonl` first line, persisted into `session_index.header`. */
  headerJson: string
}

/** Read one session's entry + header JSON straight from its JSONL header, or null. */
function readSessionEntry(workspaceRootPath: string, sessionId: string): ScannedSessionEntry | null {
  const file = getSessionFilePath(workspaceRootPath, sessionId)
  if (!existsSync(file)) return null
  const header = readSessionHeader(file)
  if (!header) return null
  try {
    return { entry: entryFromHeader(header, statSync(file).mtimeMs), headerJson: JSON.stringify(header) }
  } catch {
    return null
  }
}

/** Read one session's index entry straight from its JSONL header, or null. */
export function entryForSession(workspaceRootPath: string, sessionId: string): SessionIndexEntry | null {
  return readSessionEntry(workspaceRootPath, sessionId)?.entry ?? null
}

/** Scan every session directory's header (entry + header JSON), newest first. */
function scanWorkspaceSessions(workspaceRootPath: string): ScannedSessionEntry[] {
  const sessionsDir = getWorkspaceSessionsPath(workspaceRootPath)
  if (!existsSync(sessionsDir)) return []
  const sessions: ScannedSessionEntry[] = []
  for (const dirent of readdirSync(sessionsDir, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue
    const scanned = readSessionEntry(workspaceRootPath, dirent.name)
    if (scanned) sessions.push(scanned)
  }
  sessions.sort((a, b) => (b.entry.lastUsedAt - a.entry.lastUsedAt) || (a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0))
  return sessions
}

/** Scan every session directory's header, newest first — the source-of-truth scan. */
export function scanWorkspaceEntries(workspaceRootPath: string): SessionIndexEntry[] {
  return scanWorkspaceSessions(workspaceRootPath).map((scanned) => scanned.entry)
}

export interface SessionIndexDrift {
  indexCount: number
  scannedCount: number
  /** Whether the index file's count + max-header-mtime cookie still matches the directory. */
  cookieMatches: boolean
  /** Session ids on disk that the index does not list. */
  missingFromIndex: string[]
  /** Session ids the index lists that are no longer on disk. */
  staleInIndex: string[]
}

/**
 * Read-only drift guard: compare the index file against a fresh directory scan.
 * Never writes and never rebuilds — reports counts for a state-check/doctor caller.
 */
export function checkSessionIndexDrift(workspaceRootPath: string): SessionIndexDrift {
  const cached = parseIndexFile(sessionIndexFilePath(workspaceRootPath))
  const indexed = cached?.entries ?? []
  const scanned = scanWorkspaceEntries(workspaceRootPath)
  const indexedIds = new Set(indexed.map((entry) => entry.id))
  const scannedIds = new Set(scanned.map((entry) => entry.id))
  const live = liveCookie(workspaceRootPath)
  return {
    indexCount: indexed.length,
    scannedCount: scanned.length,
    cookieMatches: cached !== null && cached.count === live.count && cached.maxHeaderMtimeMs === live.maxHeaderMtimeMs,
    missingFromIndex: scanned.filter((entry) => !indexedIds.has(entry.id)).map((entry) => entry.id),
    staleInIndex: indexed.filter((entry) => !scannedIds.has(entry.id)).map((entry) => entry.id),
  }
}

/** Cheap cookie over the directory (list + stat only, no header parse). */
export function liveCookie(workspaceRootPath: string): { count: number; maxHeaderMtimeMs: number } {
  const sessionsDir = getWorkspaceSessionsPath(workspaceRootPath)
  if (!existsSync(sessionsDir)) return { count: 0, maxHeaderMtimeMs: 0 }
  let count = 0
  let maxHeaderMtimeMs = 0
  for (const dirent of readdirSync(sessionsDir, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue
    const file = getSessionFilePath(workspaceRootPath, dirent.name)
    try {
      const mtimeMs = statSync(file).mtimeMs
      count += 1
      if (mtimeMs > maxHeaderMtimeMs) maxHeaderMtimeMs = mtimeMs
    } catch { /* no session.jsonl — not a session */ }
  }
  return { count, maxHeaderMtimeMs }
}

function isSessionIndexEntry(value: unknown): value is SessionIndexEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return typeof entry.id === 'string'
    && typeof entry.workspaceRootPath === 'string'
    && typeof entry.createdAt === 'number'
    && typeof entry.lastUsedAt === 'number'
    && typeof entry.headerMtimeMs === 'number'
}

function parseIndexFile(path: string): SessionIndexFile | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
    if (parsed.version !== 1) return null
    if (typeof parsed.count !== 'number' || typeof parsed.maxHeaderMtimeMs !== 'number') return null
    if (!Array.isArray(parsed.entries)) return null
    if (!parsed.entries.every(isSessionIndexEntry)) return null
    return {
      version: 1,
      generatedAt: typeof parsed.generatedAt === 'number' ? parsed.generatedAt : 0,
      count: parsed.count,
      maxHeaderMtimeMs: parsed.maxHeaderMtimeMs,
      entries: parsed.entries,
    }
  } catch {
    return null
  }
}

function writeIndexFile(path: string, entries: SessionIndexEntry[], now: number): void {
  let maxHeaderMtimeMs = 0
  for (const entry of entries) if (entry.headerMtimeMs > maxHeaderMtimeMs) maxHeaderMtimeMs = entry.headerMtimeMs
  const file: SessionIndexFile = {
    version: 1,
    generatedAt: now,
    count: entries.length,
    maxHeaderMtimeMs,
    entries,
  }
  const tmp = `${path}.${process.pid}.${now}.tmp`
  writeFileSync(tmp, JSON.stringify(file), { encoding: 'utf-8', mode: 0o600 })
  try {
    renameSync(tmp, path)
  } catch (error) {
    // Windows cannot rename over an existing file; mirror the atomic-replace idiom.
    if (process.platform !== 'win32') throw error
    copyFileSync(tmp, path)
    try { unlinkSync(tmp) } catch { /* dest already holds the new bytes */ }
  }
}

/** Replace the workspace's rows, storing each session's full first-line header. */
function reconcileRows(db: DatabaseSync, workspaceRootPath: string, sessions: readonly ScannedSessionEntry[], now: number): void {
  db.prepare('DELETE FROM session_index WHERE workspace_root = ?').run(workspaceRootPath)
  const insert = db.prepare('INSERT INTO session_index (workspace_root, session_id, header, updated_at) VALUES (?, ?, ?, ?)')
  for (const session of sessions) insert.run(workspaceRootPath, session.entry.id, session.headerJson, now)
}

/**
 * A stored `session_index.header` row is usable only when it is a full
 * SessionHeader (messageCount + tokenUsage are required); pre-upgrade rows held
 * the list-entry subset and are rejected so the boot path rescans and repairs.
 */
function parseHeaderRow(raw: string): SessionHeader | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null) return null
    const header = parsed as Record<string, unknown>
    const valid = typeof header.id === 'string'
      && typeof header.workspaceRootPath === 'string'
      && typeof header.createdAt === 'number'
      && typeof header.lastUsedAt === 'number'
      && typeof header.messageCount === 'number'
      && typeof header.tokenUsage === 'object' && header.tokenUsage !== null
    return valid ? (parsed as SessionHeader) : null
  } catch {
    return null
  }
}

export interface SessionStateProjectorOptions {
  store: StateStore
  now?: () => number
}

export class SessionStateProjector {
  readonly #store: StateStore
  readonly #now: () => number

  constructor(options: SessionStateProjectorOptions) {
    this.#store = options.store
    this.#now = options.now ?? Date.now
  }

  /** Workspace-scoped serialization key: every write to one index file. */
  #indexKey(workspaceRootPath: string): string {
    return `sessions_index:${workspaceRootPath}`
  }

  /**
   * Load the workspace entries for a write. Uses the index file when its cookie
   * still matches the directory; otherwise rescans and reconciles both stores.
   */
  #loadEntries(db: DatabaseSync, workspaceRootPath: string): SessionIndexEntry[] {
    const path = sessionIndexFilePath(workspaceRootPath)
    const cached = parseIndexFile(path)
    if (cached) {
      const live = liveCookie(workspaceRootPath)
      if (cached.count === live.count && cached.maxHeaderMtimeMs === live.maxHeaderMtimeMs) return cached.entries
    }
    const scanned = scanWorkspaceSessions(workspaceRootPath)
    reconcileRows(db, workspaceRootPath, scanned, this.#now())
    writeIndexFile(path, scanned.map((session) => session.entry), this.#now())
    return scanned.map((session) => session.entry)
  }

  /** Project a single session after a successful JSONL flush. */
  recordSession(workspaceRootPath: string, sessionId: string): Promise<SessionIndexEntry | null> {
    return this.#store.run({
      keys: [this.#indexKey(workspaceRootPath), sessionIndexKey(workspaceRootPath, sessionId)],
      fn: (db) => {
        const session = readSessionEntry(workspaceRootPath, sessionId)
        const next = this.#loadEntries(db, workspaceRootPath).filter((candidate) => candidate.id !== sessionId)
        if (session) {
          next.push(session.entry)
          upsertSessionIndexRow(db, workspaceRootPath, session.entry.id, session.headerJson, this.#now())
        } else {
          db.prepare('DELETE FROM session_index WHERE workspace_root = ? AND session_id = ?').run(workspaceRootPath, sessionId)
        }
        sortEntries(next)
        writeIndexFile(sessionIndexFilePath(workspaceRootPath), next, this.#now())
        return session?.entry ?? null
      },
    })
  }

  /** Drop a session from both stores after its JSONL directory is gone. */
  removeSession(workspaceRootPath: string, sessionId: string): Promise<void> {
    return this.#store.run({
      keys: [this.#indexKey(workspaceRootPath), sessionIndexKey(workspaceRootPath, sessionId)],
      fn: (db) => {
        const entries = sortEntries(this.#loadEntries(db, workspaceRootPath).filter((candidate) => candidate.id !== sessionId))
        db.prepare('DELETE FROM session_index WHERE workspace_root = ? AND session_id = ?').run(workspaceRootPath, sessionId)
        writeIndexFile(sessionIndexFilePath(workspaceRootPath), entries, this.#now())
      },
    })
  }

  /** Full rebuild from the JSONL scan; exclusive over the store. */
  rebuildWorkspace(workspaceRootPath: string): Promise<SessionIndexEntry[]> {
    return this.#store.run({
      keys: undefined,
      fn: (db) => {
        const scanned = scanWorkspaceSessions(workspaceRootPath)
        const entries = scanned.map((session) => session.entry)
        reconcileRows(db, workspaceRootPath, scanned, this.#now())
        writeIndexFile(sessionIndexFilePath(workspaceRootPath), entries, this.#now())
        return entries
      },
    })
  }

  /**
   * Boot fast path: full session headers served from `session_index.header`.
   *
   * Returns null — never scanning — unless the index file's freshness cookie
   * still matches the directory AND the DB rows cover every indexed entry, so
   * the caller can fall back to `listSessions` plus a queued rebuild.
   */
  readFreshHeaders(workspaceRootPath: string): SessionHeader[] | null {
    const cached = parseIndexFile(sessionIndexFilePath(workspaceRootPath))
    if (!cached) return null
    const live = liveCookie(workspaceRootPath)
    if (cached.count !== live.count || cached.maxHeaderMtimeMs !== live.maxHeaderMtimeMs) return null
    const rows = this.#store.listSessionIndex(workspaceRootPath)
    if (rows.length !== cached.entries.length) return null
    const headerById = new Map(rows.map((row) => [row.sessionId, row.header]))
    const headers: SessionHeader[] = []
    for (const entry of cached.entries) {
      const raw = headerById.get(entry.id)
      if (raw === undefined) return null
      const header = parseHeaderRow(raw)
      if (header === null) return null
      headers.push(header)
    }
    return headers
  }

  /** Read the index, rebuilding when the cache is missing or stale. */
  readIndex(workspaceRootPath: string): SessionIndexEntry[] {
    const path = sessionIndexFilePath(workspaceRootPath)
    const cached = parseIndexFile(path)
    if (cached) {
      const live = liveCookie(workspaceRootPath)
      if (cached.count === live.count && cached.maxHeaderMtimeMs === live.maxHeaderMtimeMs) return cached.entries
    }
    // Stale/missing: rebuild synchronously via the scan so the returned value is
    // current even before the queued rebuild lands.
    const entries = scanWorkspaceEntries(workspaceRootPath)
    void this.rebuildWorkspace(workspaceRootPath)
    return entries
  }
}

let defaultProjector: SessionStateProjector | null = null

/** Process-wide projector bound to the config dir's state store. */
export function sessionStateProjector(): SessionStateProjector {
  if (!defaultProjector) {
    defaultProjector = new SessionStateProjector({ store: openStateStore({ configDir: resolveConfigDir() }) })
  }
  return defaultProjector
}

export function createSessionStateProjector(options: SessionStateProjectorOptions): SessionStateProjector {
  return new SessionStateProjector(options)
}

/** Test hook: forget the process-wide projector (the store stays open). */
export function resetSessionStateProjector(): void {
  defaultProjector = null
}