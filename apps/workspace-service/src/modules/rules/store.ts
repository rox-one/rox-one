/**
 * W1-12 (#1509) — Postgres `automation_rule` / `rule_execution` store.
 *
 * Uses the tables W1-05 ships (`515-automation-rules.sql`, DATA-MODEL §5.16);
 * the local authority's twin lives in
 * `packages/server-core/src/rules/store.ts`. Claim is the idempotency gate:
 * `INSERT … ON CONFLICT (idempotency_key) DO NOTHING`, so a redelivered event
 * resumes the existing execution instead of creating a second one.
 */

import type { SQL, TransactionSQL } from 'bun'
import type {
  RuleExecutionRecord,
  RuleExecutionStatus,
  RuleStepRecord,
} from '@rox/core/automation'
import { RULE_EXECUTION_STATUSES, RULE_STEP_STATUSES } from '@rox/core/automation'
import type {
  ExecutionListOptions,
  RuleExecutionStore,
  RuleSettingsRow,
  RuleSettingsStore,
} from '../../../../../packages/server-core/src/rules/store.ts'

type Database = SQL | TransactionSQL

const WORKSPACE_SCOPE = '00000000-0000-0000-0000-000000000000'

interface ExecutionRow {
  rule_execution_id: string
  workspace_id: string
  rule_id: string
  idempotency_key: string
  source_event_id: string
  status: string
  steps: unknown
  attempts: number | string
  last_error: string | null
  created_at: Date | string
  finished_at: Date | string | null
}

interface SettingsRow {
  automation_rule_id: string
  rule_id: string
  workspace_id: string
  enabled: boolean
  params: unknown
  scope: string
  principal_id: string | null
  updated_by: string | null
  updated_at: Date | string
}

const iso = (value: Date | string | null | undefined): string => (value instanceof Date ? value : new Date(String(value))).toISOString()

function json<T>(value: unknown): T {
  return (typeof value === 'string' ? JSON.parse(value) : value) as T
}

function toExecution(row: ExecutionRow): RuleExecutionRecord {
  const status = RULE_EXECUTION_STATUSES.includes(row.status as RuleExecutionStatus)
    ? (row.status as RuleExecutionStatus)
    : 'running'
  const steps = json<RuleStepRecord[]>(row.steps)
  return {
    ruleExecutionId: row.rule_execution_id,
    workspaceId: row.workspace_id,
    ruleId: row.rule_id,
    idempotencyKey: row.idempotency_key,
    sourceEventId: row.source_event_id,
    status,
    steps: Array.isArray(steps) ? steps.filter(step => RULE_STEP_STATUSES.includes(step.status)) : [],
    attempts: Number(row.attempts),
    ...(row.last_error === null ? {} : { lastError: row.last_error }),
    createdAt: iso(row.created_at),
    ...(row.finished_at === null ? {} : { finishedAt: iso(row.finished_at) }),
  }
}

function toSettings(row: SettingsRow): RuleSettingsRow {
  return {
    automationRuleId: row.automation_rule_id,
    ruleId: row.rule_id,
    workspaceId: row.workspace_id,
    enabled: row.enabled,
    params: json<Record<string, unknown>>(row.params) ?? {},
    scope: row.scope === 'principal' ? 'principal' : 'workspace',
    principalId: row.principal_id,
    updatedBy: row.updated_by,
    updatedAt: iso(row.updated_at),
  }
}

export class PostgresRulesStore implements RuleExecutionStore, RuleSettingsStore {
  constructor(private readonly database: Database, private readonly schema: string) {}

  private get prefix(): string {
    return `"${this.schema.replaceAll('"', '""')}".`
  }

  async claim(execution: RuleExecutionRecord): Promise<{ inserted: boolean; execution: RuleExecutionRecord }> {
    const inserted = await this.database.unsafe<ExecutionRow[]>(`
      INSERT INTO ${this.prefix}rule_execution
        (rule_execution_id, workspace_id, rule_id, idempotency_key, source_event_id, status, steps, attempts, last_error, created_at, finished_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11)
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING *
    `, [
      execution.ruleExecutionId, execution.workspaceId, String(execution.ruleId), execution.idempotencyKey,
      execution.sourceEventId, execution.status, JSON.stringify(execution.steps), execution.attempts,
      execution.lastError ?? null, execution.createdAt, execution.finishedAt ?? null,
    ])
    if (inserted.length > 0) return { inserted: true, execution: toExecution(inserted[0]!) }
    const existing = await this.get(execution.workspaceId, execution.idempotencyKey)
    if (!existing) throw new Error('rule_execution lost the claim race but is not readable')
    return { inserted: false, execution: existing }
  }

