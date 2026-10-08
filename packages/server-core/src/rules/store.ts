/**
 * W1-12 (#1509) — `rule_execution` / `automation_rule` stores (DATA-MODEL §5.16).
 *
 * Local authority: `<workspaceRoot>/.rox/automation-rules.sqlite` (dir 0700,
 * file 0600) — the same private-directory pattern as W1-02's link store and
 * W1-03's command store. The workspace authority uses the Postgres tables from
 * W1-05 (`515-automation-rules.sql`) with the same port
 * (`apps/workspace-service/src/modules/rules/store.ts`).
 *
 * Idempotency is the store's job: `claim()` inserts the execution row and
 * loses the race to an existing `idempotency_key`
 * (`INSERT … ON CONFLICT (idempotency_key) DO NOTHING`), so a redelivered
 * event resumes the existing execution instead of creating a second one.
 */

import { chmodSync, existsSync, lstatSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from '@rox/shared/utils/sqlite-runtime'
import {
  RULE_EXECUTION_STATUSES,
  RULE_STEP_STATUSES,
  type RuleExecutionRecord,
  type RuleExecutionStatus,
  type RuleStepRecord,
  type RuleStepStatus,
} from '@rox/core/automation'
import { KeyedMutex } from '../commands/store'

export const LOCAL_RULES_STORE_FILE = 'automation-rules.sqlite'

export interface RuleSettingsRow {
  automationRuleId: string
  ruleId: string
  workspaceId: string
  enabled: boolean
  params: Record<string, unknown>
  scope: 'workspace' | 'principal'
  principalId: string | null
  updatedBy: string | null
  updatedAt: string
}

export interface ExecutionListOptions {
  ruleId?: string
  status?: RuleExecutionStatus
  limit?: number
}

export interface RuleExecutionStore {
  /** Insert (idempotent by key) or return the existing execution. */
  claim(execution: RuleExecutionRecord): Promise<{ inserted: boolean; execution: RuleExecutionRecord }>
  save(execution: RuleExecutionRecord): Promise<void>
  get(workspaceId: string, idempotencyKey: string): Promise<RuleExecutionRecord | null>
  list(workspaceId: string, options?: ExecutionListOptions): Promise<RuleExecutionRecord[]>
  /** Executions with remaining steps that a restart may re-drive (oldest first). */
  pending(workspaceId: string): Promise<RuleExecutionRecord[]>
  close?(): void
}

export interface RuleSettingsStore {
  read(workspaceId: string, ruleId: string, principalId?: string | null): Promise<RuleSettingsRow | null>
  listSettings(workspaceId: string): Promise<RuleSettingsRow[]>
  upsert(row: RuleSettingsRow): Promise<RuleSettingsRow>
  close?(): void
}

const WORKSPACE_SCOPE = '00000000-0000-0000-0000-000000000000'

function privateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 })
  const stat = lstatSync(path)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Private automation storage is unavailable')
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) throw new Error('Private automation storage is unavailable')
  chmodSync(path, 0o700)
}

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T)
}

function isExecutionStatus(value: unknown): value is RuleExecutionStatus {
  return typeof value === 'string' && (RULE_EXECUTION_STATUSES as readonly string[]).includes(value)
}

function isStepStatus(value: unknown): value is RuleStepStatus {
  return typeof value === 'string' && (RULE_STEP_STATUSES as readonly string[]).includes(value)
}

function toStepRecord(value: unknown): RuleStepRecord | null {
  if (value === null || typeof value !== 'object') return null
  const record = value as Partial<RuleStepRecord>
  if (typeof record.action !== 'string' || typeof record.command_id !== 'string' || !isStepStatus(record.status)) return null
  return {
    action: record.action,
    command_id: record.command_id,
    status: record.status,
    ...(typeof record.receipt_status === 'string' ? { receipt_status: record.receipt_status } : {}),
    ...(typeof record.receipt_ref === 'string' ? { receipt_ref: record.receipt_ref } : {}),
    ...(typeof record.error === 'string' ? { error: record.error } : {}),
    ...(typeof record.attempts === 'number' ? { attempts: record.attempts } : {}),
    ...(typeof record.duration_ms === 'number' ? { duration_ms: record.duration_ms } : {}),
    ...(typeof record.finished_at === 'string' ? { finished_at: record.finished_at } : {}),
  }
}

