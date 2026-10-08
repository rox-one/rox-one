/**
 * W1-03 (#1500) — Client outbox for workspace-authority commands.
 *
 * Commands for the workspace authority are written here first (durable,
 * FIFO per workspace) and drained by `WorkspaceCommandSync` when the service
 * is reachable. Re-sending is safe: the service dedupes by idempotency key, so
 * a lost acknowledgement yields `duplicate`, never a second effect.
 *
 * `SqliteCommandOutbox` follows the `SqliteReplicaOutbox` pattern (WAL,
 * synchronous=FULL, file 0600) under `<workspaceRoot>/.rox/` (dir 0700).
 */

import { chmodSync, existsSync, lstatSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from '@rox/shared/utils/sqlite-runtime'
import type { CommandEnvelope, CommandReceipt } from '@rox/core/commands'

export const COMMAND_OUTBOX_FILE = 'command-outbox.sqlite'

export interface OutboxEntry {
  /** Local FIFO position. */
  seq: number
  workspaceId: string
  commandId: string
  envelope: CommandEnvelope
  enqueuedAt: string
  attempts: number
  /** Epoch ms; entries are not retried before this. */
  nextAttemptAt: number
  lastError?: string
}

export interface CommandOutbox {
  /** Idempotent by `(workspaceId, commandId)`; returns the stored entry. */
  enqueue(workspaceId: string, envelope: CommandEnvelope, enqueuedAt: string): Promise<OutboxEntry>
  /** Oldest undelivered entries of one workspace (FIFO), regardless of backoff. */
  pending(workspaceId: string, limit: number): Promise<OutboxEntry[]>
  /** Terminal receipt arrived: remove the entry. */
  complete(workspaceId: string, commandId: string, receipt: CommandReceipt): Promise<void>
  /** Transport failure: keep the entry, record the error and the next attempt time. */
  fail(workspaceId: string, commandId: string, error: string, nextAttemptAt: number): Promise<void>
  count(workspaceId?: string): Promise<number>
  /** Workspaces with at least one pending entry (oldest first), e.g. after a restart. */
  workspaceIds(): Promise<string[]>
  close?(): void
}

export class InMemoryCommandOutbox implements CommandOutbox {
  private seq = 0
  private readonly entries: OutboxEntry[] = []

  async enqueue(workspaceId: string, envelope: CommandEnvelope, enqueuedAt: string): Promise<OutboxEntry> {
    const existing = this.entries.find(entry => entry.workspaceId === workspaceId && entry.commandId === envelope.commandId)
    if (existing) return structuredClone(existing)
    const entry: OutboxEntry = { seq: ++this.seq, workspaceId, commandId: envelope.commandId, envelope: structuredClone(envelope), enqueuedAt, attempts: 0, nextAttemptAt: 0 }
    this.entries.push(entry)
    return structuredClone(entry)
  }

  async pending(workspaceId: string, limit: number): Promise<OutboxEntry[]> {
    return this.entries.filter(entry => entry.workspaceId === workspaceId).slice(0, limit).map(entry => structuredClone(entry))
  }

  async complete(workspaceId: string, commandId: string): Promise<void> {
    const index = this.entries.findIndex(entry => entry.workspaceId === workspaceId && entry.commandId === commandId)
    if (index !== -1) this.entries.splice(index, 1)
  }

  async fail(workspaceId: string, commandId: string, error: string, nextAttemptAt: number): Promise<void> {
    const entry = this.entries.find(item => item.workspaceId === workspaceId && item.commandId === commandId)
    if (!entry) return
    entry.attempts += 1
    entry.lastError = error
    entry.nextAttemptAt = nextAttemptAt
  }

  async count(workspaceId?: string): Promise<number> {
    return workspaceId ? this.entries.filter(entry => entry.workspaceId === workspaceId).length : this.entries.length
  }

  async workspaceIds(): Promise<string[]> {
    return [...new Set(this.entries.map(entry => entry.workspaceId))]
  }
}

function privateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 })
  const stat = lstatSync(path)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Private command outbox storage is unavailable')
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) throw new Error('Private command outbox storage is unavailable')
  chmodSync(path, 0o700)
}

