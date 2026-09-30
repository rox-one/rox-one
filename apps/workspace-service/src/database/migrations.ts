import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SQL } from 'bun'

const MIGRATION_NAME = /^[0-9][A-Za-z0-9_-]*\.sql$/
const SCHEMA_NAME = /^[a-z][a-z0-9_]{0,62}$/
const MIGRATION_LOCK_NAMESPACE = 'rox.workspace.schema.v1'

export interface WorkspaceMigration {
  readonly name: string
  readonly sql: string
  readonly sha256: string
}

export class WorkspaceMigrationError extends Error {
  constructor(readonly code: 'INVALID_MIGRATION' | 'MIGRATION_CHANGED' | 'MIGRATION_HISTORY_MISSING' | 'MIGRATION_ORDER_CONFLICT') {
    super(code)
    this.name = 'WorkspaceMigrationError'
  }
}

export function migrationFromSource(name: string, sql: string): WorkspaceMigration {
  if (!MIGRATION_NAME.test(name) || !sql.trim()) throw new WorkspaceMigrationError('INVALID_MIGRATION')
  return { name, sql, sha256: createHash('sha256').update(sql, 'utf8').digest('hex') }
}

/** Filenames and exact bytes bind migrations; renaming an applied file is not a new migration. */
export async function readWorkspaceMigrations(directory: string): Promise<readonly WorkspaceMigration[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const names = entries.filter(entry => entry.name.endsWith('.sql')).map(entry => {
    if (!entry.isFile()) throw new WorkspaceMigrationError('INVALID_MIGRATION')
    return entry.name
  })
  return Promise.all(names.map(async name => migrationFromSource(name, await readFile(join(directory, name), 'utf8'))))
}

/**
 * One PostgreSQL transaction holds the schema lock, applies DDL and records checksums.
 * Failure rolls back both schema changes and receipts, including first-run tracking DDL.
 */
export async function applyWorkspaceMigrations(
  database: SQL,
  migrations: readonly WorkspaceMigration[],
  schema = 'public',
): Promise<{ applied: readonly string[]; retained: readonly string[] }> {
  if (!SCHEMA_NAME.test(schema)) throw new WorkspaceMigrationError('INVALID_MIGRATION')
  const verified = migrations.map(item => {
    const parsed = migrationFromSource(item.name, item.sql)
    if (parsed.sha256 !== item.sha256) throw new WorkspaceMigrationError('INVALID_MIGRATION')
    return parsed
  }).sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))
  if (new Set(verified.map(item => item.name)).size !== verified.length) throw new WorkspaceMigrationError('INVALID_MIGRATION')

  return database.begin(async transaction => {
    await transaction`SELECT pg_advisory_xact_lock(hashtextextended(${MIGRATION_LOCK_NAMESPACE + ':' + schema}, 0))`
    // Schema identifiers are validated above; migration SQL is reviewed code, never request payload.
    await transaction.unsafe(`SET LOCAL search_path TO "${schema}"`)
    await transaction.unsafe(`CREATE TABLE IF NOT EXISTS "${schema}".rox_schema_migration (
      name text PRIMARY KEY,
      sha256 text NOT NULL CHECK (length(sha256) = 64),
      applied_order integer NOT NULL UNIQUE CHECK (applied_order > 0),
      applied_at timestamptz NOT NULL DEFAULT now()
    )`)
    const history = await transaction<{ name: string; sha256: string; applied_order: number }[]>`
      SELECT name, sha256, applied_order FROM rox_schema_migration ORDER BY applied_order
    `
    const byName = new Map(verified.map(item => [item.name, item]))
    for (const [index, existing] of history.entries()) {
      const input = byName.get(existing.name)
      if (!input) throw new WorkspaceMigrationError('MIGRATION_HISTORY_MISSING')
      if (input.sha256 !== existing.sha256) throw new WorkspaceMigrationError('MIGRATION_CHANGED')
      if (verified[index]?.name !== existing.name || existing.applied_order !== index + 1) {
        throw new WorkspaceMigrationError('MIGRATION_ORDER_CONFLICT')
      }
    }
    const applied: string[] = []
    for (const [index, migration] of verified.entries()) {
      if (index < history.length) continue
      await transaction.unsafe(migration.sql)
      await transaction`INSERT INTO rox_schema_migration (name, sha256, applied_order)
        VALUES (${migration.name}, ${migration.sha256}, ${index + 1})`
      applied.push(migration.name)
    }
    return { applied, retained: history.map(item => item.name) }
  })
}
