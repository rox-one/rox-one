/**
 * W1-03 (#1500) — Postgres command store (`domain_event` + `command_receipt`
 * from W1-05 `05-events.sql`). One `BEGIN … COMMIT` holds the handler effect,
 * the events and the receipt. Per-key advisory locks serialise retries of one
 * command; a per-workspace append lock keeps `domain_event.sequence` order
 * equal to commit order so the relay never skips a late-committing event.
 *
 * Lock order is canonical: the distinct (idempotencyKey, commandId) locks are
 * taken sorted, then the workspace append lock. Crossed envelopes
 * ({key:A,id:B} vs {key:B,id:A}) therefore queue instead of deadlocking.
 */

import type { SQL, TransactionSQL } from 'bun'
import type { CommandReceipt } from '../../../../../packages/core/src/commands/index.ts'
import type { DomainEvent } from '../../../../../packages/core/src/events/index.ts'
import {
  CommandStoreUniqueViolation,
  someErrorInChain,
  type CommandStore,
  type CommandStoreTransaction,
  type ListEventsOptions,
  type StoredCommandReceipt,
} from '../../../../../packages/server-core/src/commands/store.ts'

type Database = SQL | TransactionSQL

/** Handle passed to command handlers as `ctx.transaction`. */
export interface PostgresCommandTransaction {
  readonly kind: 'postgres'
  readonly sql: TransactionSQL
  /** Quoted schema prefix, e.g. `"public".` */
  readonly prefix: string
}

interface ReceiptRow {
  workspace_id: string
  idempotency_key: string
  command_id: string
  actor_principal_id: string | null
  request_hash: string
  observed_revision: string
  result: CommandReceipt | string
  created_at: Date | string
}

interface EventRow {
  sequence: string
  event_id: string
  workspace_id: string
  type: string
  actor_id: string | null
  subject_kind: string | null
  subject_id: string | null
  aggregate_revision: string
  policy_epoch: string
  causation_id: string | null
  correlation_id: string | null
  payload: unknown
  created_at: Date | string
}

const iso = (value: Date | string) => (value instanceof Date ? value : new Date(value)).toISOString()
const json = <T>(value: T | string): T => (typeof value === 'string' ? JSON.parse(value) as T : value)

function isUniqueViolation(error: unknown): boolean {
  const record = error as { errno?: unknown; code?: unknown; message?: unknown } | null
  return record?.errno === '23505' || record?.code === '23505' || /duplicate key value/i.test(String(record?.message ?? ''))
}

/** Advisory lock names for one command, in the canonical (sorted, distinct) order. */
export function commandLockKeys(schema: string, workspaceId: string, idempotencyKey: string, commandId: string): string[] {
  return [...new Set([idempotencyKey, commandId])].sort().map(value => JSON.stringify(['command-key', schema, workspaceId, value]))
}

/**
 * SQLSTATEs worth retrying: connection exceptions (08), transaction rollback
 * (40000), serialization failure / deadlock / statement completion unknown
 * (40001 / 40P01 / 40003; not 40002, a deferred constraint violation),
 * insufficient resources (53), query cancelled by statement_timeout /
 * lock_timeout (57014), admin / crash shutdown (57P01-03), lock not available
 * (55P03), system / I/O errors (58000 / 58030), authentication failures
 * during credential rotation (28000 / 28P01) and the session-termination
 * timeouts: idle_session_timeout (57P05), idle_in_transaction_session_timeout
 * (25P03) and transaction_timeout (25P04, PG17). Not 25P02 (a statement in an
 * already-failed transaction: a logic error).
 */
const TRANSIENT_SQLSTATE = /^(08...|4000[013]|40P01|53...|57014|57P0[1-35]|25P0[34]|55P03|58000|58030|28000|28P01)$/
/**
 * Bun 1.4.x `PostgresError.code`s for connection-class failures, taken from the
 * driver itself (bun.exe string table + bun-types docs/runtime/sql.mdx):
 * CONNECTION_REFUSED / _FAILED / _CLOSED / _TIMEOUT, IDLE_ / LIFETIME_TIMEOUT,
 * TLS_NOT_AVAILABLE / TLS_UPGRADE_FAILED, QUERY_CANCELLED and the SCRAM
 * password failure (AUTHENTICATION_FAILED_PBKDF2, the driver-side 28P01).
 * Plus Node-style socket errnos for other drivers.
 */
