import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { SQL } from 'bun'
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { applyWorkspaceMigrations, migrationFromSource } from '../../apps/workspace-service/src/database/migrations'

const CONNECTION_ENVIRONMENT = process.env.ROX_WORKSPACE_TEST_CONFIG ?? join(homedir(), '.agents', 'state', 'rox-compound-workspace', 'postgres-environment.json')
const schema = `wp01_migrations_${randomBytes(6).toString('hex')}`
let database: SQL

beforeAll(async () => {
  const environment: unknown = JSON.parse(await readFile(CONNECTION_ENVIRONMENT, 'utf8'))
  if (!environment || typeof environment !== 'object' || !('ROX_WORKSPACE_DATABASE_URL' in environment) ||
      typeof environment.ROX_WORKSPACE_DATABASE_URL !== 'string') throw new Error('Authenticated workspace PostgreSQL connection is required')
  database = new SQL(environment.ROX_WORKSPACE_DATABASE_URL)
  await database.unsafe(`CREATE SCHEMA "${schema}"`)
})

afterAll(async () => {
  if (database) {
    await database.unsafe(`DROP SCHEMA "${schema}" CASCADE`)
    await database.close()
  }
})

describe('WP-01 durable PostgreSQL migration boundary', () => {
  const first = migrationFromSource('01-domain-contract.sql', 'CREATE TABLE migration_probe (id integer PRIMARY KEY, value text NOT NULL);')
  const second = migrationFromSource('02-probe.sql', "INSERT INTO migration_probe (id, value) VALUES (20260930, 'durable');")

  test('concurrent initializers commit DDL and receipts exactly once; reconnect replays without mutation', async () => {
    const outcomes = await Promise.all([applyWorkspaceMigrations(database, [first, second], schema), applyWorkspaceMigrations(database, [first, second], schema)])
    expect(outcomes.map(outcome => outcome.applied.length).sort()).toEqual([0, 2])
    const rows = await database.unsafe<{ id: number; value: string }[]>(`SELECT id, value FROM "${schema}".migration_probe`)
    expect(rows).toEqual([{ id: 20260930, value: 'durable' }])
    const replay = await applyWorkspaceMigrations(database, [first, second], schema)
    expect(replay).toEqual({ applied: [], retained: [first.name, second.name] })
    const receipts = await database.unsafe<{ name: string; sha256: string }[]>(`SELECT name, sha256 FROM "${schema}".rox_schema_migration ORDER BY applied_order`)
    expect(receipts).toEqual([{ name: first.name, sha256: first.sha256 }, { name: second.name, sha256: second.sha256 }])
  })

  test('changed, missing and reordered applied migrations fail closed with retained data', async () => {
    await expect(applyWorkspaceMigrations(database, [migrationFromSource(first.name, 'DROP TABLE migration_probe;'), second], schema))
      .rejects.toMatchObject({ code: 'MIGRATION_CHANGED' })
    await expect(applyWorkspaceMigrations(database, [first], schema)).rejects.toMatchObject({ code: 'MIGRATION_HISTORY_MISSING' })
    const retroactive = migrationFromSource('00-retroactive.sql', 'SELECT 1;')
    await expect(applyWorkspaceMigrations(database, [retroactive, first, second], schema)).rejects.toMatchObject({ code: 'MIGRATION_ORDER_CONFLICT' })
    expect(await database.unsafe<{ count: number }[]>(`SELECT count(*)::integer AS count FROM "${schema}".migration_probe`)).toEqual([{ count: 1 }])
  })

  test('a failing pending migration rolls back its DDL and receipt, then a corrected retry applies', async () => {
    const broken = migrationFromSource('03-extension.sql', 'CREATE TABLE rollback_probe (id integer); SELECT * FROM definitely_missing_table_wp01;')
    await expect(applyWorkspaceMigrations(database, [first, second, broken], schema)).rejects.toThrow()
    const tables = await database<{ relation: string | null }[]>`SELECT to_regclass(${schema + '.rollback_probe'})::text AS relation`
    expect(tables).toEqual([{ relation: null }])
    const receipts = await database.unsafe<{ count: number }[]>(`SELECT count(*)::integer AS count FROM "${schema}".rox_schema_migration`)
    expect(receipts).toEqual([{ count: 2 }])
    const repaired = migrationFromSource('03-extension.sql', 'CREATE TABLE rollback_probe (id integer PRIMARY KEY);')
    expect(await applyWorkspaceMigrations(database, [first, second, repaired], schema)).toEqual({ applied: [repaired.name], retained: [first.name, second.name] })
  })

  test('unbound bytes, duplicate identifiers and unsafe schema identifiers are rejected before DDL', async () => {
    await expect(applyWorkspaceMigrations(database, [{ ...first, sql: 'SELECT 1;' }], schema)).rejects.toMatchObject({ code: 'INVALID_MIGRATION' })
    await expect(applyWorkspaceMigrations(database, [first, first], schema)).rejects.toMatchObject({ code: 'INVALID_MIGRATION' })
    await expect(applyWorkspaceMigrations(database, [first], 'public; DROP SCHEMA public CASCADE')).rejects.toMatchObject({ code: 'INVALID_MIGRATION' })
    expect(() => migrationFromSource('../01-invalid.sql', 'SELECT 1;')).toThrow('INVALID_MIGRATION')
    expect(() => migrationFromSource('01-empty.sql', '')).toThrow('INVALID_MIGRATION')
  })
})
