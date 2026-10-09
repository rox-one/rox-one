/**
 * W1-11 (#1508) — Rate-limit middleware (TECH-SPEC §13.2 step 6, §13.8;
 * DATA-MODEL §5.14).
 *
 * Two callers share the same token buckets:
 * - an **agent** command spends from `(agent, scope)` and `(agent, '*')`
 *   between the policy preflight (steps 1–5) and the approval gate (7–9), so a
 *   parked approval never spends a second token when it is later executed —
 *   the token was spent when the agent asked;
 * - a **rule** or scheduled action spends from `(rule:*, '*')`, which is the
 *   `createSubjectRateLimitMiddleware` below.
 *
 * A limit hit returns `RATE_LIMITED {retryAfter}` and the audit middleware
 * writes the `rate_limited` row at the terminal decision (§13.8, §5.13).
 */

import type { CommandMiddleware, CommandPipelineContext } from '../pipeline.ts'
import { rejectedReceipt, type CommandReceipt } from '../receipt.ts'
import { AGGREGATE_SCOPE, type RateLimitSpend } from '../../agents/governance.ts'
import { spendRateLimit } from '../../agents/policy.ts'
import {
  AGENT_RATE_LIMIT_MIDDLEWARE_NAME,
  GOVERNANCE_DECISION_STATE,
  GOVERNANCE_PREFLIGHT_STATE,
  GOVERNANCE_TRACE_STATE,
  preflightOf,
  type PolicyGovernanceDeps,
} from './policy.ts'

export const SUBJECT_RATE_LIMIT_MIDDLEWARE_NAME = 'subject-rate-limit'

/** Step 6 for an agent command. */
export function createAgentRateLimitMiddleware(deps: PolicyGovernanceDeps): CommandMiddleware {
  return {
    name: AGENT_RATE_LIMIT_MIDDLEWARE_NAME,
    async run(ctx: CommandPipelineContext, next: () => Promise<CommandReceipt>): Promise<CommandReceipt> {
      if (!deps.isEnabled()) return next()
      const state = preflightOf(ctx)
      if (!state) return next()
      const rated = await spendRateLimit(state, deps.ports)
      if (!rated.allowed) {
        const decision = rated.decision
        if (!decision) return next()
        ctx.state.set(GOVERNANCE_TRACE_STATE, [...rated.trace])
        ctx.state.set(GOVERNANCE_DECISION_STATE, decision)
        return rejectedReceipt(ctx.envelope.commandId, 'RATE_LIMITED', `Rate limit reached; retry in ${decision.retryAfter}s`, {
          retryAfter: decision.retryAfter,
          window: decision.window,
          bucketScope: decision.bucketScope,
        })
      }
      ctx.state.set(GOVERNANCE_PREFLIGHT_STATE, { ...state, trace: rated.trace })
      ctx.state.set(GOVERNANCE_TRACE_STATE, [...rated.trace])
      return next()
    },
  }
}

/** Non-agent subjects (the rule engine, imports) spend from their own buckets. */
export interface SubjectRateLimitDeps {
  isEnabled(): boolean
  /** The bucket subject, e.g. `rule:*` (`RULE_ALL_SUBJECT`). */
  subject(ctx: CommandPipelineContext): string
  /** The scope the command counts against, e.g. `*` (DATA-MODEL §5.14). */
  scope(ctx: CommandPipelineContext): string
  rateLimit(spend: RateLimitSpend): Promise<{ allowed: true } | { allowed: false; window: string; retryAfter: number }>
}

/**
 * Step 6 for a non-agent subject. Kept separate from the agent middleware so
 * the agent path has exactly one bucket spend per command.
 */
export function createSubjectRateLimitMiddleware(deps: SubjectRateLimitDeps): CommandMiddleware {
  return {
    name: SUBJECT_RATE_LIMIT_MIDDLEWARE_NAME,
    async run(ctx: CommandPipelineContext, next: () => Promise<CommandReceipt>): Promise<CommandReceipt> {
      if (!deps.isEnabled()) return next()
      const decision = await deps.rateLimit({
        workspaceId: ctx.workspaceId,
        subject: deps.subject(ctx),
        scope: deps.scope(ctx) || AGGREGATE_SCOPE,
        cost: 1,
      })
      if (!decision.allowed) {
        return rejectedReceipt(ctx.envelope.commandId, 'RATE_LIMITED', `Rate limit reached; retry in ${decision.retryAfter}s`, {
          retryAfter: decision.retryAfter,
          window: decision.window,
        })
      }
      return next()
    },
  }
}