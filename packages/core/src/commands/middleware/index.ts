/**
 * W1-11 (#1508) — The governance middleware chain, ready to install on a
 * `CommandExecutor` (TECH-SPEC §13.2, PLAN §3 W1-11).
 *
 * ```ts
 * for (const middleware of createAgentGovernanceChain({ policy, audit })) {
 *   executor.use(middleware)
 * }
 * ```
 *
 * Installation order is part of the contract: the audit middleware is first so
 * it wraps the whole pipeline and sees the terminal receipt (step 10); the
 * policy middleware runs steps 1–5 and calls `next()`; the rate-limit
 * middleware spends step 6's tokens; the approval gate decides steps 7–9 and
 * either lets the terminal `execute` run or parks the command. See
 * `./policy.ts` for why the order matters.
 */

import type { CommandMiddleware } from '../pipeline.ts'
import { createAuditMiddleware, type AuditMiddlewareDeps } from './audit.ts'
import { createAgentPolicyMiddleware, createApprovalGateMiddleware, type PolicyGovernanceDeps } from './policy.ts'
import { createAgentRateLimitMiddleware } from './ratelimit.ts'

export interface GovernanceChainDeps {
  policy: PolicyGovernanceDeps
  audit: AuditMiddlewareDeps
}

/** `[audit, policy, rate-limit, approval-gate]` — `use` them in this order. */
export function createAgentGovernanceChain(deps: GovernanceChainDeps): CommandMiddleware[] {
  return [
    createAuditMiddleware(deps.audit),
    createAgentPolicyMiddleware(deps.policy),
    createAgentRateLimitMiddleware(deps.policy),
    createApprovalGateMiddleware(deps.policy),
  ]
}

export {
  AUDIT_MIDDLEWARE_NAME,
  GOVERNANCE_AUDIT_STATE,
  auditDecisionFor,
  auditRowFor,
  createAuditMiddleware,
  type AuditMiddlewareDeps,
  type AuditWriter,
} from './audit.ts'

export {
  AGENT_APPROVAL_GATE_MIDDLEWARE_NAME,
  AGENT_POLICY_MIDDLEWARE_NAME,
  AGENT_RATE_LIMIT_MIDDLEWARE_NAME,
  GOVERNANCE_DECISION_STATE,
  GOVERNANCE_PREFLIGHT_STATE,
  GOVERNANCE_TRACE_STATE,
  createAgentPolicyMiddleware,
  createApprovalGateMiddleware,
  governanceDecision,
  governanceTrace,
  isAgentGovernedCommand,
  policyRequestFor,
  preflightOf,
  stalledReceipt,
  type ActionContext,
  type PolicyGovernanceDeps,
  type PolicyGovernancePorts,
} from './policy.ts'

export {
  SUBJECT_RATE_LIMIT_MIDDLEWARE_NAME,
  createAgentRateLimitMiddleware,
  createSubjectRateLimitMiddleware,
  type SubjectRateLimitDeps,
} from './ratelimit.ts'