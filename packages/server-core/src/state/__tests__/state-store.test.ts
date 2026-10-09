import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from '@rox/shared/utils/sqlite-runtime'
import {
  LATEST_STATE_USER_VERSION,
  MIGRATIONS,
  applyMigrations,
  closeStateStore,
  openStateStore,
  stateDatabasePath,
  type StateMigration,
} from '../state-store.ts'

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

  it('openStateStore creates and migrates <configDir>/state/rox-state.sqlite', () => {
    const configDir = scratch()
    const store = openStateStore({ configDir })
    expect(store.dbPath).toBe(stateDatabasePath(configDir))
    expect(existsSync(store.dbPath)).toBe(true)
    expect(store.userVersion).toBe(LATEST_STATE_USER_VERSION)
    expect(LATEST_STATE_USER_VERSION).toBe(MIGRATIONS[MIGRATIONS.length - 1]!.version)
    const tables = tableNames(store.db)
    expect(tables).toEqual(expect.arrayContaining(['state_kv', 'session_index', 'session_transcript']))
    expect(
      store.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_session_transcript_session_seq'").all().length,
    ).toBe(1)

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