/**
 * W1-11 (#1508) — The agent policy pipeline (TECH-SPEC §13.2, PLAN §3 W1-11).
 *
 * One ordered evaluation per command, run as command-bus middleware between
 * `authorize` and `execute`:
 *
 * ```
 *  1 kill switch   agent_binding.status='paused' / workspace "pause all agents" → DENIED
 *  2 authN         the envelope names an agent of this workspace, owned by the actor
 *  3 scope         command type ∈ agent_grant scopes (selector matches container/kind)
 *  4 ACL           acl.can(owner, target, verb) AND acl.can(agent, target, verb)
 *  5 risk class    command.riskClass(payload, context) — computed by the definition
 *  6 rate limit    token buckets for (agent, scope) and (agent, '*')
 *  7 policy mode   workspace_floor ⊓ approval_policy.rules[scope, risk] → auto|ask|deny
 *  8 standing      mode=ask and risk≠privileged and a live standing_approval matches → auto
 *  9 execute/park  auto: dispatch; ask: create approval_request and PENDING_APPROVAL
 * 10 audit         one audit_log row at every terminal decision (the audit middleware)
 * ```
 *
 * The pipeline is split into the three phases the bus composes as middleware
 * (`packages/core/src/commands/middleware/{policy,ratelimit,audit}.ts`), so the
 * steps run in exactly this order in the live bus:
 *
 * | phase | steps | function |
 * |---|---|---|
 * | preflight | 1–5 | `evaluatePreflight` |
 * | rate limit | 6 | `spendRateLimit` |
 * | gate | 7–9 | `evaluateApprovalGate` |
 * | audit | 10 | the audit middleware |
 *
 * `evaluatePolicy` runs all three phases in order for callers that need the
 * whole decision in one call (the policy matrix, a tool-catalogue pre-check).
 * Apart from the injected `PolicyPorts` the code is pure, so the whole matrix
 * (scope × risk × mode × standing × floor) is testable without a store.
 *
 * The command **origin** (§12, §18.2) never reaches the classifier: an
 * `{kind:'agent-panel'}` proposal runs through exactly the same risk classes,
 * approvals and limits as a mention or a DM (§18.2 "Risk classes, approvals,
 * rate limits, audit and readback are unchanged").
 */

import type { EntityRef } from '../entities/refs.ts'
import type { Authorizer } from '../commands/authorizer.ts'
import type { CommandEnvelope } from '../commands/envelope.ts'
import type { CommandActor, CommandDefinition, RiskClass } from '../commands/registry.ts'
import {
  agentRateLimitSubject,
  grantMatches,
  policyModeFor,
  rateLimitScopesFor,
  standingApprovalMatches,
  type AgentBinding,
  type AgentGrant,
  type AgentPermissionMode,
  type AgentScope,
  type ApprovalMode,
  type ApprovalPolicy,
  type ApprovalRequest,
  type ContainerRef,
  type RateLimitDecision,
  type RateLimitSpend,
  type RateLimitWindow,
  type StandingApproval,
} from './governance.ts'
import { isRiskClass, riskClassFor, scopeForCommand } from './risk.ts'

/** The ten steps, in order. The policy trace and the integration test use them. */
export const POLICY_STEPS = [
  'kill_switch',
  'authn',
  'scope',
  'acl',
  'risk_class',
  'rate_limit',
  'policy_mode',
  'standing',
  'execute_or_park',
  'audit',
] as const

export type PolicyStep = (typeof POLICY_STEPS)[number]

/** Why a command was denied before execution (steps 1–5 and step 7). */
export type PolicyDenyReason =
  | 'not_an_agent'
  | 'agent_paused'
  | 'agent_revoked'
  | 'all_agents_paused'
  | 'authn_failed'
  | 'not_agent_reachable'
  | 'scope_not_granted'
  | 'acl_denied'
  | 'policy_denied'

export interface PolicyRequest {
  workspaceId: string
  envelope: CommandEnvelope<unknown>
  /** Payload after schema validation. */
  payload: unknown
  definition: CommandDefinition<unknown>
  /** The authenticated actor (the owner when the envelope carries `onBehalfOf`). */
  actor: CommandActor
  /** The owner's session permission mode (`ask` by default). */
  permissionMode: AgentPermissionMode
  /** Container of the action: the chat / list / calendar the command happens in. */
  container?: ContainerRef
  /** Target kinds, for grant and standing-approval selectors. */
  kinds?: readonly string[]
  /**
   * The command happens in the owner's own DM with its agent (§5.14
   * `im:send_owner_dm`). Set by the caller from the chat metadata, never
   * guessed from the payload.
   */
  ownerDm?: boolean
  now?: Date
}

