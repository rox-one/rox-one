/**
 * W1-11 (#1508) — Audit log and hash chain (TECH-SPEC §13.4, DATA-MODEL §5.13).
 *
 * `audit_log` is append-only: the app role may `INSERT` and `SELECT` only, and
 * every row carries `hash = sha256(prev_hash ‖ canonical_json(row without
 * hash))`, chained per workspace. One row is written at every terminal
 * decision of the policy pipeline (`executed`, `proposed`, `denied`,
 * `rate_limited`, `failed`, `approved`, `rejected`, `expired`, `undone`).
 *
 * Local mode uses the same rows in `{configDir}/audit/audit-YYYY-MM.jsonl`
 * (`packages/server-core/src/agents/audit-log.ts`); the server stores them in
 * `audit_log`. Both call `chainAuditRow` / `verifyAuditChain` here, so a chain
 * written by one mode verifies in the other.
 *
 * Canonicalisation: keys sorted recursively, `undefined` members dropped
 * (`canonicalJson` from the command bus). `hash` is excluded by definition;
 * `seq` (the Postgres `bigserial`) is excluded so a row keeps the same hash in
 * every store, and the chain order is the array order.
 */

import { createHash } from 'node:crypto'
import { canonicalJson, type CommandOrigin } from '../commands/envelope.ts'
import type { RiskClass } from '../commands/registry.ts'

export const AUDIT_HASH_ALGORITHM = 'sha256'

/** `audit_log.decision` (DATA-MODEL §5.13). */
export const AUDIT_DECISIONS = [
  'executed',
  'proposed',
  'approved',
  'rejected',
  'expired',
  'denied',
  'rate_limited',
  'failed',
  'undone',
] as const

export type AuditDecision = (typeof AUDIT_DECISIONS)[number]

export function isAuditDecision(value: unknown): value is AuditDecision {
  return typeof value === 'string' && (AUDIT_DECISIONS as readonly string[]).includes(value)
}

/** `audit_log.actor_kind`. */
export const AUDIT_ACTOR_KINDS = ['human', 'bot', 'system', 'rule'] as const
export type AuditActorKind = (typeof AUDIT_ACTOR_KINDS)[number]

export function isAuditActorKind(value: unknown): value is AuditActorKind {
  return typeof value === 'string' && (AUDIT_ACTOR_KINDS as readonly string[]).includes(value)
}

/** Retention default per workspace policy (§5.13). */
export const AUDIT_RETENTION_DAYS = 400

/** How the action was triggered; maps onto the `origin` of the envelope. */
export type AuditTrigger = 'mention' | 'dm' | 'rule' | 'schedule' | 'ui' | 'invite'

export interface AuditProvenance {
  session_id?: string
  message_ref?: string
  trigger?: AuditTrigger
  model?: string
  tool_call_id?: string
  source_event_id?: string
  /** Rule id for `trigger: 'rule'` (`R1`…`R5`). */
  rule_id?: string
  /** Panel surface for `trigger: 'ui'` (§18.2). */
  surface?: string
  /** `http` | `ws-rpc` | `local` — where the command entered the system. */
  transport?: string
}

/** `audit_log` row without the chain fields. */
export interface AuditRowInput {
  auditId: string
  workspaceId: string
  actorPrincipalId: string
  actorKind: AuditActorKind
  /** Owner principal for agent actions; inviter for rule actions. */
  onBehalfOf?: string | null
  commandType: string
  /** `kind:id` (after execution, the created ref). */
  targetRef?: string | null
  decision: AuditDecision
  riskClass: RiskClass
  approvalRequestId?: string | null
  ruleExecutionId?: string | null
  provenance: AuditProvenance
  /** Hex sha256 of the canonical command request (`request_hash bytea`). */
  requestHash: string
  receipt?: unknown
  error?: string | null
  createdAt: string
}

/** A stored row: the input plus its position in the chain. */
export interface AuditRow extends AuditRowInput {
  /** Postgres `bigserial`; absent in the local JSONL. Never part of the hash. */
  seq?: number
  prevHash: string | null
  hash: string
}

/** sha256 hex of a string. */
function sha256Hex(value: string): string {
  return createHash(AUDIT_HASH_ALGORITHM).update(value).digest('hex')
}

/**
 * The exact bytes that are hashed for a row: canonical JSON of every field
 * except `hash` (and `seq`, which the store assigns).
 */