interface OutboxRow {
  seq: number
  workspace_id: string
  command_id: string
  envelope: string
  enqueued_at: string
  attempts: number
  next_attempt_at: number
  last_error: string | null
}

function toEntry(row: OutboxRow): OutboxEntry {
  const entry: OutboxEntry = {
    seq: Number(row.seq),
    workspaceId: row.workspace_id,
    commandId: row.command_id,
    envelope: JSON.parse(row.envelope) as CommandEnvelope,
    enqueuedAt: row.enqueued_at,
    attempts: Number(row.attempts),
    nextAttemptAt: Number(row.next_attempt_at),
  }
  if (row.last_error) entry.lastError = row.last_error
  return entry
}

export class SqliteCommandOutbox implements CommandOutbox {
  readonly dbPath: string
  private readonly db: DatabaseSync
  private closed = false

  constructor(options: { workspaceRoot: string }) {
    const dir = join(options.workspaceRoot, '.rox')
    privateDirectory(dir)
    this.dbPath = join(dir, COMMAND_OUTBOX_FILE)
    const fresh = !existsSync(this.dbPath)
    this.db = new DatabaseSync(this.dbPath)
    if (fresh) chmodSync(this.dbPath, 0o600)
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS command_outbox (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id TEXT NOT NULL,
        command_id TEXT NOT NULL,
        envelope TEXT NOT NULL,
        enqueued_at TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        UNIQUE (workspace_id, command_id)
      );
    `)
  }

  async enqueue(workspaceId: string, envelope: CommandEnvelope, enqueuedAt: string): Promise<OutboxEntry> {
    this.assertOpen()
    this.db
      .prepare('INSERT OR IGNORE INTO command_outbox (workspace_id, command_id, envelope, enqueued_at) VALUES (?, ?, ?, ?)')
      .run(workspaceId, envelope.commandId, JSON.stringify(envelope), enqueuedAt)
    const row = this.db.prepare('SELECT * FROM command_outbox WHERE workspace_id = ? AND command_id = ?').get(workspaceId, envelope.commandId)
    return toEntry(row as unknown as OutboxRow)
  }

  async pending(workspaceId: string, limit: number): Promise<OutboxEntry[]> {
    this.assertOpen()
    const rows = this.db.prepare('SELECT * FROM command_outbox WHERE workspace_id = ? ORDER BY seq LIMIT ?').all(workspaceId, limit)
    return (rows as unknown as OutboxRow[]).map(toEntry)
  }

  async complete(workspaceId: string, commandId: string): Promise<void> {
    this.assertOpen()
    this.db.prepare('DELETE FROM command_outbox WHERE workspace_id = ? AND command_id = ?').run(workspaceId, commandId)
  }

  async fail(workspaceId: string, commandId: string, error: string, nextAttemptAt: number): Promise<void> {
    this.assertOpen()
    this.db
      .prepare('UPDATE command_outbox SET attempts = attempts + 1, last_error = ?, next_attempt_at = ? WHERE workspace_id = ? AND command_id = ?')
      .run(error.slice(0, 500), Math.floor(nextAttemptAt), workspaceId, commandId)
  }

  async count(workspaceId?: string): Promise<number> {
    this.assertOpen()
    const row = workspaceId
      ? this.db.prepare('SELECT COUNT(*) AS n FROM command_outbox WHERE workspace_id = ?').get(workspaceId)
      : this.db.prepare('SELECT COUNT(*) AS n FROM command_outbox').get()
    return Number((row as { n?: number } | undefined)?.n ?? 0)
  }

  async workspaceIds(): Promise<string[]> {
    this.assertOpen()
    const rows = this.db.prepare('SELECT workspace_id, MIN(seq) AS first FROM command_outbox GROUP BY workspace_id ORDER BY first').all()
    return (rows as Array<{ workspace_id: string }>).map(row => row.workspace_id)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.db.close()
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('command outbox is closed')
  }
}