export interface PolicyPorts {
  /** `agent_binding` row of the bot principal (null → not an agent of this workspace). */
  agentBinding(workspaceId: string, agentPrincipalId: string): Promise<AgentBinding | null>
  /** Step 1: workspace-wide kill switch ("pause all agents"). */
  pauseAllAgents(workspaceId: string): Promise<boolean>
  /** Step 3: active `agent_grant` rows of the agent. */
  grants(workspaceId: string, agentPrincipalId: string): Promise<readonly AgentGrant[]>
  /** Step 4: the one ACL engine (W1-04 `acl.can`, wired as the bus `Authorizer`). */
  authorizer: Authorizer
  /** Step 7: the owner's approval policy, including the admin floor. */
  approvalPolicy(workspaceId: string, ownerPrincipalId: string): Promise<ApprovalPolicy>
  /** Step 8: live `standing_approval` rows of the agent. */
  standingApprovals(workspaceId: string, agentPrincipalId: string): Promise<readonly StandingApproval[]>
  /** Step 9 (`ask`): persist the approval request the owner will decide. */
  park(request: ApprovalRequest): Promise<void>
}

/** Step 6's port: token buckets, separate because the bus runs it as its own middleware. */
export interface RateLimitPort {
  rateLimit(spend: RateLimitSpend): Promise<RateLimitDecision>
}

interface PolicyDecisionBase {
  riskClass: RiskClass | null
  scope: AgentScope | null
  /** Every step walked, in order (the integration test asserts the full list). */
  steps: readonly PolicyStep[]
}

export interface PolicyAllowance extends PolicyDecisionBase {
  outcome: 'auto'
  riskClass: RiskClass
  scope: AgentScope
  mode: 'auto'
  agentPrincipalId: string
  ownerPrincipalId: string
}

export interface PolicyAsk extends PolicyDecisionBase {
  outcome: 'ask'
  riskClass: RiskClass
  scope: AgentScope
  mode: 'ask'
  agentPrincipalId: string
  ownerPrincipalId: string
  /** The parked request; the receipt answers `PENDING_APPROVAL`. */
  approvalRequest: ApprovalRequest
}

export interface PolicyDenial extends PolicyDecisionBase {
  outcome: 'deny'
  reason: PolicyDenyReason
  step: PolicyStep
}

export interface PolicyRateLimit extends PolicyDecisionBase {
  outcome: 'rate_limited'
  riskClass: RiskClass
  scope: AgentScope
  agentPrincipalId: string
  ownerPrincipalId: string
  /** The exhausted bucket's scope (`*` for the aggregate). */
  bucketScope: string
  window: RateLimitWindow
  retryAfter: number
}

export type PolicyDecision = PolicyAllowance | PolicyAsk | PolicyDenial | PolicyRateLimit

export interface EvaluatePolicyResult {
  decision: PolicyDecision
  /** Every step walked, in order; `audit` is appended by the audit middleware. */
  trace: readonly PolicyStep[]
}

/** What the preflight phase resolved; the later phases need all of it. */
export interface PolicyPreflight {
  envelope: CommandEnvelope<unknown>
  payload: unknown
  definition: CommandDefinition<unknown>
  actor: CommandActor
  workspaceId: string
  agentPrincipalId: string
  ownerPrincipalId: string
  scope: AgentScope
  riskClass: RiskClass
  permissionMode: AgentPermissionMode
  container?: ContainerRef
  kinds?: readonly string[]
  trace: readonly PolicyStep[]
}

/** The bot principal a command acts as: `onBehalfOf`, else an `agent` actor. */
export function actingAgentPrincipalId(envelope: Pick<CommandEnvelope, 'onBehalfOf'>, actor: Pick<CommandActor, 'principalId' | 'kind'>): string | null {
  if (envelope.onBehalfOf) return envelope.onBehalfOf
  return actor.kind === 'agent' ? actor.principalId : null
}

