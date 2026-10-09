/**
 * Unified state store: one SQLite database per config dir, single-writer.
 *
 * Lives at `<configDir>/state/rox-state.sqlite`. The JSONL session files remain
 * the source of truth; everything here is derived and rebuildable (see
 * sessions-projection.ts). WAL + `synchronous=FULL` + a 5s busy timeout give
 * crash-safe, process-safe writes; ordered migrations run one transaction each
 * under `PRAGMA user_version`.
 *
 * Every write funnels through a per-store write queue keyed by table/session,
 * so disjoint rows may write concurrently while same-row writes serialize.
 */
import { chmodSync, existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DatabaseSync } from '@rox/shared/utils/sqlite-runtime'
import { createWriteQueue, type WriteQueue } from './write-queue.ts'
import { isStateWriterLockHeld, type StateWriterLock } from './writer-lock.ts'

export interface StateMigration {
  version: number
  name: string
  up: (db: DatabaseSync) => void
}

/**
 * Ordered migrations. Never edit a shipped entry — append a new one.
 * `PRAGMA user_version` records the last applied version.
 */
export const MIGRATIONS: readonly StateMigration[] = [
  {
    version: 1,
    name: 'initial',
    up: (db) => {
      db.exec(`
        CREATE TABLE state_kv (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE session_index (
          workspace_root TEXT NOT NULL,
          session_id TEXT NOT NULL,
          header TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (workspace_root, session_id)
        );
        CREATE TABLE session_transcript (
          session_id TEXT NOT NULL,
          seq INTEGER NOT NULL,
          entry TEXT NOT NULL,
          PRIMARY KEY (session_id, seq)
        );
        CREATE INDEX idx_session_transcript_session_seq ON session_transcript (session_id, seq);
      `)
    },
  },
]

export const STATE_DATABASE_FILENAME = 'rox-state.sqlite'
export const STATE_LOCK_FILENAME = 'rox-state.lock'

export function stateDirectory(configDir: string): string {
  return join(configDir, 'state')
}

export function stateDatabasePath(configDir: string): string {
  return join(stateDirectory(configDir), STATE_DATABASE_FILENAME)
}

export function stateWriterLockPath(configDir: string): string {
  return join(stateDirectory(configDir), STATE_LOCK_FILENAME)
}

export const LATEST_STATE_USER_VERSION: number = MIGRATIONS.reduce(
  (max, migration) => (migration.version > max ? migration.version : max),
  0,
)

/** Apply every migration newer than the DB's `user_version`, one transaction each. */
export function applyMigrations(db: DatabaseSync, migrations: readonly StateMigration[] = MIGRATIONS): number {
  const row = db.prepare('PRAGMA user_version').get()
  let current = row && typeof row.user_version === 'number' ? row.user_version : 0
  for (const migration of migrations) {
    if (migration.version <= current) continue
    db.exec('BEGIN IMMEDIATE')
    try {
      migration.up(db)
      db.exec(`PRAGMA user_version = ${migration.version}`)
      db.exec('COMMIT')
    } catch (error) {
      try { db.exec('ROLLBACK') } catch { /* surface the original failure */ }
      throw error
    }
    current = migration.version
  }
  return current
}

export interface StateWrite<T> {
  keys?: readonly string[]
  signal?: AbortSignal
  reentrant?: boolean
  fn: (db: DatabaseSync) => T
}

/**
 * Writer-lock ownership passed to `openStateStore`. A live handle from
 * `acquireStateWriterLock` enables writes; `'allow-unlocked'` is an explicit
 * opt-out for read-only tools and tests.
 */
export type StateStoreLockOption = StateWriterLock | 'allow-unlocked'