function toExecutionRecord(value: unknown): RuleExecutionRecord | null {
  if (value === null || typeof value !== 'object') return null
  const record = value as Partial<RuleExecutionRecord>
  if (typeof record.idempotencyKey !== 'string' || !isExecutionStatus(record.status)) return null
  const steps = Array.isArray(record.steps) ? record.steps.map(toStepRecord).filter((step): step is RuleStepRecord => step !== null) : []
  return {
    ruleExecutionId: String(record.ruleExecutionId ?? ''),
    workspaceId: String(record.workspaceId ?? ''),
    ruleId: String(record.ruleId ?? ''),
    idempotencyKey: record.idempotencyKey,
    sourceEventId: String(record.sourceEventId ?? ''),
    status: record.status,
    steps,
    attempts: Number(record.attempts ?? 1),
    ...(typeof record.lastError === 'string' ? { lastError: record.lastError } : {}),
    createdAt: String(record.createdAt ?? ''),
    ...(typeof record.finishedAt === 'string' ? { finishedAt: record.finishedAt } : {}),
  }
}

/** In-memory store for tests and ephemeral hosts. */
export class InMemoryRulesStore implements RuleExecutionStore, RuleSettingsStore {
  private readonly executions = new Map<string, RuleExecutionRecord>()
  private readonly settings = new Map<string, RuleSettingsRow>()
  private readonly mutex = new KeyedMutex()

  async claim(execution: RuleExecutionRecord): Promise<{ inserted: boolean; execution: RuleExecutionRecord }> {
    return this.mutex.run(execution.workspaceId, async () => {
      const existing = this.executions.get(keyOf(execution.workspaceId, execution.idempotencyKey))
      if (existing) return { inserted: false, execution: clone(existing) }
      this.executions.set(keyOf(execution.workspaceId, execution.idempotencyKey), clone(execution))
      return { inserted: true, execution: clone(execution) }
    })
  }

  async save(execution: RuleExecutionRecord): Promise<void> {
    await this.mutex.run(execution.workspaceId, async () => {
      this.executions.set(keyOf(execution.workspaceId, execution.idempotencyKey), clone(execution))
    })
  }

  async get(workspaceId: string, idempotencyKey: string): Promise<RuleExecutionRecord | null> {
    return clone(this.executions.get(keyOf(workspaceId, idempotencyKey)) ?? null)
  }

  async list(workspaceId: string, options: ExecutionListOptions = {}): Promise<RuleExecutionRecord[]> {
    return [...this.executions.values()]
      .filter(record => record.workspaceId === workspaceId)
      .filter(record => (options.ruleId ? record.ruleId === options.ruleId : true))
      .filter(record => (options.status ? record.status === options.status : true))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
      .slice(0, options.limit ?? 100)
      .map(clone)
  }

  async pending(workspaceId: string): Promise<RuleExecutionRecord[]> {
    return [...this.executions.values()]
      .filter(record => record.workspaceId === workspaceId && (record.status === 'running' || record.status === 'failed'))
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
      .map(clone)
  }

  async read(workspaceId: string, ruleId: string, principalId?: string | null): Promise<RuleSettingsRow | null> {
    return clone(this.settings.get(settingsKeyOf(workspaceId, ruleId, principalId ?? null)) ?? null)
  }

  async listSettings(workspaceId: string): Promise<RuleSettingsRow[]> {
    return [...this.settings.values()].filter(row => row.workspaceId === workspaceId).map(clone)
  }

  async upsert(row: RuleSettingsRow): Promise<RuleSettingsRow> {
    const stored = { ...clone(row), principalId: row.principalId ?? null, updatedAt: row.updatedAt }
    this.settings.set(settingsKeyOf(row.workspaceId, row.ruleId, stored.principalId), stored)
    return clone(stored)
  }

  /** Test helper. */
  counts(): { executions: number; settings: number } {
    return { executions: this.executions.size, settings: this.settings.size }
  }
}

function keyOf(workspaceId: string, idempotencyKey: string): string {
  return `${workspaceId}\u0000${idempotencyKey}`
}

