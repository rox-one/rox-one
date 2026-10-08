/**
 * W1-11 (#1508) — Agent governance contract (TECH-SPEC §13.1–§13.3, §13.8;
 * DATA-MODEL §5.12–§5.14).
 *
 * The scopes themselves (`AGENT_SCOPES`, `COMMAND_SCOPES`, `scopeForCommand`)
 * live in `./risk.ts` next to the risk table, because both answer the same
 * question about a command. This file holds everything else the policy
 * pipeline needs: the agent binding, grants, the owner's approval policy and
 * the admin floor, the `approval_request` / `standing_approval` lifecycle and
 * the rate-limit policy.
 *
 * `@rox/core` stays dependency-free: no zod, no `@rox/shared`, no node
 * built-ins. Ids and refs are opaque strings here; the DDL owns their shape.
 */

import type { RiskClass } from '../commands/registry.ts'
import { type AgentScope, type RiskClassifier, DELETE_SCOPE, OWNER_DM_SCOPE } from './risk.ts'

/** `kind:id` of the container an agent action is scoped to (chat, list, calendar, space). */
export type ContainerRef = string

// ── Agent binding (DATA-MODEL §5.12, DDL `agent_binding`) ────────────────────

export const AGENT_BINDING_STATUSES = ['active', 'paused', 'revoked'] as const
export type AgentBindingStatus = (typeof AGENT_BINDING_STATUSES)[number]

export function isAgentBindingStatus(value: unknown): value is AgentBindingStatus {
  return typeof value === 'string' && (AGENT_BINDING_STATUSES as readonly string[]).includes(value)
}

/** Global alias every agent answers to; `@rox` resolves to the *author's* agent. */
export const AGENT_HANDLE_ALIAS = 'rox'

/** The agent's own name: «Rox» to the owner, «Rox · Марк» to others (§5.12). */
export const AGENT_DISPLAY_NAME = 'Rox'

export type AgentRuntime = 'omp' | 'external'

export interface AgentBinding {
  /** The bot principal (`principal.kind = 'bot'`). */
  agentPrincipalId: string
  workspaceId: string
  ownerPrincipalId: string
  /** Global alias; the display handle is disambiguated (`rox-<owner-username>`). */
  handle: string
  displayName: string
  /**
   * `handle-<owner-username>` (`rox-maria`), the handle others use to address
   * this agent (§5.12, D-2-5). Derived at read time from the owner's username —
   * it is not an `agent_binding` column.
   */
  displayHandle?: string
  /** Existing Rox agent runtime; there is no second orchestrator (ADR-U14). */
  runtime: AgentRuntime
  /** Owner ↔ agent DM chat (rule R3). */
  dmChatId?: string | null
  status: AgentBindingStatus
  policyId?: string | null
}

/** Step 1 of TECH-SPEC §13.2: only an `active` binding may run. */
export function agentIsRunnable(binding: Pick<AgentBinding, 'status'>): boolean {
  return binding.status === 'active'
}

// ── Grants (DATA-MODEL §5.14, DDL `agent_grant`) ─────────────────────────────

/** Usernames are `[a-z0-9][a-z0-9._-]*`; the display handle is `rox-<username>`. */
export const AGENT_USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/

/**
 * The binding `agents.provision_personal_agent` creates (§5.12): one personal
 * agent per member per workspace, idempotent on `(workspace, owner)`, running
 * in the existing Rox runtime.
 */
export function personalAgentDraft(input: {
  workspaceId: string
  ownerPrincipalId: string
  username?: string | null
  ownerDisplayName?: string | null
}): Omit<AgentBinding, 'agentPrincipalId' | 'dmChatId' | 'policyId'> {
  const username = input.username && AGENT_USERNAME_PATTERN.test(input.username.toLowerCase()) ? input.username.toLowerCase() : null
  return {
    workspaceId: input.workspaceId,
    ownerPrincipalId: input.ownerPrincipalId,
    handle: AGENT_HANDLE_ALIAS,
    displayHandle: username ? `${AGENT_HANDLE_ALIAS}-${username}` : AGENT_HANDLE_ALIAS,
    displayName: input.ownerDisplayName ? `${AGENT_DISPLAY_NAME} · ${input.ownerDisplayName}` : AGENT_DISPLAY_NAME,
    runtime: 'omp',
    status: 'active',
  }
}

