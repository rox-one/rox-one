/**
 * W1-06 (#1503) — Postgres reference backend (workspace authority).
 *
 * Collections with a W1-05 table (`CollectionSpec.table`, single uuid / text
 * primary key) are read and written as rows: fields map camelCase →
 * snake_case onto the columns the live schema has (information_schema,
 * cached per schema), `workspace_id` / actor / `sort_key` NOT NULL columns
 * are filled, uuid and bytea values are validated (VALIDATION, not a 22P02
 * INTERNAL), `revision` columns give compare-and-set, and `deletedAt` maps to
 * `deleted_at` (hard delete when the table has none). Fields without a column
 * are not stored — the table is the record.
 *
 * Every other collection (association rows, settings, records whose module
 * table lands with its wave-2 package) is stored as `reference.record_written`
 * snapshot events in `domain_event` — no new DDL, same transaction as the
 * receipt. Snapshot reads take the workspace's reference advisory lock.
 */

import { CommandRejection } from '@rox/core/commands'
import type { EntityRef } from '@rox/core/entities'
import type { DomainEventDraft, DomainEventType } from '@rox/core/events'
import { collectionSpec, refKind } from '../collections'
import type { RecordBackend, RecordData, RecordWrite, StoredRecord } from '../types'

/** Structural slice of a postgres.js transaction (`TransactionSQL.unsafe`). */
export interface PostgresUnsafe {
  unsafe<T = unknown[]>(query: string, params?: unknown[]): PromiseLike<T>
}

export const REFERENCE_SNAPSHOT_EVENT = 'reference.record_written'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HEX_RE = /^(?:[0-9a-f]{2})*$/i
const ACTOR_COLUMNS = new Set(['owner_principal_id', 'owner_id', 'creator_id', 'author_id', 'recorded_by', 'created_by', 'granted_by', 'principal_id', 'invited_by', 'uploaded_by', 'sender_id', 'added_by'])
const SYSTEM_FIELDS = new Set(['id', 'revision', 'workspaceId'])

interface Column { name: string; dataType: string; udt: string; nullable: boolean; hasDefault: boolean }
interface TableMeta { name: string; pk: Column; columns: Map<string, Column> }
type SchemaMeta = Map<string, TableMeta>

const META = new Map<string, Promise<SchemaMeta>>()

export function resetPostgresReferenceMeta(): void {
  META.clear()
}

export const snake = (field: string) => field.replace(/[A-Z]/g, char => `_${char.toLowerCase()}`)
export const camel = (column: string) => column.replace(/_([a-z0-9])/g, (_m, char: string) => char.toUpperCase())
const quote = (identifier: string) => `"${identifier.replace(/"/g, '""')}"`

async function introspect(sql: PostgresUnsafe, schema: string): Promise<SchemaMeta> {
  const columns = await sql.unsafe<Array<{ table_name: string; column_name: string; data_type: string; udt_name: string; is_nullable: string; column_default: string | null; is_identity: string; is_generated: string }>>(
    `SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default, is_identity, is_generated
       FROM information_schema.columns WHERE table_schema = $1`, [schema])
  const keys = await sql.unsafe<Array<{ table_name: string; column_name: string }>>(
    `SELECT kcu.table_name, kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_name = tc.constraint_name AND kcu.constraint_schema = tc.constraint_schema AND kcu.table_name = tc.table_name
      WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = $1`, [schema])
  const byTable = new Map<string, Map<string, Column>>()
  for (const row of columns) {
    let table = byTable.get(row.table_name)
    if (!table) byTable.set(row.table_name, (table = new Map()))
    table.set(row.column_name, {
      name: row.column_name, dataType: row.data_type, udt: row.udt_name, nullable: row.is_nullable === 'YES',
      hasDefault: row.column_default !== null || row.is_identity === 'YES' || row.is_generated === 'ALWAYS',
    })
  }
  const pks = new Map<string, string[]>()
  for (const row of keys) pks.set(row.table_name, [...(pks.get(row.table_name) ?? []), row.column_name])
  const meta: SchemaMeta = new Map()
  for (const [name, cols] of byTable) {
    const pk = pks.get(name)
    if (pk?.length !== 1) continue
    const column = cols.get(pk[0]!)
    if (!column || !['uuid', 'text'].includes(column.udt)) continue
    meta.set(name, { name, pk: column, columns: cols })
  }
  return meta
}

function schemaOf(prefix: string): string {
  const match = /^"((?:[^"]|"")+)"\.$/.exec(prefix)
  if (!match) throw new Error('Invalid Postgres schema prefix')
  return match[1]!.replace(/""/g, '"')
}

