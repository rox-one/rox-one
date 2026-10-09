/**
 * Session state projection: the derived SQLite index + `sessions-index.json`
 * fast path over the canonical JSONL session files.
 *
 * JSONL stays the source of truth. Everything written here is rebuildable:
 * `rebuildWorkspace` rescans the session directory and replaces both the
 * `session_index` rows and the index file. The index file carries a freshness
 * cookie
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

/** Read one session's index entry straight from its JSONL header, or null. */
export function entryForSession(workspaceRootPath: string, sessionId: string): SessionIndexEntry | null {
  const file = getSessionFilePath(workspaceRootPath, sessionId)
  if (!existsSync(file)) return null
  const header = readSessionHeader(file)
  if (!header) return null
  try {
    return entryFromHeader(header, statSync(file).mtimeMs)
  } catch {
    return null
  }
}

/** Scan every session directory's header, newest first — the source-of-truth scan. */
export function scanWorkspaceEntries(workspaceRootPath: string): SessionIndexEntry[] {
  const sessionsDir = getWorkspaceSessionsPath(workspaceRootPath)
  if (!existsSync(sessionsDir)) return []
  const entries: SessionIndexEntry[] = []
  for (const dirent of readdirSync(sessionsDir, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue
    const entry = entryForSession(workspaceRootPath, dirent.name)
    if (entry) entries.push(entry)
  }
  return sortEntries(entries)
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

function reconcileRows(db: DatabaseSync, workspaceRootPath: string, entries: SessionIndexEntry[], now: number): void {
  db.prepare('DELETE FROM session_index WHERE workspace_root = ?').run(workspaceRootPath)
  const insert = db.prepare('INSERT INTO session_index (workspace_root, session_id, header, updated_at) VALUES (?, ?, ?, ?)')
  for (const entry of entries) insert.run(workspaceRootPath, entry.id, JSON.stringify(entry), now)
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
    const entries = scanWorkspaceEntries(workspaceRootPath)
    reconcileRows(db, workspaceRootPath, entries, this.#now())
    writeIndexFile(path, entries, this.#now())
    return entries
  }

  /** Project a single session after a successful JSONL flush. */
  recordSession(workspaceRootPath: string, sessionId: string): Promise<SessionIndexEntry | null> {
    return this.#store.run({
      keys: [this.#indexKey(workspaceRootPath), sessionIndexKey(workspaceRootPath, sessionId)],
      fn: (db) => {
        const entry = entryForSession(workspaceRootPath, sessionId)
        const next = this.#loadEntries(db, workspaceRootPath).filter((candidate) => candidate.id !== sessionId)
        if (entry) {
          next.push(entry)
          upsertSessionIndexRow(db, workspaceRootPath, entry.id, JSON.stringify(entry), this.#now())
        } else {
          db.prepare('DELETE FROM session_index WHERE workspace_root = ? AND session_id = ?').run(workspaceRootPath, sessionId)
        }
        sortEntries(next)
        writeIndexFile(sessionIndexFilePath(workspaceRootPath), next, this.#now())
        return entry
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
        const entries = scanWorkspaceEntries(workspaceRootPath)
        reconcileRows(db, workspaceRootPath, entries, this.#now())
        writeIndexFile(sessionIndexFilePath(workspaceRootPath), entries, this.#now())
        return entries
      },
    })
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