export interface GrantSelector {
  /** Container prefix: `space:<id>`, `task-list:<id>`, `channel:<id>`, … */
  container?: ContainerRef
  /** Allowed target kinds; empty / absent = every kind in scope. */
  kinds?: readonly string[]
}

export interface AgentGrant {
  agentGrantId: string
  workspaceId: string
  agentPrincipalId: string
  scope: AgentScope
  selector: GrantSelector
  grantedBy: string
  expiresAt?: string | null
  revokedAt?: string | null
  createdAt?: string
}

export interface ScopeRequest {
  scope: AgentScope
  container?: ContainerRef
  kinds?: readonly string[]
}

/**
 * A container prefix matches the container itself and anything inside it
 * (`space:abc` covers `space:abc/board`), never a sibling that merely shares a
 * string prefix (`space:abcd`).
 */
export function containerMatches(prefix: ContainerRef | undefined, container: ContainerRef | undefined): boolean {
  if (!prefix) return true
  if (!container) return false
  return container === prefix || container.startsWith(`${prefix}:`) || container.startsWith(`${prefix}/`)
}

function kindMatches(selector: GrantSelector, kinds: readonly string[] | undefined): boolean {
  if (!selector.kinds || selector.kinds.length === 0) return true
  if (!kinds || kinds.length === 0) return false
  return kinds.some(kind => selector.kinds?.includes(kind))
}

function withinWindow(grant: Pick<AgentGrant, 'expiresAt' | 'revokedAt'>, now: Date): boolean {
  if (grant.revokedAt) return false
  if (!grant.expiresAt) return true
  const expires = Date.parse(grant.expiresAt)
  return Number.isFinite(expires) ? expires > now.getTime() : false
}

/** Whether one grant covers a request (scope exact, selector prefix, live). */
export function grantMatches(grant: AgentGrant, request: ScopeRequest, now: Date = new Date()): boolean {
  if (grant.scope !== request.scope) return false
  if (!withinWindow(grant, now)) return false
  const selector = grant.selector ?? {}
  return containerMatches(selector.container, request.container) && kindMatches(selector, request.kinds)
}

/** Step 3 of TECH-SPEC §13.2: is the scope granted at all? */
export function isScopeCovered(grants: readonly AgentGrant[], request: ScopeRequest, now: Date = new Date()): boolean {
  return grants.some(grant => grantMatches(grant, request, now))
}

/** `kinds` of a target ref list, for selector matching. */
export function kindsOf(refs: readonly { kind: string }[]): string[] {
  return [...new Set(refs.map(ref => ref.kind))]
}

// ── Approval policy (DATA-MODEL §5.14, DDL `approval_policy`) ────────────────

export const APPROVAL_MODES = ['auto', 'ask', 'deny'] as const
export type ApprovalMode = (typeof APPROVAL_MODES)[number]

export function isApprovalMode(value: unknown): value is ApprovalMode {
  return typeof value === 'string' && (APPROVAL_MODES as readonly string[]).includes(value)
}

/** Stricter wins when a rule meets the workspace floor. */
export const APPROVAL_MODE_RANK: Record<ApprovalMode, number> = { auto: 0, ask: 1, deny: 2 }

export function strictestApprovalMode(a: ApprovalMode, b: ApprovalMode): ApprovalMode {
  return APPROVAL_MODE_RANK[a] >= APPROVAL_MODE_RANK[b] ? a : b
}

export interface ApprovalPolicyRule {
  scope: AgentScope
  riskClass: RiskClass
  mode: ApprovalMode
}

/** Admin-enforced minimums per scope (`approval_policy.workspace_floor`). */
export type WorkspaceFloor = Partial<Record<AgentScope, ApprovalMode>>

export interface ApprovalPolicy {
  ownerPrincipalId: string
  rules: readonly ApprovalPolicyRule[]
  workspaceFloor: WorkspaceFloor
  revision?: number
}

/**
 * The three shipped modes are the §13.2 mapping onto the existing
 * `PermissionMode` (`packages/shared/src/agent/mode-types.ts`). The names are
 * mirrored here as a string union because `@rox/core` never imports
 * `@rox/shared`; a test in `@rox/shared` asserts the two lists stay equal.
 */