  async save(execution: RuleExecutionRecord): Promise<void> {
    await this.database.unsafe(`
      UPDATE ${this.prefix}rule_execution
         SET status = $1, steps = $2::jsonb, attempts = $3, last_error = $4, finished_at = $5
       WHERE workspace_id = $6 AND idempotency_key = $7
    `, [
      execution.status, JSON.stringify(execution.steps), execution.attempts,
      execution.lastError ?? null, execution.finishedAt ?? null, execution.workspaceId, execution.idempotencyKey,
    ])
  }

  async get(workspaceId: string, idempotencyKey: string): Promise<RuleExecutionRecord | null> {
    const rows = await this.database.unsafe<ExecutionRow[]>(
      `SELECT * FROM ${this.prefix}rule_execution WHERE workspace_id = $1 AND idempotency_key = $2`,
      [workspaceId, idempotencyKey],
    )
    return rows[0] ? toExecution(rows[0]) : null
  }

  async list(workspaceId: string, options: ExecutionListOptions = {}): Promise<RuleExecutionRecord[]> {
    const conditions = ['workspace_id = $1']
    const values: Array<string | number> = [workspaceId]
    if (options.ruleId) { values.push(options.ruleId); conditions.push(`rule_id = $${values.length}`) }
    if (options.status) { values.push(options.status); conditions.push(`status = $${values.length}`) }
    values.push(options.limit ?? 100)
    const rows = await this.database.unsafe<ExecutionRow[]>(
      `SELECT * FROM ${this.prefix}rule_execution WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC, rule_execution_id DESC LIMIT $${values.length}`,
      values,
    )
    return rows.map(toExecution)
  }

  async pending(workspaceId: string): Promise<RuleExecutionRecord[]> {
    const rows = await this.database.unsafe<ExecutionRow[]>(
      `SELECT * FROM ${this.prefix}rule_execution WHERE workspace_id = $1 AND status IN ('running', 'failed') ORDER BY created_at ASC LIMIT 500`,
      [workspaceId],
    )
    return rows.map(toExecution)
  }

  async read(workspaceId: string, ruleId: string, principalId?: string | null): Promise<RuleSettingsRow | null> {
    const rows = await this.database.unsafe<SettingsRow[]>(`
      SELECT * FROM ${this.prefix}automation_rule
       WHERE workspace_id = $1 AND rule_id = $2 AND COALESCE(principal_id, '${WORKSPACE_SCOPE}'::uuid) = $3
    `, [workspaceId, ruleId, principalId ?? WORKSPACE_SCOPE])
    return rows[0] ? toSettings(rows[0]) : null
  }

  async listSettings(workspaceId: string): Promise<RuleSettingsRow[]> {
    const rows = await this.database.unsafe<SettingsRow[]>(
      `SELECT * FROM ${this.prefix}automation_rule WHERE workspace_id = $1 ORDER BY rule_id ASC, scope ASC`,
      [workspaceId],
    )
    return rows.map(toSettings)
  }

  async upsert(row: RuleSettingsRow): Promise<RuleSettingsRow> {
    const rows = await this.database.unsafe<SettingsRow[]>(`
      INSERT INTO ${this.prefix}automation_rule
        (automation_rule_id, rule_id, workspace_id, enabled, params, scope, principal_id, updated_by, updated_at)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)
      ON CONFLICT (workspace_id, rule_id, COALESCE(principal_id, '${WORKSPACE_SCOPE}'::uuid)) DO UPDATE SET
        enabled = excluded.enabled,
        params = excluded.params,
        scope = excluded.scope,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at
      RETURNING *
    `, [
      row.automationRuleId, row.ruleId, row.workspaceId, row.enabled, JSON.stringify(row.params),
      row.scope, row.principalId, row.updatedBy, row.updatedAt,
    ])
    return toSettings(rows[0]!)
  }

  /** The workspace member's role (settings API admin gate; DATA-MODEL §5.16 opt-out). */
  async memberRole(workspaceId: string, principalId: string): Promise<string | null> {
    const rows = await this.database.unsafe<Array<{ role: string }>>(
      `SELECT role FROM ${this.prefix}workspace_member WHERE workspace_id = $1 AND principal_id = $2 LIMIT 1`,
      [workspaceId, principalId],
    )
    return rows[0]?.role ?? null
  }
}