/**
 * W1-11 (#1508) — Policy middleware: the agent pipeline as bus middleware
 * (TECH-SPEC §13.2 steps 1–5 and 7–9, PLAN §3 W1-11).
 *
 * The executor's middleware chain (`packages/server-core/src/commands/executor.ts`)
 * is koa-style: the first `use`d middleware runs outermost. The governance
 * chain is therefore installed as
 *
 * ```ts
 * executor.use(createAuditMiddleware(...))          // 10 — observes the receipt
 * executor.use(createAgentPolicyMiddleware(...))    // 1–5
 * executor.use(createAgentRateLimitMiddleware(...)) // 6
 * executor.use(createApprovalGateMiddleware(...))   // 7–9
 * ```
 *
 * (`createAgentGovernanceChain` in `./index.ts` returns exactly that array.)
 * Every step appends its name to `ctx.state` under `GOVERNANCE_TRACE_STATE`, so
 * the integration test can assert that a reference agent tool call walked all
 * ten steps in order, and the audit middleware copies the trace into the row.
 *
 * **Inert when off.** `isEnabled` is this packcage's flag switch
 * (`agents.autonomy.v1`); with it off, and for every non-agent command, the
 * middleware calls `next()` without touching a port — no reads, no writes.
 *
 * A port failure propagates: the executor classifies a transient store error
 * as retryable (`CommandStoreUnavailable`, HTTP 503, the outbox retries) and
 * anything else as the terminal INTERNAL receipt.
 */

import type { CommandMiddleware, CommandPipelineContext } from '../pipeline.ts'
import type { CommandActor } from '../registry.ts'
import { rejectedReceipt, type CommandReceipt } from '../receipt.ts'
import type { AgentPermissionMode, ContainerRef } from '../../agents/governance.ts'
import {
  evaluateApprovalGate,
  evaluatePreflight,
  spendRateLimit,
  type ApprovalGatePorts,
  type PolicyDecision,
  type PolicyPorts,
  type PolicyPreflight,
  type PolicyRequest,
  type RateLimitPort,
} from '../../agents/policy.ts'

/** Where the walked steps live in `ctx.state`. */
export const GOVERNANCE_TRACE_STATE = 'agents.policy.trace'
/** The preflight result the gate and the audit middleware read. */
export const GOVERNANCE_PREFLIGHT_STATE = 'agents.policy.preflight'
/** The final decision (allowance / ask / denial / rate limit) once known. */
export const GOVERNANCE_DECISION_STATE = 'agents.policy.decision'

export const AGENT_POLICY_MIDDLEWARE_NAME = 'agent-policy'
export const AGENT_RATE_LIMIT_MIDDLEWARE_NAME = 'agent-rate-limit'
export const AGENT_APPROVAL_GATE_MIDDLEWARE_NAME = 'agent-approval-gate'

/** Every port the governance phases need, as one injectable object. */
export type PolicyGovernancePorts = PolicyPorts & RateLimitPort & ApprovalGatePorts

/** What the host supplies so the middleware can build a `PolicyRequest`. */
export interface ActionContext {
  container?: ContainerRef
  kinds?: readonly string[]
  ownerDm?: boolean
}

export interface PolicyGovernanceDeps {
  /** The `agents.autonomy.v1` switch; off → the chain is a pass-through. */
  isEnabled(): boolean
  now(): Date
  ports: PolicyGovernancePorts
  /** The acting owner's session permission mode (`ask` by default). */
  permissionMode(ctx: CommandPipelineContext): AgentPermissionMode
  /** Chat / list / calendar metadata the grants and approvals select on. */
  actionContext(ctx: CommandPipelineContext): ActionContext
}

/** The steps walked so far for this command (empty for a human command). */
export function governanceTrace(ctx: CommandPipelineContext): string[] {
  const trace = ctx.state.get(GOVERNANCE_TRACE_STATE)
  return Array.isArray(trace) ? (trace as string[]) : []
}

/** The preflight state, when the policy middleware admitted the command. */
export function preflightOf(ctx: CommandPipelineContext): PolicyPreflight | null {
  const value = ctx.state.get(GOVERNANCE_PREFLIGHT_STATE)
  if (!value || typeof value !== 'object') return null
  return value as PolicyPreflight
}

/** The final governance decision, when one was reached. */
export function governanceDecision(ctx: CommandPipelineContext): PolicyDecision | null {
  const value = ctx.state.get(GOVERNANCE_DECISION_STATE)
  if (!value || typeof value !== 'object') return null
  return value as PolicyDecision
}

function record(ctx: CommandPipelineContext, steps: readonly string[]): void {
  ctx.state.set(GOVERNANCE_TRACE_STATE, [...steps])
}