export const AGENT_PERMISSION_MODES = ['ask', 'safe', 'allow-all'] as const
export type AgentPermissionMode = (typeof AGENT_PERMISSION_MODES)[number]

/**
 * TECH-SPEC §13.2 onboarding mapping:
 * - `ask` (default): routine auto, consequential ask, privileged ask;
 * - `safe`: everything ask;
 * - `allow-all`: routine auto, consequential ask (the UI offers a standing
 *   approval after two identical approvals), privileged ask.
 *
 * `allow-all` never auto-approves a consequential action without a standing
 * approval (requirement D).
 */
export const POLICY_MODES_BY_PERMISSION_MODE: Readonly<Record<AgentPermissionMode, Readonly<Record<RiskClass, ApprovalMode>>>> = {
  ask: { routine: 'auto', consequential: 'ask', privileged: 'ask' },
  safe: { routine: 'ask', consequential: 'ask', privileged: 'ask' },
  'allow-all': { routine: 'auto', consequential: 'ask', privileged: 'ask' },
}

/** The policy a workspace starts with for every owner (§13.2 defaults). */
export function approvalPolicyForPermissionMode(ownerPrincipalId: string, mode: AgentPermissionMode): ApprovalPolicy {
  const byRisk = POLICY_MODES_BY_PERMISSION_MODE[mode]
  const rules: ApprovalPolicyRule[] = []
  for (const [riskClass, ruleMode] of Object.entries(byRisk) as [RiskClass, ApprovalMode][]) {
    rules.push({ scope: DELETE_SCOPE, riskClass, mode: ruleMode })
  }
  return { ownerPrincipalId, rules, workspaceFloor: {}, revision: 1 }
}

export interface PolicyModeInput {
  scope: AgentScope
  riskClass: RiskClass
  policy: ApprovalPolicy
  /** Session permission mode (`ask` by default). */
  permissionMode: AgentPermissionMode
}

/**
 * Step 7 of TECH-SPEC §13.2: `workspace_floor ⊓ approval_policy.rules[scope,
 * risk]`. The scope+risk rule wins over the permission-mode default; the floor
 * can only ever make the decision stricter (never `auto` over `deny`).
 */
export function policyModeFor(input: PolicyModeInput): ApprovalMode {
  const { scope, riskClass, policy, permissionMode } = input
  const rule = policy.rules.find(candidate => candidate.scope === scope && candidate.riskClass === riskClass)
    ?? policy.rules.find(candidate => candidate.scope === DELETE_SCOPE && candidate.riskClass === riskClass)
  const base = rule?.mode ?? POLICY_MODES_BY_PERMISSION_MODE[permissionMode][riskClass]
  const floor = policy.workspaceFloor[scope]
  return floor ? strictestApprovalMode(base, floor) : base
}

// ── Approvals and standing approvals (§13.3, DDL `approval_request`) ─────────

export const APPROVAL_REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'expired', 'executed', 'failed'] as const
export type ApprovalRequestStatus = (typeof APPROVAL_REQUEST_STATUSES)[number]

export function isApprovalRequestStatus(value: unknown): value is ApprovalRequestStatus {
  return typeof value === 'string' && (APPROVAL_REQUEST_STATUSES as readonly string[]).includes(value)
}

/** An approval request expires after 24 h (§13.3). */
export const APPROVAL_TTL_HOURS = 24
/** A standing approval created from an approval lives 30 days by default. */
export const DEFAULT_STANDING_APPROVAL_DAYS = 30
/** Privileged actions are never eligible for a standing approval (§13.3). */
export const STANDING_APPROVAL_NEVER_RISK: RiskClass = 'privileged'

export interface RememberDecision {
  standing: true
  /** Defaults to the request's container prefix; validated by the caller. */
  selector?: GrantSelector
  /** ISO timestamp; defaults to `+30 days`. */
  until?: string
}

export interface ApprovalRequest {
  approvalRequestId: string
  workspaceId: string
  agentPrincipalId: string
  ownerPrincipalId: string
  /** The full CommandEnvelope, so approval executes exactly what was previewed. */
  command: unknown
  riskClass: RiskClass
  summary: string
  preview: unknown
  status: ApprovalRequestStatus
  decidedBy?: string | null
  decidedAt?: string | null
  remember?: RememberDecision | null
  /** ISO timestamp; `createdAt + 24 h` by default. */
  expiresAt: string
  createdAt: string
  /** Set when the request supersedes another one ("Изменить" → new envelope). */
  supersedes?: string | null
}