function toColumnValue(column: Column, value: unknown, field: string): unknown {
  if (value === null || value === undefined) return null
  if (column.udt === 'uuid') {
    if (typeof value !== 'string' || !UUID_RE.test(value)) throw new CommandRejection('VALIDATION', `${field} must be a uuid`)
    return value
  }
  if (column.dataType === 'ARRAY') {
    if (!Array.isArray(value)) throw new CommandRejection('VALIDATION', `${field} must be a list`)
    if (column.udt === '_uuid' && !value.every(item => typeof item === 'string' && UUID_RE.test(item))) throw new CommandRejection('VALIDATION', `${field} must be uuids`)
    // A text-form array literal: the driver does not encode JS arrays for `unsafe` parameters.
    return toArrayLiteral(value.map(item => (typeof item === 'string' ? item : JSON.stringify(item))))
  }
  if (column.udt === 'bytea') {
    if (typeof value !== 'string' || !HEX_RE.test(value)) throw new CommandRejection('VALIDATION', `${field} must be hex`)
    return Buffer.from(value, 'hex')
  }
  if (column.udt === 'json' || column.udt === 'jsonb') return value
  if (['int2', 'int4', 'int8', 'float4', 'float8', 'numeric'].includes(column.udt)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new CommandRejection('VALIDATION', `${field} must be a number`)
    return value
  }
  if (column.udt === 'bool') {
    if (typeof value !== 'boolean') throw new CommandRejection('VALIDATION', `${field} must be a boolean`)
    return value
  }
  return typeof value === 'string' ? value : JSON.stringify(value)
}