function settingsKeyOf(workspaceId: string, ruleId: string, principalId: string | null): string {
  return `${workspaceId}\u0000${ruleId}\u0000${principalId ?? WORKSPACE_SCOPE}`
}

/** Workspace-local SQLite store (local authority). */
export class SqliteRulesStore implements RuleExecutionStore, RuleSettingsStore {
  readonly dbPath: string
  private readonly db: DatabaseSync
  private readonly mutex = new KeyedMutex()

  constructor(options: { workspaceRoot: string }) {
    const dir = join(options.workspaceRoot, '.rox')
    privateDirectory(dir)
    this.dbPath = join(dir, LOCAL_RULES_STORE_FILE)
    const fresh = !existsSync(this.dbPath)
    this.db = new DatabaseSync(this.dbPath)
    if (fresh) chmodSync(this.dbPath, 0o600)
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS automation_rule (
        automation_rule_id TEXT PRIMARY KEY,
        rule_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        params TEXT NOT NULL DEFAULT '{}',
        scope TEXT NOT NULL DEFAULT 'workspace',
        principal_id TEXT,
        updated_by TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS automation_rule_uniq
        ON automation_rule (workspace_id, rule_id, COALESCE(principal_id, '${WORKSPACE_SCOPE}'));
      CREATE TABLE IF NOT EXISTS rule_execution (
        rule_execution_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        rule_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        source_event_id TEXT NOT NULL,
        status TEXT NOT NULL,
        steps TEXT NOT NULL DEFAULT '[]',
        attempts INTEGER NOT NULL DEFAULT 1,
        last_error TEXT,
        created_at TEXT NOT NULL,
        finished_at TEXT
      );
      CREATE INDEX IF NOT EXISTS rule_execution_status ON rule_execution (workspace_id, rule_id, status);
    `)
  }

  async claim(execution: RuleExecutionRecord): Promise<{ inserted: boolean; execution: RuleExecutionRecord }> {
    return this.mutex.run(execution.workspaceId, async () => {
      const result = this.db.prepare(`
        INSERT INTO rule_execution
          (rule_execution_id, workspace_id, rule_id, idempotency_key, source_event_id, status, steps, attempts, last_error, created_at, finished_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (idempotency_key) DO NOTHING
      `).run(
        execution.ruleExecutionId, execution.workspaceId, String(execution.ruleId), execution.idempotencyKey,
        execution.sourceEventId, execution.status, JSON.stringify(execution.steps), execution.attempts,
        execution.lastError ?? null, execution.createdAt, execution.finishedAt ?? null,
      )
      if (result.changes > 0) return { inserted: true, execution: clone(execution) }
      const existing = await this.get(execution.workspaceId, execution.idempotencyKey)
      if (!existing) throw new Error('rule_execution lost the claim race but is not readable')
      return { inserted: false, execution: existing }
    })
  }

  async save(execution: RuleExecutionRecord): Promise<void> {
    await this.mutex.run(execution.workspaceId, async () => {
      this.db.prepare(`
        UPDATE rule_execution
           SET status = ?, steps = ?, attempts = ?, last_error = ?, finished_at = ?
         WHERE workspace_id = ? AND idempotency_key = ?
      `).run(
        execution.status, JSON.stringify(execution.steps), execution.attempts,
        execution.lastError ?? null, execution.finishedAt ?? null,
        execution.workspaceId, execution.idempotencyKey,
      )
    })
  }

  async get(workspaceId: string, idempotencyKey: string): Promise<RuleExecutionRecord | null> {
    const row = this.db.prepare('SELECT * FROM rule_execution WHERE workspace_id = ? AND idempotency_key = ?').get(workspaceId, idempotencyKey)
    return row ? toExecutionRecord(rowToExecution(row)) : null
  }

  async list(workspaceId: string, options: ExecutionListOptions = {}): Promise<RuleExecutionRecord[]> {
    const clauses = ['workspace_id = ?']
    const values: Array<string | number> = [workspaceId]
    if (options.ruleId) { clauses.push('rule_id = ?'); values.push(options.ruleId) }
    if (options.status) { clauses.push('status = ?'); values.push(options.status) }
    values.push(options.limit ?? 100)
    const rows = this.db.prepare(`SELECT * FROM rule_execution WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC, rowid DESC LIMIT ?`).all(...values)
    return rows.map(row => toExecutionRecord(rowToExecution(row))).filter((record): record is RuleExecutionRecord => record !== null)
  }

  async pending(workspaceId: string): Promise<RuleExecutionRecord[]> {
    const rows = this.db.prepare("SELECT * FROM rule_execution WHERE workspace_id = ? AND status IN ('running', 'failed') ORDER BY created_at ASC, rowid ASC").all(workspaceId)
    return rows.map(row => toExecutionRecord(rowToExecution(row))).filter((record): record is RuleExecutionRecord => record !== null)
  }

  async read(workspaceId: string, ruleId: string, principalId?: string | null): Promise<RuleSettingsRow | null> {
    const row = this.db.prepare(`
      SELECT * FROM automation_rule
       WHERE workspace_id = ? AND rule_id = ? AND COALESCE(principal_id, '${WORKSPACE_SCOPE}') = ?
    `).get(workspaceId, ruleId, principalId ?? WORKSPACE_SCOPE)
    return row ? toSettingsRow(row) : null
  }

  async listSettings(workspaceId: string): Promise<RuleSettingsRow[]> {
    const rows = this.db.prepare('SELECT * FROM automation_rule WHERE workspace_id = ? ORDER BY rule_id ASC, scope ASC').all(workspaceId)
    return rows.map(toSettingsRow)
  }

  async upsert(row: RuleSettingsRow): Promise<RuleSettingsRow> {
    const stored: RuleSettingsRow = { ...row, principalId: row.principalId ?? null }
    this.db.prepare(`
      INSERT INTO automation_rule
        (automation_rule_id, rule_id, workspace_id, enabled, params, scope, principal_id, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (workspace_id, rule_id, COALESCE(principal_id, '${WORKSPACE_SCOPE}')) DO UPDATE SET
        enabled = excluded.enabled,
        params = excluded.params,
        scope = excluded.scope,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at
    `).run(
      stored.automationRuleId, stored.ruleId, stored.workspaceId, stored.enabled ? 1 : 0,
      JSON.stringify(stored.params), stored.scope, stored.principalId, stored.updatedBy, stored.updatedAt,
    )
    const read = await this.read(stored.workspaceId, stored.ruleId, stored.principalId)
    return read ?? stored
  }

  close(): void {
    this.db.close()
  }
}

function rowToExecution(row: Record<string, unknown>): RuleExecutionRecord {
  return {
    ruleExecutionId: String(row.rule_execution_id ?? ''),
    workspaceId: String(row.workspace_id ?? ''),
    ruleId: String(row.rule_id ?? ''),
    idempotencyKey: String(row.idempotency_key ?? ''),
    sourceEventId: String(row.source_event_id ?? ''),
    status: String(row.status ?? 'running') as RuleExecutionStatus,
    steps: JSON.parse(String(row.steps ?? '[]')) as RuleStepRecord[],
    attempts: Number(row.attempts ?? 1),
    ...(row.last_error === null || row.last_error === undefined ? {} : { lastError: String(row.last_error) }),
    createdAt: String(row.created_at ?? ''),
    ...(row.finished_at === null || row.finished_at === undefined ? {} : { finishedAt: String(row.finished_at) }),
  }
}

function toSettingsRow(row: Record<string, unknown>): RuleSettingsRow {
  return {
    automationRuleId: String(row.automation_rule_id ?? ''),
    ruleId: String(row.rule_id ?? ''),
    workspaceId: String(row.workspace_id ?? ''),
    enabled: Number(row.enabled ?? 1) !== 0,
    params: JSON.parse(String(row.params ?? '{}')) as Record<string, unknown>,
    scope: String(row.scope ?? 'workspace') === 'principal' ? 'principal' : 'workspace',
    principalId: row.principal_id === null || row.principal_id === undefined ? null : String(row.principal_id),
    updatedBy: row.updated_by === null || row.updated_by === undefined ? null : String(row.updated_by),
    updatedAt: String(row.updated_at ?? ''),
  }
}