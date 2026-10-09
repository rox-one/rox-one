/**
 * W1-11 (#1508) — Workspace-mode audit log: the `audit_log` table
 * (`14-agent-governance.sql`, DATA-MODEL §5.13).
 *
 * The chain is per workspace and serialised by a per-workspace advisory lock,
 * exactly as §13.4 requires: `hash = sha256(prev_hash ‖ canonical_json(row))`,
 * the first row of a workspace has no `prev_hash`, and the app role holds
 * `INSERT` + `SELECT` only (the migration grants that; nothing here updates or
 * deletes a row).
 *
 * The canonical row, the hash and the verifier come from `@rox/core/agents`, so
 * a chain written here verifies against a local JSONL chain and vice versa.
 */

import type { SQL, TransactionSQL } from 'bun'
import { auditRowHash, verifyAuditChain, type AuditChainVerification, type AuditRow, type AuditRowInput } from '@rox/core/agents'

type Database = SQL | TransactionSQL

/** `audit_log` as the DDL declares it (the columns this module writes). */
export interface AuditLogRow {
  seq: string
  audit_id: string
  workspace_id: string
  actor_principal_id: string
  actor_kind: string
  on_behalf_of: string | null
  command_type: string
  target_ref: string | null
  decision: string
  risk_class: string
  approval_request_id: string | null
  rule_execution_id: string | null
  provenance: unknown
  request_hash: string
  receipt: unknown
  error: string | null
  prev_hash: string | null
  hash: string
  created_at: Date | string
}

export interface PostgresAuditLogOptions {
  database: SQL
  /** Postgres schema that holds the W1-05 tables (defaults to `public`). */
  schema?: string
}

function quoted(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}

function toBuffer(value: string): Uint8Array {
  // The `*_hash` columns are `bytea` holding the raw digest; the value is a hex
  // string, so the write decodes it exactly the way `toHex` re-encodes it.
  // (UTF-8 encoding here would double the hex on read and break `verify`.)
  return Buffer.from(value, 'hex')
}

function toHex(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (value instanceof Uint8Array) return Buffer.from(value).toString('hex')
  return String(value)
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value
}

/**
 * Appender + verifier over `audit_log`. One instance per service; the writes
 * are serialised by the database (advisory lock), not by the instance, so
 * several workspace-service replicas can append safely.
 */
export class PostgresAuditLog {
  private readonly database: SQL
  private readonly prefix: string

  constructor(options: PostgresAuditLogOptions) {
    this.database = options.database
    this.prefix = options.schema ? `${quoted(options.schema)}.` : ''
  }

  private get table(): string {
    return `${this.prefix}audit_log`
  }

  /**
   * Append one row inside its own transaction: lock the workspace chain, read
   * the tip, chain the row, insert. Returns the stored chain link.
   */
  async append(row: AuditRowInput): Promise<{ prevHash: string | null; hash: string; seq?: number }> {
    const result = await this.database.begin(async (tx: TransactionSQL) => {
      const locked = await tx.unsafe(`SELECT pg_advisory_xact_lock(hashtext($1)) AS locked`, [row.workspaceId])
      void locked
      const tip = await tx.unsafe(`SELECT hash FROM ${this.table} WHERE workspace_id = $1 ORDER BY seq DESC LIMIT 1`, [row.workspaceId])
      const tipRow = (tip as unknown as Array<{ hash: unknown }>)[0]
      const prevHash = tipRow ? toHex(tipRow.hash) : null
      const hash = auditRowHash(prevHash, row)
      const inserted = await tx.unsafe(
        `INSERT INTO ${this.table} (audit_id, workspace_id, actor_principal_id, actor_kind, on_behalf_of, command_type,
           target_ref, decision, risk_class, approval_request_id, rule_execution_id, provenance, request_hash, receipt,
           error, prev_hash, hash, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14::jsonb, $15, $16, $17, $18)
         RETURNING seq`,
        [
          row.auditId,
          row.workspaceId,
          row.actorPrincipalId,
          row.actorKind,
          row.onBehalfOf ?? null,
          row.commandType,
          row.targetRef ?? null,
          row.decision,
          row.riskClass,
          row.approvalRequestId ?? null,
          row.ruleExecutionId ?? null,
          JSON.stringify(row.provenance ?? {}),
          toBuffer(row.requestHash),
          row.receipt === undefined ? null : JSON.stringify(row.receipt),
          row.error ?? null,
          prevHash === null ? null : toBuffer(prevHash),
          toBuffer(hash),
          row.createdAt,
        ],
      )
      const sequence = (inserted as unknown as Array<{ seq: string }>)[0]?.seq
      return { prevHash, hash, ...(sequence === undefined ? {} : { seq: Number(sequence) }) }
    })
    return result as { prevHash: string | null; hash: string; seq?: number }
  }

  /** Every row of one workspace, in chain order (oldest first). */
  async read(workspaceId: string, limit = 10_000): Promise<AuditRow[]> {
    const rows = await this.database.unsafe(
      `SELECT * FROM ${this.table} WHERE workspace_id = $1 ORDER BY seq ASC LIMIT $2`,
      [workspaceId, limit],
    )
    return (rows as unknown as AuditLogRow[]).map(mapRow)
  }

  /** Verify one workspace's chain; `brokenAt` names the first damaged row. */
  async verify(workspaceId: string, limit = 10_000): Promise<AuditChainVerification> {
    return verifyAuditChain(await this.read(workspaceId, limit))
  }
}

/** Map a stored row onto the shared `AuditRow` shape. */
export function mapRow(row: AuditLogRow): AuditRow {
  return {
    auditId: row.audit_id,
    workspaceId: row.workspace_id,
    actorPrincipalId: row.actor_principal_id,
    actorKind: row.actor_kind as AuditRow['actorKind'],
    onBehalfOf: row.on_behalf_of,
    commandType: row.command_type,
    targetRef: row.target_ref,
    decision: row.decision as AuditRow['decision'],
    riskClass: row.risk_class as AuditRow['riskClass'],
    approvalRequestId: row.approval_request_id,
    ruleExecutionId: row.rule_execution_id,
    provenance: (row.provenance ?? {}) as AuditRow['provenance'],
    requestHash: toHex(row.request_hash),
    receipt: row.receipt ?? undefined,
    error: row.error,
    createdAt: iso(row.created_at),
    seq: Number(row.seq),
    prevHash: row.prev_hash === null ? null : toHex(row.prev_hash),
    hash: toHex(row.hash),
  }
}

/** An `AuditWriter` over the table, for `@rox/core/commands` middleware. */
export function auditWriterOf(log: PostgresAuditLog): { append(row: AuditRowInput): Promise<{ prevHash: string | null; hash: string; seq?: number }> } {
  return { append: row => log.append(row) }
}

export type { Database }