export const TRANSIENT_POSTGRES_DRIVER_CODES = Object.freeze([
  'ERR_POSTGRES_CONNECTION_REFUSED',
  'ERR_POSTGRES_CONNECTION_FAILED',
  'ERR_POSTGRES_CONNECTION_CLOSED',
  'ERR_POSTGRES_CONNECTION_TIMEOUT',
  'ERR_POSTGRES_IDLE_TIMEOUT',
  'ERR_POSTGRES_LIFETIME_TIMEOUT',
  'ERR_POSTGRES_TLS_NOT_AVAILABLE',
  'ERR_POSTGRES_TLS_UPGRADE_FAILED',
  'ERR_POSTGRES_QUERY_CANCELLED',
  'ERR_POSTGRES_AUTHENTICATION_FAILED_PBKDF2',
] as const)
const TRANSIENT_DRIVER = /^(ERR_POSTGRES_(CONNECTION_[A-Z_]+|IDLE_TIMEOUT|LIFETIME_TIMEOUT|TLS_[A-Z_]+|QUERY_CANCELLED|AUTHENTICATION_FAILED_PBKDF2)|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|EHOSTUNREACH|ENETUNREACH|ENOTFOUND|EAI_AGAIN|ConnectionClosed)$/
/** Deterministic data errors: SQLSTATE class 22 and the driver's encoding / binding errors. */
const DATA_DRIVER = /^ERR_POSTGRES_(INVALID_BYTE_SEQUENCE(_FOR_ENCODING)?|INVALID_CHARACTER|INVALID_BINARY_DATA|OVERFLOW|UNSUPPORTED_[A-Z_]+_FORMAT|UNSUPPORTED_INTEGER_SIZE|INVALID_QUERY_BINDING|TOO_MANY_PARAMETERS|MULTIDIMENSIONAL_ARRAY_NOT_SUPPORTED_YET|NULLS_IN_ARRAY_NOT_SUPPORTED_YET)$/

/**
 * Transient Postgres failures (nothing committed, safe to retry): the
 * SQLSTATEs in `TRANSIENT_SQLSTATE` and the Bun driver connection-class codes
 * in `TRANSIENT_POSTGRES_DRIVER_CODES` (refused / failed / closed / timed-out
 * connections, TLS, cancelled queries) — on the error or anywhere in its
 * `cause` chain.
 * Everything else (22xxx data errors, 23xxx constraints, 25P02, 42xxx) is
 * deterministic and becomes a terminal INTERNAL receipt.
 */
export function isTransientPostgresError(error: unknown): boolean {
  return someErrorInChain(error, isTransientPostgresErrorOnly)
}

/** Postgres data error (class 22 / driver encoding, overflow, binding) on the error or its causes. */
export function isPostgresDataError(error: unknown): boolean {
  return someErrorInChain(error, candidate => {
    const record = candidate as { errno?: unknown; code?: unknown; sqlState?: unknown } | null
    if (!record || typeof record !== 'object') return false
    return [record.errno, record.sqlState, record.code].some(value =>
      typeof value === 'string' && ((/^[0-9A-Z]{5}$/.test(value) && value.startsWith('22')) || DATA_DRIVER.test(value)))
  })
}

function isTransientPostgresErrorOnly(error: unknown): boolean {
  const record = error as { errno?: unknown; code?: unknown; sqlState?: unknown } | null
  if (!record || typeof record !== 'object') return false
  for (const value of [record.errno, record.sqlState, record.code]) {
    if (typeof value !== 'string') continue
    if (/^[0-9A-Z]{5}$/.test(value) && TRANSIENT_SQLSTATE.test(value)) return true
    if (TRANSIENT_DRIVER.test(value)) return true
  }
  return false
}

export class PostgresCommandStore implements CommandStore {
  private readonly prefix: string

  constructor(private readonly database: SQL, private readonly schema = 'public') {
    if (!/^[a-z][a-z0-9_]*$/.test(schema)) throw new Error('Invalid command store schema')
    this.prefix = `"${schema}".`
  }

  private async query<T>(db: Database, sql: string, params: unknown[] = []): Promise<T[]> {
    // Table names come from the validated schema; values stay parameterised.
    return await db.unsafe<T[]>(sql, params)
  }