const arrayItem = (item: string) => `"${item.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

/** `['a', 'b"c']` → `{"a","b\"c"}` (every element quoted, so commas / braces / NULL stay literal). */
export function toArrayLiteral(items: readonly string[]): string {
  return `{${items.map(arrayItem).join(',')}}`
}

/** Parses a one-dimensional Postgres array literal (`{a,"b c",NULL}`). */
export function parseArrayLiteral(literal: string): Array<string | null> {
  const body = literal.trim().replace(/^\{/, '').replace(/\}$/, '')
  const items: Array<string | null> = []
  if (body === '') return items
  let index = 0
  while (index <= body.length) {
    if (body[index] === '"') {
      let item = ''
      index += 1
      while (index < body.length && body[index] !== '"') {
        if (body[index] === '\\') index += 1
        item += body[index] ?? ''
        index += 1
      }
      items.push(item)
      index += 2 // closing quote + comma
    } else {
      const end = body.indexOf(',', index)
      const raw = body.slice(index, end === -1 ? body.length : end)
      items.push(raw === 'NULL' ? null : raw)
      index = end === -1 ? body.length + 1 : end + 1
    }
  }
  return items
}

function fromColumnValue(column: Column, value: unknown): unknown {
  if (value === null || value === undefined) return undefined
  if (column.dataType === 'ARRAY' && typeof value === 'string') return parseArrayLiteral(value)
  // Bun SQL decodes int / float arrays into typed arrays.
  if (ArrayBuffer.isView(value) && !Buffer.isBuffer(value)) return Array.from(value as unknown as ArrayLike<number>)
  if (value instanceof Date) return column.udt === 'date' ? value.toISOString().slice(0, 10) : value.toISOString()
  if (Buffer.isBuffer(value)) return value.toString('hex')
  if (typeof value === 'string' && ['int8', 'numeric'].includes(column.udt)) return Number(value)
  return value
}

/** Deterministic constraint failures → receipts the caller can act on (the transaction rolls back). */
function sqlState(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  const record = error as { errno?: unknown; sqlState?: unknown; code?: unknown }
  // postgres.js: `code`; Bun SQL: `errno` (its `code` is ERR_POSTGRES_SERVER_ERROR).
  return [record.errno, record.sqlState, record.code].find((value): value is string => typeof value === 'string' && /^[0-9A-Z]{5}$/.test(value))
}

function mapDataError(error: unknown, collection: string): unknown {
  const code = sqlState(error)
  if (code === '23503') return new CommandRejection('NOT_FOUND', `${refKind(collection)} references a record that does not exist`)
  if (code === '23502' || code === '23514' || code === '22P02' || code === '22007' || code === '22008' || code === '22003' || code === '22001') {
    return new CommandRejection('VALIDATION', `${refKind(collection)} rejected by the workspace schema (${String(code)})`)
  }
  return error
}

export interface PostgresBackendOptions {
  sql: PostgresUnsafe
  prefix: string
  workspaceId: string
  actorId: string
}

export class PostgresRecordBackend implements RecordBackend {
  readonly name = 'postgres' as const
  private readonly schema: string
  private readonly pending = new Map<string, StoredRecord & { deleted?: boolean }>()
  private readonly events: DomainEventDraft[] = []
  private locked = false

  constructor(private readonly options: PostgresBackendOptions) {
    this.schema = schemaOf(options.prefix)
  }

  private async meta(): Promise<SchemaMeta> {
    let meta = META.get(this.schema)
    if (!meta) {
      meta = introspect(this.options.sql, this.schema)
      META.set(this.schema, meta)
      meta.catch(() => META.delete(this.schema))
    }
    return meta
  }

  private async table(collection: string): Promise<TableMeta | null> {
    const name = collectionSpec(collection).table
    return name ? (await this.meta()).get(name) ?? null : null
  }

  private column(table: TableMeta, collection: string, field: string): Column | undefined {
    const name = collectionSpec(collection).columns?.[field] ?? snake(field)
    return table.columns.get(name)
  }

  private qualified(table: TableMeta): string {
    return `${this.options.prefix}${quote(table.name)}`
  }

  async get(collection: string, id: string): Promise<StoredRecord | null> {
    const table = await this.table(collection)
    return table ? this.getRow(table, collection, id) : this.getSnapshot(collection, id)
  }

  async put(write: RecordWrite) {
    const table = await this.table(write.collection)
    if (!table) return this.putSnapshot(write)
    try {
      return await this.putRow(table, write)
    } catch (error) {
      throw mapDataError(error, write.collection)
    }
  }

  async remove(collection: string, id: string): Promise<boolean> {
    const table = await this.table(collection)
    if (table) {
      if (table.pk.udt === 'uuid' && !UUID_RE.test(id)) return false
      const scope = table.columns.has('workspace_id') ? ' AND workspace_id = $2' : ''
      const rows = await this.options.sql.unsafe<unknown[]>(`DELETE FROM ${this.qualified(table)} WHERE ${quote(table.pk.name)} = $1${scope} RETURNING 1`, scope ? [id, this.options.workspaceId] : [id])
      return rows.length > 0
    }
    const current = await this.getSnapshot(collection, id)
    if (!current) return false
    this.snapshot(collection, id, current.revision + 1, current.data, true)
    return true
  }

  drainEvents(): DomainEventDraft[] {
    return this.events.splice(0)
  }

  // ── table rows ───────────────────────────────────────────────────────

  private async getRow(table: TableMeta, collection: string, id: string): Promise<StoredRecord | null> {
    if (table.pk.udt === 'uuid' && !UUID_RE.test(id)) return null
    const scope = table.columns.has('workspace_id') ? ' AND workspace_id = $2' : ''
    const rows = await this.options.sql.unsafe<Array<Record<string, unknown>>>(`SELECT * FROM ${this.qualified(table)} WHERE ${quote(table.pk.name)} = $1${scope}`, scope ? [id, this.options.workspaceId] : [id])
    const row = rows[0]
    if (!row) return null
    const overrides = Object.fromEntries(Object.entries(collectionSpec(collection).columns ?? {}).map(([field, column]) => [column, field]))
    const data: RecordData = {}
    for (const [name, value] of Object.entries(row)) {
      if (name === table.pk.name || name === 'workspace_id' || name === 'revision') continue
      const column = table.columns.get(name)
      const converted = column ? fromColumnValue(column, value) : value
      if (converted !== undefined) data[overrides[name] ?? camel(name)] = converted
    }
    return { id, revision: table.columns.has('revision') ? Number(row.revision ?? 1) : 1, data }
  }

  private rowValues(table: TableMeta, write: RecordWrite): Map<string, unknown> {
    const values = new Map<string, unknown>()
    for (const [field, value] of Object.entries(write.data)) {
      if (SYSTEM_FIELDS.has(field)) continue
      const column = this.column(table, write.collection, field)
      if (!column || column.name === table.pk.name || column.name === 'workspace_id' || column.name === 'revision') continue
      values.set(column.name, toColumnValue(column, value, field))
    }
    return values
  }

  private async putRow(table: TableMeta, write: RecordWrite) {
    if (table.pk.udt === 'uuid' && !UUID_RE.test(write.id)) throw new CommandRejection('VALIDATION', `${refKind(write.collection)} id must be a uuid`)
    const values = this.rowValues(table, write)
    const hasRevision = table.columns.has('revision')
    const scoped = table.columns.has('workspace_id')
    const deleting = Boolean(write.data.deletedAt) && !table.columns.has('deleted_at')

    if (write.expectedRevision === null) {
      if (scoped) values.set('workspace_id', this.options.workspaceId)
      for (const column of table.columns.values()) {
        if (values.has(column.name) || column.nullable || column.hasDefault || column.name === table.pk.name) continue
        if (column.name === 'sort_key') values.set(column.name, 'a0')
        else if (ACTOR_COLUMNS.has(column.name)) values.set(column.name, toColumnValue(column, this.options.actorId, camel(column.name)))
      }
      if (hasRevision) values.set('revision', 1)
      const names = [table.pk.name, ...values.keys()]
      const params = [write.id, ...values.values()]
      const inserted = await this.options.sql.unsafe<unknown[]>(
        `INSERT INTO ${this.qualified(table)} (${names.map(quote).join(', ')}) VALUES (${params.map((_v, i) => `$${i + 1}`).join(', ')}) ON CONFLICT DO NOTHING RETURNING 1`, params)
      if (inserted.length === 0) return { status: 'conflict' as const, current: await this.getRow(table, write.collection, write.id) }
      return { status: 'accepted' as const, revision: 1 }
    }

    const current = await this.getRow(table, write.collection, write.id)
    if (!current || (hasRevision && current.revision !== write.expectedRevision)) return { status: 'conflict' as const, current }
    if (deleting) {
      await this.remove(write.collection, write.id)
      return { status: 'accepted' as const, revision: current.revision + 1 }
    }
    // Clear columns whose field was removed from the record (`null` changes).
    for (const [field] of Object.entries(current.data)) {
      if (field in write.data) continue
      const column = this.column(table, write.collection, field)
      if (column?.nullable && !values.has(column.name) && column.name !== table.pk.name) values.set(column.name, null)
    }
    const sets = [...values.keys()].map((name, i) => `${quote(name)} = $${i + 1}`)
    const params: unknown[] = [...values.values()]
    if (hasRevision) sets.push('revision = revision + 1')
    if (sets.length === 0) return { status: 'accepted' as const, revision: current.revision }
    params.push(write.id)
    let where = `${quote(table.pk.name)} = $${params.length}`
    if (scoped) { params.push(this.options.workspaceId); where += ` AND workspace_id = $${params.length}` }
    if (hasRevision) { params.push(write.expectedRevision); where += ` AND revision = $${params.length}` }
    const rows = await this.options.sql.unsafe<Array<{ revision?: string | number }>>(
      `UPDATE ${this.qualified(table)} SET ${sets.join(', ')} WHERE ${where} RETURNING ${hasRevision ? 'revision' : '1 AS revision'}`, params)
    if (rows.length === 0) return { status: 'conflict' as const, current: await this.getRow(table, write.collection, write.id) }
    return { status: 'accepted' as const, revision: Number(rows[0]!.revision ?? 1) }
  }

  // ── event snapshots ──────────────────────────────────────────────────

  private async lock(): Promise<void> {
    if (this.locked) return
    await this.options.sql.unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [JSON.stringify(['reference-records', this.schema, this.options.workspaceId])])
    this.locked = true
  }

  private async getSnapshot(collection: string, id: string): Promise<StoredRecord | null> {
    const key = `${collection}\u0000${id}`
    const pending = this.pending.get(key)
    if (pending) return pending.deleted ? null : { id, revision: pending.revision, data: pending.data }
    await this.lock()
    const rows = await this.options.sql.unsafe<Array<{ payload: { revision?: number; deleted?: boolean; record?: RecordData } | string }>>(
      `SELECT payload FROM ${this.options.prefix}domain_event
        WHERE workspace_id = $1 AND subject_kind = $2 AND subject_id = $3 AND type = $4 AND payload->>'collection' = $5
        ORDER BY sequence DESC LIMIT 1`,
      [this.options.workspaceId, refKind(collection), id, REFERENCE_SNAPSHOT_EVENT, collection])
    const raw = rows[0]?.payload
    const payload = typeof raw === 'string' ? JSON.parse(raw) as { revision?: number; deleted?: boolean; record?: RecordData } : raw
    if (!payload || payload.deleted) return null
    return { id, revision: Number(payload.revision ?? 1), data: payload.record ?? {} }
  }

  private async putSnapshot(write: RecordWrite) {
    const current = await this.getSnapshot(write.collection, write.id)
    if ((current?.revision ?? null) !== write.expectedRevision) return { status: 'conflict' as const, current }
    const revision = (current?.revision ?? 0) + 1
    this.snapshot(write.collection, write.id, revision, write.data, false)
    return { status: 'accepted' as const, revision }
  }

  private snapshot(collection: string, id: string, revision: number, data: RecordData, deleted: boolean): void {
    this.pending.set(`${collection}\u0000${id}`, { id, revision, data, ...(deleted ? { deleted } : {}) })
    const subject = { kind: refKind(collection), id } as EntityRef
    this.events.push({ type: REFERENCE_SNAPSHOT_EVENT as DomainEventType, subject, payload: { collection, id, revision, ...(deleted ? { deleted: true } : {}), record: data } })
  }
}