/** The owner the agent acts for; `null` when the actor is the agent itself. */
export function actingOwnerPrincipalId(envelope: Pick<CommandEnvelope, 'onBehalfOf'>, actor: Pick<CommandActor, 'principalId' | 'kind'>): string | null {
  if (envelope.onBehalfOf) return actor.kind === 'agent' ? null : actor.principalId
  return actor.kind === 'agent' ? null : actor.principalId
}

/** Approval-card summary keys freeze the copy the owner reads (§13.3). */
export const APPROVAL_SUMMARY_KEY_PREFIX = 'agentGovernance.approval.summary.'

/** Commands whose approval card has dedicated copy (this package's own scope). */
export const APPROVAL_SUMMARY_COMMANDS: readonly string[] = [
  'agents.decide_approval',
  'agents.invoke',
  'agents.pause',
  'agents.provision_personal_agent',
  'identity.ensure_placeholder',
  'identity.merge_placeholder',
  'im.create_chat',
  'im.set_visibility',
  'people.invite',
  'workspaces.create',
]

/** A card with no dedicated copy falls back to the generic sentence. */
export function approvalSummaryKeyFor(commandType: string): string {
  return APPROVAL_SUMMARY_COMMANDS.includes(commandType)
    ? `${APPROVAL_SUMMARY_KEY_PREFIX}${commandType}`
    : `${APPROVAL_SUMMARY_KEY_PREFIX}generic`
}

/** `kind:id` of a target ref, as stored in `audit_log.target_ref`. */
export function refKey(ref: EntityRef | null | undefined): string | null {
  return ref ? `${ref.kind}:${ref.id}` : null
}

/** A denial carrying the steps walked so far. */
function deny(step: PolicyStep, reason: PolicyDenyReason, scope: AgentScope | null, riskClass: RiskClass | null, walked: PolicyStep[]): EvaluatePolicyResult {
  return { decision: { outcome: 'deny', reason, step, scope, riskClass, steps: [...walked] }, trace: [...walked] }
}

export type PreflightResult =
  | { ok: true; state: PolicyPreflight }
  | { ok: false; result: EvaluatePolicyResult }

/**
 * Steps 1–5: the agent may run at all (kill switch, authN), the command is in
 * its grants (scope), the ACL admits both owner and agent, and the definition
 * computes the risk class from the payload.
 */
export async function evaluatePreflight(request: PolicyRequest, ports: PolicyPorts): Promise<PreflightResult> {
  const now = request.now ?? new Date()
  const walked: PolicyStep[] = []
  const agentPrincipalId = actingAgentPrincipalId(request.envelope, request.actor)
  const ownerPrincipalId = actingOwnerPrincipalId(request.envelope, request.actor)

  // Step 1 — kill switch.
  if (!agentPrincipalId || !ownerPrincipalId) return { ok: false, result: deny('kill_switch', 'not_an_agent', null, null, walked) }
  const binding = await ports.agentBinding(request.workspaceId, agentPrincipalId)
  if (!binding) return { ok: false, result: deny('kill_switch', 'not_an_agent', null, null, walked) }
  if (binding.status === 'paused') return { ok: false, result: deny('kill_switch', 'agent_paused', null, null, walked) }
  if (binding.status === 'revoked') return { ok: false, result: deny('kill_switch', 'agent_revoked', null, null, walked) }
  if (await ports.pauseAllAgents(request.workspaceId)) {
    return { ok: false, result: deny('kill_switch', 'all_agents_paused', null, null, walked) }
  }
  walked.push('kill_switch')

  // Step 2 — authN: the envelope names this agent, and the agent belongs to the actor.
  const namesAgent = request.envelope.onBehalfOf === agentPrincipalId || request.actor.principalId === agentPrincipalId
  walked.push('authn')
  if (!namesAgent || binding.ownerPrincipalId !== ownerPrincipalId) {
    return { ok: false, result: deny('authn', 'authn_failed', null, null, walked) }
  }

  // Step 3 — scope: the command must be agent-reachable and covered by a live grant.
  const scope = scopeForCommand(request.definition.type, {
    verb: request.definition.verb,
    ownerDm: request.ownerDm === true,
  })
  walked.push('scope')
  if (!scope) return { ok: false, result: deny('scope', 'not_agent_reachable', null, null, walked) }
  const grants = await ports.grants(request.workspaceId, agentPrincipalId)
  const granted = grants.some(grant => grantMatches(grant, {
    scope,
    ...(request.container ? { container: request.container } : {}),
    ...(request.kinds ? { kinds: request.kinds } : {}),
  }, now))
  if (!granted) return { ok: false, result: deny('scope', 'scope_not_granted', scope, null, walked) }

  // Step 4 — ACL: the agent has the owner's rights ∩ its grants, so both sides must pass.
  const target: EntityRef | null = request.envelope.target ?? null
  const ownerAllowed = await ports.authorizer.can(
    { principalId: ownerPrincipalId, kind: 'user', workspaceId: request.workspaceId },
    request.definition.verb,
    target,
  )
  const agentAllowed = ownerAllowed && await ports.authorizer.can(
    { principalId: agentPrincipalId, kind: 'agent', onBehalfOf: ownerPrincipalId, workspaceId: request.workspaceId },
    request.definition.verb,
    target,
  )
  walked.push('acl')
  if (!agentAllowed) return { ok: false, result: deny('acl', 'acl_denied', scope, null, walked) }

  // Step 5 — risk class, computed by the command definition from the payload.
  const riskClass = policyRiskClass(request)
  walked.push('risk_class')

  return {
    ok: true,
    state: {
      envelope: request.envelope,
      payload: request.payload,
      definition: request.definition,
      actor: request.actor,
      workspaceId: request.workspaceId,
      agentPrincipalId,
      ownerPrincipalId,
      scope,
      riskClass,
      permissionMode: request.permissionMode,
      ...(request.container ? { container: request.container } : {}),
      ...(request.kinds ? { kinds: request.kinds } : {}),
      trace: [...walked],
    },
  }
}