  async transaction<T>(workspaceId: string, fn: (tx: CommandStoreTransaction) => Promise<T>): Promise<T> {
    return await this.database.begin(async sql => {
      const handle: PostgresCommandTransaction = { kind: 'postgres', sql, prefix: this.prefix }
      const tx: CommandStoreTransaction = {
        handle,
        findReceipt: async (ws, key, commandId) => {
          for (const lock of commandLockKeys(this.schema, ws, key, commandId)) {
            await this.query(sql, 'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [lock])
          }
          return this.find(sql, ws, key, commandId)
        },
        appendEvents: async events => {
          await this.query(sql, 'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [JSON.stringify(['domain-events', this.schema, workspaceId])])
          const stored: DomainEvent[] = []
          for (const event of events) {
            const [row] = await this.query<{ sequence: string; created_at: Date | string }>(sql, `INSERT INTO ${this.prefix}domain_event
              (event_id, workspace_id, type, actor_id, subject_kind, subject_id, aggregate_revision, policy_epoch,
                causation_id, correlation_id, payload, created_at)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12) RETURNING sequence::text, created_at`,
            [event.eventId, event.workspaceId, event.type, event.actorId ?? null, event.subject?.kind ?? null, event.subject?.id ?? null,
              event.aggregateRevision, event.policyEpoch ?? 1, event.causationId ?? null, event.correlationId ?? null,
              event.payload ?? {}, event.createdAt])
            stored.push({ ...event, sequence: Number(row!.sequence) })
          }
          return stored
        },
        saveReceipt: async record => {
          try {
            await this.query(sql, 'SAVEPOINT command_receipt_insert')
            await this.query(sql, `INSERT INTO ${this.prefix}command_receipt
              (workspace_id, idempotency_key, command_id, actor_principal_id, request_hash, observed_revision, result, created_at)
              VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
            [record.workspaceId, record.idempotencyKey, record.commandId, record.actorId, record.requestHash,
              record.observedRevision ?? 0, record.receipt, record.createdAt])
            await this.query(sql, 'RELEASE SAVEPOINT command_receipt_insert')
          } catch (error) {
            if (isUniqueViolation(error)) throw new CommandStoreUniqueViolation()
            throw error
          }
        },
      }
      return await fn(tx)
    })
  }

  async findReceipt(workspaceId: string, idempotencyKey: string, commandId: string): Promise<StoredCommandReceipt | null> {
    return this.find(this.database, workspaceId, idempotencyKey, commandId)
  }

  isTransientError(error: unknown): boolean {
    return isTransientPostgresError(error)
  }

  isDataError(error: unknown): boolean {
    return isPostgresDataError(error)
  }

  async latestSequences(): Promise<Map<string, number>> {
    const rows = await this.query<{ workspace_id: string; latest: string }>(this.database,
      `SELECT workspace_id::text, max(sequence)::text AS latest FROM ${this.prefix}domain_event GROUP BY workspace_id`)
    return new Map(rows.map(row => [row.workspace_id, Number(row.latest)]))
  }

  async listEvents(workspaceId: string, options: ListEventsOptions = {}): Promise<DomainEvent[]> {
    const rows = await this.query<EventRow>(this.database, `SELECT sequence::text, event_id, workspace_id, type, actor_id, subject_kind, subject_id,
        aggregate_revision::text, policy_epoch::text, causation_id, correlation_id, payload, created_at
      FROM ${this.prefix}domain_event WHERE workspace_id = $1 AND sequence > $2 ORDER BY sequence LIMIT $3`,
    [workspaceId, options.afterSequence ?? 0, options.limit ?? 1000])
    return rows.map(row => {
      const event: DomainEvent = {
        eventId: row.event_id,
        sequence: Number(row.sequence),
        workspaceId: row.workspace_id,
        type: row.type as DomainEvent['type'],
        aggregateRevision: Number(row.aggregate_revision),
        policyEpoch: Number(row.policy_epoch),
        payload: json(row.payload as string),
        createdAt: iso(row.created_at),
      }
      if (row.actor_id) event.actorId = row.actor_id
      if (row.subject_kind && row.subject_id) event.subject = { kind: row.subject_kind as never, id: row.subject_id }
      if (row.causation_id) event.causationId = row.causation_id
      if (row.correlation_id) event.correlationId = row.correlation_id
      return event
    })
  }

  private async find(db: Database, workspaceId: string, key: string, commandId: string): Promise<StoredCommandReceipt | null> {
    const [row] = await this.query<ReceiptRow>(db, `SELECT workspace_id, idempotency_key, command_id, actor_principal_id, request_hash,
        observed_revision::text, result, created_at
      FROM ${this.prefix}command_receipt WHERE workspace_id = $1 AND (idempotency_key = $2 OR command_id = $3)
      ORDER BY (idempotency_key = $2) DESC LIMIT 1`, [workspaceId, key, commandId])
    if (!row) return null
    return {
      workspaceId: row.workspace_id,
      idempotencyKey: row.idempotency_key,
      commandId: row.command_id,
      actorId: row.actor_principal_id ?? '',
      requestHash: row.request_hash,
      observedRevision: Number(row.observed_revision),
      receipt: json<CommandReceipt>(row.result),
      createdAt: iso(row.created_at),
    }
  }
}