/** `pending` and not past its expiry. */
export function approvalRequestIsOpen(request: Pick<ApprovalRequest, 'status' | 'expiresAt'>, now: Date = new Date()): boolean {
  if (request.status !== 'pending') return false
  const expires = Date.parse(request.expiresAt)
  return Number.isFinite(expires) ? expires > now.getTime() : false
}

/** A pending request the clock has passed: the decision is `expired` (§13.3). */
export function approvalRequestIsExpired(request: Pick<ApprovalRequest, 'status' | 'expiresAt'>, now: Date = new Date()): boolean {
  return request.status === 'pending' && !approvalRequestIsOpen(request, now)
}

export interface StandingApproval {
  standingApprovalId: string
  workspaceId: string
  agentPrincipalId: string
  scope: AgentScope
  selector: GrantSelector
  createdFrom?: string | null
  expiresAt?: string | null
  createdBy: string
  createdAt?: string
  revokedAt?: string | null
}

export interface StandingRequest extends ScopeRequest {
  riskClass: RiskClass
}

/**
 * Step 8 of TECH-SPEC §13.2: a standing approval covers `mode=ask` when the
 * scope matches exactly, the selector covers the container, and it has not
 * expired — and never for a `privileged` action.
 */
export function standingApprovalMatches(standing: StandingApproval, request: StandingRequest, now: Date = new Date()): boolean {
  if (request.riskClass === STANDING_APPROVAL_NEVER_RISK) return false
  if (standing.scope !== request.scope) return false
  if (!withinWindow(standing, now)) return false
  const selector = standing.selector ?? {}
  return containerMatches(selector.container, request.container) && kindMatches(selector, request.kinds)
}

/**
 * "Always allow here" on an approval card: the default selector is the same
 * scope and the same container, and the default expiry is 30 days.
 */
export function standingApprovalFromApproval(
  request: ApprovalRequest,
  options: { standingApprovalId: string; scope: AgentScope; container?: ContainerRef; now?: Date },
): StandingApproval | null {
  if (request.riskClass === STANDING_APPROVAL_NEVER_RISK) return null
  const now = options.now ?? new Date()
  const remember = request.remember ?? null
  const until = remember?.until ? Date.parse(remember.until) : now.getTime() + DEFAULT_STANDING_APPROVAL_DAYS * 86_400_000
  const selector: GrantSelector = remember?.selector
    ? { ...remember.selector }
    : options.container ? { container: options.container } : {}
  return {
    standingApprovalId: options.standingApprovalId,
    workspaceId: request.workspaceId,
    agentPrincipalId: request.agentPrincipalId,
    scope: options.scope,
    selector,
    createdFrom: request.approvalRequestId,
    expiresAt: new Date(Number.isFinite(until) ? until : now.getTime() + DEFAULT_STANDING_APPROVAL_DAYS * 86_400_000).toISOString(),
    createdBy: request.ownerPrincipalId,
    createdAt: now.toISOString(),
  }
}

// ── Rate limits (§13.8, DATA-MODEL §5.14, DDL `rate_limit_policy`) ───────────

export const RATE_LIMIT_WINDOWS = ['minute', 'hour', 'day'] as const
export type RateLimitWindow = (typeof RATE_LIMIT_WINDOWS)[number]

export function isRateLimitWindow(value: unknown): value is RateLimitWindow {
  return typeof value === 'string' && (RATE_LIMIT_WINDOWS as readonly string[]).includes(value)
}

export const RATE_LIMIT_WINDOW_MS: Readonly<Record<RateLimitWindow, number>> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
}

/** Subject forms in `rate_limit_policy`: `agent:*`, `agent:<id>`, `rule:*`. */
export const AGENT_ALL_SUBJECT = 'agent:*'
export const RULE_ALL_SUBJECT = 'rule:*'
/** Scope of the aggregate bucket every subject also spends from. */
export const AGGREGATE_SCOPE = '*'

export interface RateLimitBucket {
  subject: string
  scope: string
  perMinute: number | null
  perHour: number | null
  perDay: number | null
}