/** Step 5 read on its own: the classifier the definition carries, with a table fallback. */
export function policyRiskClass(request: Pick<PolicyRequest, 'definition' | 'payload' | 'actor' | 'workspaceId' | 'envelope'>): RiskClass {
  const riskContext = {
    workspaceId: request.workspaceId,
    actor: request.actor,
    ...(request.envelope.target ? { target: request.envelope.target } : {}),
  }
  const computed = request.definition.riskClass(request.payload, riskContext)
  if (isRiskClass(computed)) return computed
  return riskClassFor(request.definition.type, request.definition.module, request.definition.verb)(request.payload, riskContext)
}

/** The state the rate-limit phase needs; every later phase reads the same. */
export type RateLimitState = Pick<PolicyPreflight, 'workspaceId' | 'agentPrincipalId' | 'ownerPrincipalId' | 'scope' | 'riskClass' | 'trace'>

export interface RateLimitOutcome {
  allowed: boolean
  /** Present when the command was refused; the trace inside it is complete. */
  decision?: PolicyRateLimit
  /** The steps walked, with `rate_limit` appended. */
  trace: PolicyStep[]
}

/**
 * Step 6: spend one token in the command's scope bucket and in the agent-wide
 * aggregate (`(agent, scope)` and `(agent, '*')`, DATA-MODEL §5.14). Both must
 * admit the command; the first refusal wins and reports its own window.
 */
export async function spendRateLimit(state: RateLimitState, port: RateLimitPort): Promise<RateLimitOutcome> {
  const subject = agentRateLimitSubject(state.agentPrincipalId)
  const walked: PolicyStep[] = [...state.trace, 'rate_limit']
  for (const bucketScope of rateLimitScopesFor(state.scope)) {
    const decision = await port.rateLimit({ workspaceId: state.workspaceId, subject, scope: bucketScope, cost: 1 })
    if (!decision.allowed) {
      return {
        allowed: false,
        decision: {
          outcome: 'rate_limited',
          riskClass: state.riskClass,
          scope: state.scope,
          agentPrincipalId: state.agentPrincipalId,
          ownerPrincipalId: state.ownerPrincipalId,
          bucketScope,
          window: decision.window,
          retryAfter: decision.retryAfter,
          steps: walked,
        },
        trace: walked,
      }
    }
  }
  return { allowed: true, trace: walked }
}

export interface ApprovalGatePorts {
  approvalPolicy(workspaceId: string, ownerPrincipalId: string): Promise<ApprovalPolicy>
  standingApprovals(workspaceId: string, agentPrincipalId: string): Promise<readonly StandingApproval[]>
  park(request: ApprovalRequest): Promise<void>
}