/** Thrown by a write when the store cannot prove this process holds the writer lock. */
export class StateStoreWriteLockRequiredError extends Error {
  readonly code = 'STATE_LOCKED'
  constructor(detail: string) {
    super(
      `Refusing to write to the state store: ${detail}. ` +
      `Acquire the writer lock with acquireStateWriterLock(stateWriterLockPath(configDir)) and open the store ` +
      `with openStateStore({ configDir, lock }), or pass { lock: 'allow-unlocked' } to opt out explicitly ` +
      `(read-only tools and tests only).`,
    )
    this.name = 'StateStoreWriteLockRequiredError'
  }
}

/**
 * A write touching `<keys>`. Callers inside `run` share the same DB handle; the
 * queue serializes conflicting keys so no two writers touch the same row.
 */
export function sessionIndexKey(workspaceRootPath: string, sessionId: string): string {
  return `session_index:${workspaceRootPath}\u0000${sessionId}`
}

/** Upsert one `session_index` row. Shared by queued writes and in-transaction rebuilds. */
export function upsertSessionIndexRow(
  db: DatabaseSync,
  workspaceRootPath: string,
  sessionId: string,
  header: string,
  now: number,
): void {
  db.prepare(`
    INSERT INTO session_index (workspace_root, session_id, header, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(workspace_root, session_id) DO UPDATE SET header = excluded.header, updated_at = excluded.updated_at
  `).run(workspaceRootPath, sessionId, header, now)
}

export class StateStore {
  readonly dbPath: string
  readonly queue: WriteQueue
  /**
   * Writer-lock ownership gating writes. Managed by `openStateStore`; re-bound
   * on reuse when a later caller supplies a lock option.
   */
  lock: StateStoreLockOption | undefined
  #db: DatabaseSync
  #closed = false

  constructor(dbPath: string, db: DatabaseSync, queue: WriteQueue, lock?: StateStoreLockOption) {
    this.dbPath = dbPath
    this.#db = db
    this.queue = queue
    this.lock = lock
  }

  get db(): DatabaseSync {
    return this.#db
  }

  get userVersion(): number {
    const row = this.#db.prepare('PRAGMA user_version').get()
    return row && typeof row.user_version === 'number' ? row.user_version : 0
  }

  /**
   * Fail closed unless this store can prove write ownership: an explicit
   * opt-out, or a lock handle that still records this process's ownership.
   */
  #assertWritable(): void {
    if (this.lock === 'allow-unlocked') return
    if (this.lock === undefined) {
      throw new StateStoreWriteLockRequiredError('this store was opened without a writer-lock handle')
    }
    if (!isStateWriterLockHeld(this.lock)) {
      throw new StateStoreWriteLockRequiredError('the supplied writer-lock handle is no longer held by this process')
    }
  }

  run<T>(write: StateWrite<T>): Promise<T> {
    try {
      this.#assertWritable()
    } catch (error) {
      return Promise.reject(error)
    }
    return this.queue.run({
      storePath: this.dbPath,
      keys: write.keys,
      signal: write.signal,
      reentrant: write.reentrant,
      fn: () => write.fn(this.#db),
    })
  }

  putKV(key: string, value: string, now: number = Date.now()): Promise<void> {
    return this.run({
      keys: ['state_kv', key],
      fn: (db) => {
        db.prepare(`
          INSERT INTO state_kv (key, value, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `).run(key, value, now)
      },
    })
  }

  getKV(key: string): string | undefined {
    const row = this.#db.prepare('SELECT value FROM state_kv WHERE key = ?').get(key)
    return row && typeof row.value === 'string' ? row.value : undefined
  }

  deleteKV(key: string): Promise<void> {
    return this.run({ keys: ['state_kv', key], fn: (db) => { db.prepare('DELETE FROM state_kv WHERE key = ?').run(key) } })
  }

  upsertSessionIndex(workspaceRootPath: string, sessionId: string, header: string, now: number = Date.now()): Promise<void> {
    return this.run({
      keys: [sessionIndexKey(workspaceRootPath, sessionId)],
      fn: (db) => { upsertSessionIndexRow(db, workspaceRootPath, sessionId, header, now) },
    })
  }

  deleteSessionIndex(workspaceRootPath: string, sessionId: string): Promise<void> {
    return this.run({
      keys: [sessionIndexKey(workspaceRootPath, sessionId)],
      fn: (db) => {
        db.prepare('DELETE FROM session_index WHERE workspace_root = ? AND session_id = ?').run(workspaceRootPath, sessionId)
      },
    })
  }

  listSessionIndex(workspaceRootPath: string): Array<{ sessionId: string; header: string; updatedAt: number }> {
    const rows = this.#db.prepare(
      'SELECT session_id, header, updated_at FROM session_index WHERE workspace_root = ? ORDER BY session_id',
    ).all(workspaceRootPath)
    const entries: Array<{ sessionId: string; header: string; updatedAt: number }> = []
    for (const row of rows) {
      if (typeof row.session_id !== 'string' || typeof row.header !== 'string' || typeof row.updated_at !== 'number') continue
      entries.push({ sessionId: row.session_id, header: row.header, updatedAt: row.updated_at })
    }
    return entries
  }

  replaceSessionTranscript(sessionId: string, entries: readonly string[]): Promise<void> {
    return this.run({
      keys: ['session_transcript', sessionId],
      fn: (db) => {
        db.prepare('DELETE FROM session_transcript WHERE session_id = ?').run(sessionId)
        const insert = db.prepare('INSERT INTO session_transcript (session_id, seq, entry) VALUES (?, ?, ?)')
        entries.forEach((entry, seq) => insert.run(sessionId, seq, entry))
      },
    })
  }

  readSessionTranscript(sessionId: string): string[] {
    const rows = this.#db.prepare(
      'SELECT entry FROM session_transcript WHERE session_id = ? ORDER BY seq',
    ).all(sessionId)
    return rows.flatMap((row) => (typeof row.entry === 'string' ? [row.entry] : []))
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#db.close()
  }
}

