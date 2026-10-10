import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from '@rox/shared/utils/sqlite-runtime'
import {
  LATEST_STATE_USER_VERSION,
  MIGRATIONS,
  StateStoreWriteLockRequiredError,
  applyMigrations,
  closeStateStore,
  openStateStore,
  stateDatabasePath,
  stateDirectory,
  stateWriterLockPath,
  type StateMigration,
} from '../state-store.ts'
import { acquireStateWriterLock } from '../writer-lock.ts'

const dirs: string[] = []
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rox-state-store-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop()!
    closeStateStore(dir)
    rmSync(dir, { recursive: true, force: true })
  }
})

function tableNames(db: DatabaseSync): string[] {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()
  return rows.flatMap((row) => (typeof row.name === 'string' ? [row.name] : []))
}

function columnNames(db: DatabaseSync, table: string): string[] {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all()
  return rows.flatMap((row) => (typeof row.name === 'string' ? [row.name] : []))
}

function userVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get()
  return row && typeof row.user_version === 'number' ? row.user_version : -1
}

const CUSTOM: readonly StateMigration[] = [
  { version: 1, name: 'create', up: (db) => db.exec('CREATE TABLE t1 (id INTEGER PRIMARY KEY)') },
  { version: 2, name: 'add-name', up: (db) => db.exec('ALTER TABLE t1 ADD COLUMN name TEXT') },
]

describe('state store migrations', () => {
  it('applies a fresh install to the latest version', () => {
    const db = new DatabaseSync(':memory:')
    expect(applyMigrations(db, CUSTOM)).toBe(2)
    expect(userVersion(db)).toBe(2)
    expect(tableNames(db)).toContain('t1')
    expect(columnNames(db, 't1')).toContain('name')
    db.close()
  })

  it('upgrades an N-1 database without re-running applied migrations', () => {
    const db = new DatabaseSync(':memory:')
    applyMigrations(db, [CUSTOM[0]])
    expect(userVersion(db)).toBe(1)
    db.prepare('INSERT INTO t1 (id) VALUES (1)').run()

    expect(applyMigrations(db, CUSTOM)).toBe(2)
    expect(userVersion(db)).toBe(2)
    // Row written before the upgrade survives; v2 column was added once.
    const row = db.prepare('SELECT name FROM t1 WHERE id = 1').get()
    expect(row?.name ?? null).toBeNull()
    db.close()
  })

  it('is idempotent', () => {
    const db = new DatabaseSync(':memory:')
    let runs = 0
    const counted: readonly StateMigration[] = CUSTOM.map((migration) => ({
      ...migration,
      up: (inner) => { runs += 1; migration.up(inner) },
    }))
    applyMigrations(db, counted)
    applyMigrations(db, counted)
    expect(runs).toBe(2)
    expect(userVersion(db)).toBe(2)
    db.close()
  })

  it('rolls back a failing migration and preserves the previous version', () => {
    const db = new DatabaseSync(':memory:')
    const failing: readonly StateMigration[] = [
      ...CUSTOM,
      { version: 3, name: 'boom', up: (inner) => { inner.exec('CREATE TABLE t2 (id INTEGER)'); throw new Error('boom') } },
    ]
    expect(() => applyMigrations(db, failing)).toThrow('boom')
    expect(userVersion(db)).toBe(2)
    expect(tableNames(db)).not.toContain('t2')
    db.close()
  })

  it('drops the unused session_transcript table from a v1 database (f.10)', () => {
    const db = new DatabaseSync(':memory:')
    // Materialise the v1 schema — including the transcript half — exactly as a
    // store created before the f.10 deletion did, then populate a row.
    applyMigrations(db, [MIGRATIONS[0]!])
    expect(userVersion(db)).toBe(1)
    expect(tableNames(db)).toContain('session_transcript')
    db.prepare('INSERT INTO session_transcript (session_id, seq, entry) VALUES (?, ?, ?)').run('s1', 0, '{}')

    expect(applyMigrations(db)).toBe(LATEST_STATE_USER_VERSION)
    expect(userVersion(db)).toBe(LATEST_STATE_USER_VERSION)
    // The table (and its index) are gone; the INDEX half survives.
    expect(tableNames(db)).not.toContain('session_transcript')
    expect(tableNames(db)).toContain('session_index')
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%session_transcript%'").all().length).toBe(0)
    db.close()
  })

  it('opens an on-disk v1 store that holds transcript rows, dropping the table (f.10)', () => {
    const configDir = scratch()
    mkdirSync(stateDirectory(configDir), { recursive: true })
    const db = new DatabaseSync(stateDatabasePath(configDir))
    applyMigrations(db, [MIGRATIONS[0]!])
    db.prepare('INSERT INTO session_transcript (session_id, seq, entry) VALUES (?, ?, ?)').run('s1', 0, '{"a":1}')
    db.close()

    const store = openStateStore({ configDir, lock: 'allow-unlocked' })
    expect(store.userVersion).toBe(LATEST_STATE_USER_VERSION)
    expect(tableNames(store.db)).not.toContain('session_transcript')
    expect(store.getKV('missing')).toBeUndefined()
  })

  it('openStateStore creates and migrates <configDir>/state/rox-state.sqlite', () => {
    const configDir = scratch()
    const store = openStateStore({ configDir, lock: 'allow-unlocked' })
    expect(store.dbPath).toBe(stateDatabasePath(configDir))
    expect(existsSync(store.dbPath)).toBe(true)
    expect(store.userVersion).toBe(LATEST_STATE_USER_VERSION)
    expect(LATEST_STATE_USER_VERSION).toBe(MIGRATIONS[MIGRATIONS.length - 1]!.version)
    const tables = tableNames(store.db)
    expect(tables).toEqual(expect.arrayContaining(['state_kv', 'session_index']))
    // f.10: the transcript half is deleted — neither the table nor its index exists.
    expect(tables).not.toContain('session_transcript')
    expect(
      store.db.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%session_transcript%'").all().length,
    ).toBe(0)

    // Round-trips through the write queue.
    return store.putKV('k', 'v').then(() => {
      expect(store.getKV('k')).toBe('v')
    })
  })

  it('reuses one connection per config dir', () => {
    const configDir = scratch()
    expect(openStateStore({ configDir })).toBe(openStateStore({ configDir }))
  })
})