/**
 * Steps 7–9: the mode (`auto | ask | deny`) from the owner's rules and the
 * admin floor, the standing-approval shortcut (never for `privileged`), and
 * either the allowance the bus needs to execute or the parked request.
 */
export async function evaluateApprovalGate(
  state: PolicyPreflight,
  ports: ApprovalGatePorts,
  now: Date = new Date(),
): Promise<EvaluatePolicyResult> {
  const { scope, riskClass } = state

  // Step 7 — policy mode: the owner's rules ∩ the admin floor.
  const policy = await ports.approvalPolicy(state.workspaceId, state.ownerPrincipalId)
  const mode = policyModeFor({ scope, riskClass, policy, permissionMode: state.permissionMode })
  const afterMode: PolicyStep[] = [...state.trace, 'policy_mode']
  if (mode === 'deny') return deny('policy_mode', 'policy_denied', scope, riskClass, afterMode)

  // Step 8 — standing approval: turns `ask` into `auto`, never for a privileged action.
  let effective: ApprovalMode = mode
  if (mode === 'ask') {
    const standing = await ports.standingApprovals(state.workspaceId, state.agentPrincipalId)
    const matched = standing.find(candidate => standingApprovalMatches(candidate, {
      scope,
      riskClass,
      ...(state.container ? { container: state.container } : {}),
      ...(state.kinds ? { kinds: state.kinds } : {}),
    }, now))
    if (matched) effective = 'auto'
  }
  const walked: PolicyStep[] = [...afterMode, 'standing']

  // Step 9 — execute or park.
  walked.push('execute_or_park')
  if (effective === 'auto') {
    return {
      decision: {
        outcome: 'auto',
        riskClass,
        scope,
        mode: 'auto',
        agentPrincipalId: state.agentPrincipalId,
        ownerPrincipalId: state.ownerPrincipalId,
        steps: [...walked],
      },
      trace: [...walked],
    }
  }
  const createdAt = now.toISOString()
  const summaryKey = approvalSummaryKeyFor(state.definition.type)
  const approvalRequest: ApprovalRequest = {
    approvalRequestId: approvalRequestId(),
    workspaceId: state.workspaceId,
    agentPrincipalId: state.agentPrincipalId,
    ownerPrincipalId: state.ownerPrincipalId,
    // The full envelope: approval executes exactly what was previewed (§13.3).
    command: state.envelope,
    riskClass,
    summary: summaryKey,
    preview: {
      commandType: state.definition.type,
      target: refKey(state.envelope.target),
      container: state.container ?? null,
      scope,
      riskClass,
      mode: effective,
      summaryKey,
      summaryParams: { command: state.definition.type, target: refKey(state.envelope.target) ?? '' },
    },
    status: 'pending',
    createdAt,
    expiresAt: new Date(now.getTime() + 24 * 3_600_000).toISOString(),
  }
  await ports.park(approvalRequest)
  return {
    decision: {
      outcome: 'ask',
      riskClass,
      scope,
      mode: 'ask',
      agentPrincipalId: state.agentPrincipalId,
      ownerPrincipalId: state.ownerPrincipalId,
      approvalRequest,
      steps: [...walked],
    },
    trace: [...walked],
  }
}

/**
 * The whole pipeline in one call, in the pipeline's own order. The bus runs
 * the same three phases as separate middleware (so an audit row can observe
 * the terminal receipt); this entry point is for callers that need the final
 * decision without a bus — the policy matrix, a tool-catalogue pre-check.
 */
export async function evaluatePolicy(request: PolicyRequest, ports: PolicyPorts & RateLimitPort & ApprovalGatePorts): Promise<EvaluatePolicyResult> {
  const preflight = await evaluatePreflight(request, ports)
  if (!preflight.ok) return preflight.result
  const rated = await spendRateLimit(preflight.state, ports)
  if (!rated.allowed) return { decision: rated.decision as PolicyRateLimit, trace: rated.trace }
  return evaluateApprovalGate({ ...preflight.state, trace: rated.trace }, ports, request.now ?? new Date())
}

/** Approval requests are created here; ids stay opaque to `@rox/core`. */
function approvalRequestId(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID()
  return `approval-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}