function decide(ctx: CommandPipelineContext, decision: PolicyDecision, steps: readonly string[]): CommandReceipt {
  record(ctx, steps)
  ctx.state.set(GOVERNANCE_DECISION_STATE, decision)
  if (decision.outcome === 'auto') return rejectedReceipt(ctx.envelope.commandId, 'INTERNAL', 'unreachable: auto decisions execute')
  return stalledReceipt(ctx, decision)
}

/**
 * Whether the governance pipeline applies to this command at all. It applies
 * to an **agent** command: one dispatched on behalf of a bot principal
 * (`envelope.onBehalfOf`, TECH-SPEC §3.4) or dispatched by an agent actor.
 * Human and system commands skip every stage, so an ordinary user command pays
 * nothing for having the middleware installed.
 */
export function isAgentGovernedCommand(ctx: CommandPipelineContext): boolean {
  if (ctx.envelope.onBehalfOf) return true
  return ctx.actor.kind === 'agent'
}

/** The `PolicyRequest` for this pipeline context. */
export function policyRequestFor(ctx: CommandPipelineContext, deps: PolicyGovernanceDeps): PolicyRequest {
  const action = deps.actionContext(ctx)
  const actor: CommandActor = ctx.actor
  return {
    workspaceId: ctx.workspaceId,
    envelope: ctx.envelope,
    payload: ctx.payload,
    definition: ctx.definition,
    actor,
    permissionMode: deps.permissionMode(ctx),
    ...(action.container ? { container: action.container } : {}),
    ...(action.kinds ? { kinds: action.kinds } : {}),
    ...(action.ownerDm !== undefined ? { ownerDm: action.ownerDm } : {}),
    now: deps.now(),
  }
}

/** Steps 1–5 (kill switch, authN, scope, ACL, risk class) in front of `execute`. */
export function createAgentPolicyMiddleware(deps: PolicyGovernanceDeps): CommandMiddleware {
  return {
    name: AGENT_POLICY_MIDDLEWARE_NAME,
    async run(ctx: CommandPipelineContext, next: () => Promise<CommandReceipt>): Promise<CommandReceipt> {
      if (!deps.isEnabled() || !isAgentGovernedCommand(ctx)) return next()
      const preflight = await evaluatePreflight(policyRequestFor(ctx, deps), deps.ports)
      if (!preflight.ok) return decide(ctx, preflight.result!.decision, preflight.result!.trace)
      ctx.state.set(GOVERNANCE_PREFLIGHT_STATE, preflight.state)
      record(ctx, preflight.state!.trace)
      return next()
    },
  }
}

/** Steps 7–9 (policy mode, standing approval, execute or park). */
export function createApprovalGateMiddleware(deps: PolicyGovernanceDeps): CommandMiddleware {
  return {
    name: AGENT_APPROVAL_GATE_MIDDLEWARE_NAME,
    async run(ctx: CommandPipelineContext, next: () => Promise<CommandReceipt>): Promise<CommandReceipt> {
      if (!deps.isEnabled()) return next()
      const state = preflightOf(ctx)
      if (!state) return next()
      const gate = await evaluateApprovalGate(state, deps.ports, deps.now())
      if (gate.decision.outcome !== 'auto') return decide(ctx, gate.decision, gate.trace)
      record(ctx, gate.trace)
      ctx.state.set(GOVERNANCE_DECISION_STATE, gate.decision)
      return next()
    },
  }
}

/**
 * The receipt a stalled decision returns: `DENIED`, `RATE_LIMITED {retryAfter}`
 * or `PENDING_APPROVAL`, carrying what the session tool loop needs to resume
 * (§13.2 step 9, §13.8).
 */
export function stalledReceipt(ctx: CommandPipelineContext, decision: PolicyDecision): CommandReceipt {
  if (decision.outcome === 'deny') {
    return rejectedReceipt(ctx.envelope.commandId, 'DENIED', `Agent policy denied the command (${decision.reason})`, {
      reason: decision.reason,
      step: decision.step,
    })
  }
  if (decision.outcome === 'rate_limited') {
    return rejectedReceipt(ctx.envelope.commandId, 'RATE_LIMITED', `Rate limit reached; retry in ${decision.retryAfter}s`, {
      retryAfter: decision.retryAfter,
      window: decision.window,
      bucketScope: decision.bucketScope,
    })
  }
  if (decision.outcome === 'ask') {
    return rejectedReceipt(ctx.envelope.commandId, 'PENDING_APPROVAL', 'Waiting for the owner to approve this action', {
      approvalRequestId: decision.approvalRequest.approvalRequestId,
      expiresAt: decision.approvalRequest.expiresAt,
      riskClass: decision.riskClass,
      scope: decision.scope,
    })
  }
  return rejectedReceipt(ctx.envelope.commandId, 'DENIED', 'Agent policy denied the command')
}