const stores = new Map<string, StateStore>()

/**
 * Open (or reuse) the single state store for a config dir. Reused per resolved
 * directory so a process holds exactly one connection per store.
 *
 * Writes require proof of writer-lock ownership: pass the live handle from
 * `acquireStateWriterLock` as `lock`, or pass `lock: 'allow-unlocked'` for an
 * explicit opt-out (read-only tools and tests). Without either, the store opens
 * for reads but writes fail closed with a typed `STATE_LOCKED` error.
 */
export function openStateStore(options: { configDir: string; lock?: StateStoreLockOption }): StateStore {
  const dir = stateDirectory(options.configDir)
  const key = resolve(dir)
  const cached = stores.get(key)
  if (cached) {
    if (options.lock !== undefined) cached.lock = options.lock
    return cached
  }

  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const dbPath = join(dir, STATE_DATABASE_FILENAME)
  const fresh = !existsSync(dbPath)
  const db = new DatabaseSync(dbPath)
  if (fresh) chmodSync(dbPath, 0o600)
  try {
    db.exec('PRAGMA busy_timeout = 5000;')
    // First-time WAL switches can race before SQLite's busy handler is active.
    const deadline = Date.now() + 5000
    for (;;) {
      try { db.exec('PRAGMA journal_mode = WAL;'); break } catch (error) {
        const failure = error as { code?: string; errcode?: number }
        if ((failure.code !== 'SQLITE_BUSY' && failure.errcode !== 5) || Date.now() >= deadline) throw error
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10)
      }
    }
    db.exec('PRAGMA synchronous = FULL;')
    applyMigrations(db)
  } catch (error) {
    db.close()
    throw error
  }

  const store = new StateStore(dbPath, db, createWriteQueue(), options.lock)
  stores.set(key, store)
  return store
}

export function closeStateStore(configDir: string): void {
  const key = resolve(stateDirectory(configDir))
  const store = stores.get(key)
  if (!store) return
  stores.delete(key)
  store.close()
}

/** Test hook: close and forget every cached store. */
export function resetStateStores(): void {
  for (const store of stores.values()) store.close()
  stores.clear()
}