describe('state store writer-lock gating', () => {
  it('refuses a write with a typed STATE_LOCKED error when opened without a lock, but reads', async () => {
    const configDir = scratch()
    const store = openStateStore({ configDir })
    expect(store.getKV('missing')).toBeUndefined()

    let thrown: unknown
    try {
      await store.putKV('k', 'v')
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(StateStoreWriteLockRequiredError)
    expect((thrown as StateStoreWriteLockRequiredError).code).toBe('STATE_LOCKED')
    expect(store.getKV('k')).toBeUndefined()
  })

  it("writes when opened with the explicit 'allow-unlocked' opt-out", async () => {
    const configDir = scratch()
    const store = openStateStore({ configDir, lock: 'allow-unlocked' })
    await store.putKV('k', 'v')
    expect(store.getKV('k')).toBe('v')
  })

  it('writes when opened with a held writer-lock handle', async () => {
    const configDir = scratch()
    const lock = acquireStateWriterLock(stateWriterLockPath(configDir), { label: 'state-store-test' })
    try {
      const store = openStateStore({ configDir, lock })
      await store.putKV('k', 'v')
      expect(store.getKV('k')).toBe('v')
    } finally {
      lock.release()
    }
  })

  it('refuses a write once the writer-lock handle is no longer held', async () => {
    const configDir = scratch()
    const lock = acquireStateWriterLock(stateWriterLockPath(configDir), { label: 'state-store-test' })
    const store = openStateStore({ configDir, lock })
    lock.release()
    await expect(store.putKV('k', 'v')).rejects.toThrow(StateStoreWriteLockRequiredError)
  })
})