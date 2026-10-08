/**
 * W1-03 (#1500) — Workspace-local SQLite command store for the local bus.
 *
 * `<workspaceRoot>/.rox/commands.sqlite` (dir 0700, file 0600), same pattern as
 * the W1-02 entity-link store. Tables mirror `command_receipt` and
 * `domain_event` from W1-05 so local and server receipts have one shape.
 * Transactions are serialised per store by an async mutex because handlers may
 * await inside `BEGIN IMMEDIATE … COMMIT`.
 */

import { chmodSync, existsSync, lstatSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from '@rox/shared/utils/sqlite-runtime'
import type { CommandReceipt } from '@rox/core/commands'
import type { DomainEvent } from '@rox/core/events'
import {
  CommandStoreUniqueViolation,
  KeyedMutex,
  type CommandStore,
  type CommandStoreTransaction,
  type ListEventsOptions,
  type StoredCommandReceipt,
} from './store'

export const LOCAL_COMMAND_STORE_FILE = 'commands.sqlite'

function privateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 })
  const stat = lstatSync(path)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Private command storage is unavailable')
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) throw new Error('Private command storage is unavailable')
  chmodSync(path, 0o700)
}

interface ReceiptRow {
  workspace_id: string
  idempotency_key: string
  command_id: string
  actor_id: string
  request_hash: string
  observed_revision: number | null
  receipt: string
  created_at: string
}

interface EventRow {
  sequence: number
  event_id: string
  workspace_id: string
  type: string
  actor_id: string | null
  subject_kind: string | null
  subject_id: string | null
  aggregate_revision: number
  policy_epoch: number
  causation_id: string | null
  correlation_id: string | null
  payload: string
  created_at: string
}

function toReceipt(row: ReceiptRow): StoredCommandReceipt {
  return {
    workspaceId: row.workspace_id,
    idempotencyKey: row.idempotency_key,
    commandId: row.command_id,
    actorId: row.actor_id,
    requestHash: row.request_hash,
    observedRevision: row.observed_revision ?? null,
    receipt: JSON.parse(row.receipt) as CommandReceipt,
    createdAt: row.created_at,
  }
}

function toEvent(row: EventRow): DomainEvent {
  const event: DomainEvent = {
    eventId: row.event_id,
    sequence: Number(row.sequence),
    workspaceId: row.workspace_id,
    type: row.type as DomainEvent['type'],
    aggregateRevision: Number(row.aggregate_revision),
    policyEpoch: Number(row.policy_epoch),
    payload: JSON.parse(row.payload),
    createdAt: row.created_at,
  }
  if (row.actor_id) event.actorId = row.actor_id
  if (row.subject_kind && row.subject_id) event.subject = { kind: row.subject_kind as never, id: row.subject_id }
  if (row.causation_id) event.causationId = row.causation_id
  if (row.correlation_id) event.correlationId = row.correlation_id
  return event
}

export class SqliteCommandStore implements CommandStore {
  readonly dbPath: string
  private readonly db: DatabaseSync
  private readonly mutex = new KeyedMutex()
  private closed = false

  constructor(options: { workspaceRoot: string }) {
    const dir = join(options.workspaceRoot, '.rox')
    privateDirectory(dir)
    this.dbPath = join(dir, LOCAL_COMMAND_STORE_FILE)
    const fresh = !existsSync(this.dbPath)
    this.db = new DatabaseSync(this.dbPath)
    if (fresh) chmodSync(this.dbPath, 0o600)
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS command_receipt (
        workspace_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 256),
        command_id TEXT NOT NULL CHECK (length(command_id) BETWEEN 1 AND 256),
        actor_id TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        observed_revision INTEGER,
        receipt TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, idempotency_key),
        UNIQUE (workspace_id, command_id)
      );
      CREATE TABLE IF NOT EXISTS domain_event (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        workspace_id TEXT NOT NULL,
        type TEXT NOT NULL,
        actor_id TEXT,
        subject_kind TEXT,
        subject_id TEXT,
        aggregate_revision INTEGER NOT NULL DEFAULT 0,
        policy_epoch INTEGER NOT NULL DEFAULT 1,
        causation_id TEXT,
        correlation_id TEXT,
        payload TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS domain_event_workspace ON domain_event(workspace_id, sequence);
    `)
    const version = (this.db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined)?.user_version ?? 0
    if (version === 0) this.db.exec('PRAGMA user_version=1')
  }

  async transaction<T>(workspaceId: string, fn: (tx: CommandStoreTransaction) => Promise<T>): Promise<T> {
    // One writer per store file: the mutex key is the store, not the workspace.
    return this.mutex.run('store', async () => {
      this.assertOpen()
      this.db.exec('BEGIN IMMEDIATE')
      const tx: CommandStoreTransaction = {
        handle: { kind: 'sqlite', workspaceId, db: this.db },
        findReceipt: async (ws, key, commandId) => this.find(ws, key, commandId),
        appendEvents: async events => events.map(event => this.insertEvent(event)),
        saveReceipt: async record => this.insertReceipt(record),
      }
      try {
        const result = await fn(tx)
        this.db.exec('COMMIT')
        return result
      } catch (error) {
        try { this.db.exec('ROLLBACK') } catch { /* already rolled back */ }
        throw error
      }
    })
  }

  async findReceipt(workspaceId: string, idempotencyKey: string, commandId: string): Promise<StoredCommandReceipt | null> {
    this.assertOpen()
    return this.find(workspaceId, idempotencyKey, commandId)
  }

  async listEvents(workspaceId: string, options: ListEventsOptions = {}): Promise<DomainEvent[]> {
    this.assertOpen()
    const rows = this.db
      .prepare('SELECT * FROM domain_event WHERE workspace_id = ? AND sequence > ? ORDER BY sequence LIMIT ?')
      .all(workspaceId, options.afterSequence ?? 0, options.limit ?? 10_000) as unknown as EventRow[]
    return rows.map(toEvent)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.db.close()
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('command store is closed')
  }

  private find(workspaceId: string, key: string, commandId: string): StoredCommandReceipt | null {
    const row = this.db
      .prepare('SELECT * FROM command_receipt WHERE workspace_id = ? AND (idempotency_key = ? OR command_id = ?) LIMIT 1')
      .get(workspaceId, key, commandId) as unknown as ReceiptRow | undefined
    return row ? toReceipt(row) : null
  }

  private insertEvent(event: DomainEvent): DomainEvent {
    const result = this.db
      .prepare(`INSERT INTO domain_event (event_id, workspace_id, type, actor_id, subject_kind, subject_id, aggregate_revision,
        policy_epoch, causation_id, correlation_id, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        event.eventId, event.workspaceId, event.type, event.actorId ?? null, event.subject?.kind ?? null, event.subject?.id ?? null,
        event.aggregateRevision, event.policyEpoch ?? 1, event.causationId ?? null, event.correlationId ?? null,
        JSON.stringify(event.payload ?? {}), event.createdAt,
      )
    return { ...event, sequence: Number(result.lastInsertRowid) }
  }

  private insertReceipt(record: StoredCommandReceipt): void {
    try {
      this.db
        .prepare(`INSERT INTO command_receipt (workspace_id, idempotency_key, command_id, actor_id, request_hash, observed_revision,
          receipt, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(record.workspaceId, record.idempotencyKey, record.commandId, record.actorId, record.requestHash,
          record.observedRevision, JSON.stringify(record.receipt), record.createdAt)
    } catch (error) {
      if (/UNIQUE|PRIMARY KEY|constraint/i.test(String((error as Error)?.message ?? error))) throw new CommandStoreUniqueViolation()
      throw error
    }
  }
}