/**
 * Scopes a freshly provisioned agent holds without an explicit owner grant.
 *
 * The risk table maps exactly these scopes to `routine` commands (private to
 * the owner, reversible, nobody else notified). Every scope that can notify or
 * touch other people — `tasks:assign_others`, `docs:share`, `im:send_chat`,
 * `im:create_group`, `calendar:invite_others`, `vc:start`,
 * `goals:publish_check_in`, `people:invite`, `*:delete` — is granted
 * explicitly by the owner, so "the agent may do by default what is routine".
 */
export const DEFAULT_AGENT_GRANT_SCOPES: readonly AgentScope[] = [
  'tasks:create',
  'tasks:update',
  'docs:create',
  'docs:update',
  'drive:write',
  'calendar:create',
  'goals:draft_check_in',
  'im:send_owner_dm',
  // `im:create_group` is granted because the *routine* case — a private chat
  // with nobody else in it — is private to the owner. Creating a chat with
  // other people is `consequential`, so it still reaches the owner's approval
  // card (§15.1: "creating a chat with other people is consequential").
  'im:create_group',
]

/** DATA-MODEL §5.14 defaults, seeded into `rate_limit_policy` per workspace. */
export const DEFAULT_RATE_LIMIT_POLICY: readonly RateLimitBucket[] = [
  { subject: AGENT_ALL_SUBJECT, scope: 'im:send_chat', perMinute: 10, perHour: 120, perDay: 500 },
  { subject: AGENT_ALL_SUBJECT, scope: 'im:create_group', perMinute: null, perHour: 5, perDay: 20 },
  { subject: AGENT_ALL_SUBJECT, scope: 'tasks:create', perMinute: 30, perHour: 200, perDay: 1000 },
  { subject: AGENT_ALL_SUBJECT, scope: 'calendar:create', perMinute: 5, perHour: 30, perDay: 100 },
  { subject: AGENT_ALL_SUBJECT, scope: 'vc:start', perMinute: null, perHour: 5, perDay: 20 },
  { subject: AGENT_ALL_SUBJECT, scope: 'docs:create', perMinute: 10, perHour: 100, perDay: 500 },
  { subject: AGENT_ALL_SUBJECT, scope: 'people:invite', perMinute: null, perHour: 10, perDay: 30 },
  // All commands per agent, and every rule action per principal.
  { subject: AGENT_ALL_SUBJECT, scope: AGGREGATE_SCOPE, perMinute: 60, perHour: 600, perDay: 5000 },
  { subject: RULE_ALL_SUBJECT, scope: AGGREGATE_SCOPE, perMinute: null, perHour: 200, perDay: 2000 },
]

export interface RateLimitSpend {
  workspaceId: string
  subject: string
  scope: string
  cost?: number
}

export interface RateLimitDenial {
  allowed: false
  window: RateLimitWindow
  /** Seconds until the exhausted window admits the next token (§13.8). */
  retryAfter: number
}

export interface RateLimitAllowance {
  allowed: true
}

export type RateLimitDecision = RateLimitAllowance | RateLimitDenial

/**
 * The two buckets a subject spends from for one command (§13.2 step 6): its
 * own scope and the `*` aggregate. Both must admit the command.
 */
export interface RateLimiter {
  consume(spend: RateLimitSpend): Promise<RateLimitDecision>
}

/** Valkey key of one bucket (DATA-MODEL §5.14); local mode uses it as a map key. */
export function rateLimitKey(spend: Pick<RateLimitSpend, 'workspaceId' | 'subject' | 'scope'>): string {
  return `rl:${spend.workspaceId}:${spend.subject}:${spend.scope}`
}

/** Scope keys a command spends from, most specific first (`scope`, then `*`). */
export function rateLimitScopesFor(scope: string): string[] {
  return scope === AGGREGATE_SCOPE ? [AGGREGATE_SCOPE] : [scope, AGGREGATE_SCOPE]
}

/** The `agent:<id>` subject form for one agent. */
export function agentRateLimitSubject(agentPrincipalId: string): string {
  return `agent:${agentPrincipalId}`
}

/** Owner-DM messages are the private case of `im.send_message` (§5.14 scopes). */
export function isOwnerDmScope(scope: AgentScope): boolean {
  return scope === OWNER_DM_SCOPE
}

export type { AgentScope, RiskClassifier }