export function auditRowContent(row: AuditRowInput): string {
  return canonicalJson({
    auditId: row.auditId,
    workspaceId: row.workspaceId,
    actorPrincipalId: row.actorPrincipalId,
    actorKind: row.actorKind,
    onBehalfOf: row.onBehalfOf ?? null,
    commandType: row.commandType,
    targetRef: row.targetRef ?? null,
    decision: row.decision,
    riskClass: row.riskClass,
    approvalRequestId: row.approvalRequestId ?? null,
    ruleExecutionId: row.ruleExecutionId ?? null,
    provenance: row.provenance ?? {},
    requestHash: row.requestHash,
    receipt: row.receipt ?? null,
    error: row.error ?? null,
    createdAt: row.createdAt,
  })
}

/** `sha256(prev_hash ‖ canonical row)`; the first row of a chain has no previous hash. */
export function auditRowHash(previousHash: string | null, row: AuditRowInput): string {
  return sha256Hex(`${previousHash ?? ''}${auditRowContent(row)}`)
}

/** Append one row to a chain: fills `prevHash` / `hash` (and `seq` when the caller knows it). */
export function chainAuditRow(previous: Pick<AuditRow, 'hash'> | null | undefined, row: AuditRowInput, seq?: number): AuditRow {
  const prevHash = previous?.hash ?? null
  const chained: AuditRow = { ...row, prevHash, hash: auditRowHash(prevHash, row) }
  if (seq !== undefined) chained.seq = seq
  return chained
}

export type AuditChainBreak =
  | { reason: 'hash_mismatch'; index: number; auditId: string; seq?: number }
  | { reason: 'prev_mismatch'; index: number; auditId: string; seq?: number }

export interface AuditChainVerification {
  ok: boolean
  rows: number
  /** First row that does not verify, when `ok` is false. */
  brokenAt?: AuditChainBreak
}

/**
 * Verify a whole chain in order. A tampered row fails at that row (its hash no
 * longer matches its content) and also breaks the `prev_hash` link of its
 * successor, so `brokenAt` points at the first damaged row.
 */
export function verifyAuditChain(rows: readonly AuditRow[]): AuditChainVerification {
  let previous: AuditRow | null = null
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] as AuditRow
    const expectedPrev = previous?.hash ?? null
    if ((row.prevHash ?? null) !== expectedPrev) {
      return { ok: false, rows: rows.length, brokenAt: { reason: 'prev_mismatch', index, auditId: row.auditId, ...(row.seq !== undefined ? { seq: row.seq } : {}) } }
    }
    const { hash, prevHash: _prevHash, seq: _seq, ...content } = row
    const expectedHash = sha256Hex(`${expectedPrev ?? ''}${auditRowContent(content)}`)
    if (hash !== expectedHash) {
      return { ok: false, rows: rows.length, brokenAt: { reason: 'hash_mismatch', index, auditId: row.auditId, ...(row.seq !== undefined ? { seq: row.seq } : {}) } }
    }
    previous = row
  }
  return { ok: true, rows: rows.length }
}

/**
 * Provenance of a command from its envelope origin (§12, §18.2, §13.7). The
 * origin decides *how* the action was triggered; it never changes the risk
 * class, the approval mode or the limits.
 */
export function auditProvenanceFromOrigin(origin: CommandOrigin | undefined, extra: AuditProvenance = {}): AuditProvenance {
  if (!origin) return { ...extra }
  // `EntityRef.kind` overlaps the structural origins (`comment`, `message`),
  // so narrow by the distinguishing fields rather than by `kind`.
  if ('commentId' in origin) return { ...extra, trigger: 'mention', message_ref: origin.commentId }
  if ('sessionId' in origin) {
    return {
      ...extra,
      trigger: 'ui',
      session_id: origin.sessionId,
      ...(origin.messageId ? { message_ref: origin.messageId } : {}),
      ...(origin.surface ? { surface: origin.surface } : {}),
    }
  }
  if ('sessionRef' in origin) {
    return { ...extra, trigger: 'mention', session_id: origin.sessionRef, ...(origin.messageRef ? { message_ref: origin.messageRef } : {}) }
  }
  if ('blockId' in origin) return { ...extra, message_ref: `${origin.docRef}#${origin.blockId}` }
  if ('seq' in origin) return { ...extra, trigger: 'mention', message_ref: `${origin.chatRef}#${origin.seq}` }
  // A plain `EntityRef` origin (the `derived-from` entity).
  return { ...extra, message_ref: `${origin.kind}:${origin.id}` }
}

/** Request hash of a command envelope (`audit_log.request_hash`). */
export function auditRequestHash(canonicalRequest: string): string {
  return sha256Hex(canonicalRequest)
}