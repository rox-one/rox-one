/**
 * W1-11 (#1508) — Audit middleware: step 10 of TECH-SPEC §13.2 (the audit row
 * at every terminal decision; TECH-SPEC §13.4, DATA-MODEL §5.13).
 *
 * The middleware is installed **outermost** in the governance chain, so it
 * observes the receipt whether the command executed, was parked for approval,
 * was denied by the policy, hit a rate limit or failed inside the handler. It
 * is the only writer of `audit_log` on the agent path; the chain itself
 * (`chainAuditRow` / `verifyAuditChain`) lives in `@rox/core/agents/audit`.
 *
 * Decision mapping (DATA-MODEL §5.13):
 * - `auto` → the terminal receipt decides: `executed` when the effect exists
 *   (`applied`), `failed` for a rejected receipt;
 * - `ask` → `proposed` (the approval request is the park);
 * - `deny` → `denied`; `rate_limited` → `rate_limited`;
 * - a receipt of `duplicate` is not audited here: the executor answers an
 *   idempotent replay before any middleware runs, and the original attempt
 *   already wrote its row.
 *
 * Human commands are not audited by this middleware: DATA-MODEL §5.13 keeps
 * ordinary human edits in `domain_event`. A human *decision* on an approval
 * request is audited by the handler that applies it (`agents.decide_approval`).
 */

import type { CommandMiddleware, CommandPipelineContext } from '../pipeline.ts'
import type { CommandReceipt } from '../receipt.ts'
import { auditProvenanceFromOrigin, type AuditDecision, type AuditRowInput } from '../../agents/audit.ts'
import type { RiskClass } from '../registry.ts'
import { policyRiskClass } from '../../agents/policy.ts'
import { governanceDecision, governanceTrace, isAgentGovernedCommand, GOVERNANCE_TRACE_STATE, type PolicyGovernanceDeps } from './policy.ts'

export const AUDIT_MIDDLEWARE_NAME = 'agent-audit'

/** Where the audit row is left in `ctx.state` after the decision. */
export const GOVERNANCE_AUDIT_STATE = 'agents.policy.audit'

/** The audit writer port: the server appends to `audit_log`, local mode to JSONL. */
export interface AuditWriter {
  /** Append one row to the workspace chain and return it (with its hash). */
  append(row: AuditRowInput): Promise<{ prevHash: string | null; hash: string; seq?: number }>
}

export interface AuditMiddlewareDeps extends Pick<PolicyGovernanceDeps, 'isEnabled' | 'now'> {
  writer: AuditWriter
  /** `request_hash`: sha256 of the canonical command request (the executor computes it). */
  requestHash(ctx: CommandPipelineContext): string
  /** Where the command entered the system (`http`, `ws-rpc`, `local`). */
  transport?(ctx: CommandPipelineContext): string | undefined
  /** An id generator (`randomUUID` in Bun/Node/Electron). */
  newAuditId?(): string
}

/** Terminal decision of a receipt + the governance decision that led to it. */
export function auditDecisionFor(ctx: CommandPipelineContext, receipt: CommandReceipt): AuditDecision {
  const decision = governanceDecision(ctx)
  if (decision?.outcome === 'ask') return 'proposed'
  if (decision?.outcome === 'deny') return 'denied'
  if (decision?.outcome === 'rate_limited') return 'rate_limited'
  if (receipt.status === 'applied') return 'executed'
  if (receipt.status === 'duplicate') return 'executed'
  return 'failed'
}

function auditIdFrom(deps: AuditMiddlewareDeps): string {
  if (deps.newAuditId) return deps.newAuditId()
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID()
  return `audit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

/** The `audit_log` row of one terminal decision. */
export function auditRowFor(ctx: CommandPipelineContext, receipt: CommandReceipt, deps: AuditMiddlewareDeps): AuditRowInput {
  const decision = governanceDecision(ctx)
  const riskClass: RiskClass = decision?.riskClass
    ?? policyRiskClass({ definition: ctx.definition, payload: ctx.payload, actor: ctx.actor, workspaceId: ctx.workspaceId, envelope: ctx.envelope })
  const agentPrincipalId = typeof ctx.envelope.onBehalfOf === 'string'
    ? ctx.envelope.onBehalfOf
    : ctx.actor.principalId
  const onBehalfOf = ctx.envelope.onBehalfOf ? ctx.actor.principalId : null
  const transport = deps.transport?.(ctx)
  const approvalRequestId = decision?.outcome === 'ask' ? decision.approvalRequest.approvalRequestId : null
  const targetRef = receipt.ref ? `${receipt.ref.kind}:${receipt.ref.id}` : ctx.envelope.target ? `${ctx.envelope.target.kind}:${ctx.envelope.target.id}` : null
  const row: AuditRowInput = {
    auditId: auditIdFrom(deps),
    workspaceId: ctx.workspaceId,
    actorPrincipalId: agentPrincipalId,
    actorKind: 'bot',
    onBehalfOf,
    commandType: ctx.envelope.type,
    targetRef,
    decision: auditDecisionFor(ctx, receipt),
    riskClass,
    approvalRequestId,
    provenance: auditProvenanceFromOrigin(ctx.envelope.origin, transport ? { transport } : {}),
    requestHash: deps.requestHash(ctx),
    receipt,
    error: receipt.error ? `${receipt.error.code}: ${receipt.error.message}` : null,
    createdAt: deps.now().toISOString(),
  }
  return row
}

/**
 * Step 10: append the audit row after the inner chain returns. A writer
 * failure never changes the receipt — the effect is already committed, and the
 * host's writer reports its own failure (the executor's `onStoreError`) so the
 * row can be re-derived from `command_receipt` and `domain_event`.
 */
export function createAuditMiddleware(deps: AuditMiddlewareDeps): CommandMiddleware {
  return {
    name: AUDIT_MIDDLEWARE_NAME,
    async run(ctx: CommandPipelineContext, next: () => Promise<CommandReceipt>): Promise<CommandReceipt> {
      if (!deps.isEnabled() || !isAgentGovernedCommand(ctx)) return next()
      const receipt = await next()
      const row = auditRowFor(ctx, receipt, deps)
      const stored = await deps.writer.append(row)
      ctx.state.set(GOVERNANCE_TRACE_STATE, [...governanceTrace(ctx), 'audit'])
      ctx.state.set(GOVERNANCE_AUDIT_STATE, { ...row, ...stored })
      return receipt
    },
  }
}