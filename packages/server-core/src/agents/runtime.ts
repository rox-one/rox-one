/**
 * W1-11 (#1508) — The agents runtime (TECH-SPEC §13.1, §13.2, §13.8).
 *
 * One object per process, holding what the governance pipeline and the
 * reference handlers need:
 * - the governance and identity stores (`./store.ts`);
 * - the audit writer (`./audit-log.ts` locally, `audit_log` on the server);
 * - the token buckets (`./rate-limit.ts` locally, Valkey on the server);
 * - the **authorizer** (W1-04's `acl.can`; the local owner shim by default);
 * - the invocation port (§13.1): `agents.invoke` hands the work to the
 *   existing OMP / `ExecutionCoordinator` path through it and never spawns a
 *   runtime of its own;
 * - the dispatch port an approved `approval_request` is replayed through.
 *
 * A host installs its own runtime with `configureAgentsRuntime` (the workspace
 * service does it when it builds the command bus); without one, the lazy
 * default is the local one: `{configDir}/audit/` JSONL, in-memory buckets and
 * in-memory stores, which is exactly what a single-user Rox needs.
 *
 * `isEnabled` is the `agents.autonomy.v1` switch: with it off, the governance
 * middleware passes every command through and the agent commands are already
 * `UNAVAILABLE` from their catalogue flag.
 */

import { LOCAL_OWNER_AUTHORIZER, type Authorizer, type CommandEnvelope, type CommandReceipt } from '@rox/core/commands'
import {
  DEFAULT_RATE_LIMIT_POLICY,
  agentRateLimitSubject,
  type AgentBinding,
  type ApprovalRequest,
  type ApprovalPolicy,
  type RateLimitBucket,
  type RateLimitSpend,
} from '@rox/core/agents'
import type { AuditWriter } from '@rox/core/commands'
import type { PolicyGovernancePorts } from '@rox/core/commands'
import { JsonlAuditLog, type JsonlAuditLogOptions } from './audit-log.ts'
import { InMemoryRateLimiter } from './rate-limit.ts'
import { InMemoryGovernanceStore, InMemoryIdentityStore } from './store.ts'

/** §13.1: the existing runtime, addressed by the bus. */
export interface AgentInvocationRequest {
  workspaceId: string
  agentPrincipalId: string
  ownerPrincipalId: string
  instruction: string
  trigger: 'mention' | 'dm' | 'rule' | 'schedule'
  sessionId?: string
  messageRef?: string
  ruleId?: string
  /** The command envelope that carried the invocation (`correlationId`). */
  envelope: CommandEnvelope<unknown>
}

export interface AgentInvocation {
  sessionId: string
  /** The message the session should resume with, when it already existed. */
  messageRef?: string
  /** `true` when a new session was created rather than resumed. */
  created: boolean
}

/**
 * The hand-off to the existing agent runtime (SessionManager /
 * `ExecutionCoordinator`, or the messaging gateway for external chats). The
 * reference implementation does not spawn anything itself.
 */
export interface AgentInvocationPort {
  invoke(request: AgentInvocationRequest): Promise<AgentInvocation>
}

/** Replays the stored envelope of an approved request (same `commandId`). */
export interface ApprovedCommandDispatchPort {
  dispatch(envelope: CommandEnvelope<unknown>): Promise<CommandReceipt>
}

/**
 * Held notifications for placeholders (DATA-MODEL §5.11 rule 3): addressed to a
 * placeholder they are held, and activation releases them collapsed. The
 * notification module owns delivery; this keeps the count and the titles.
 */
export class HeldNotificationInbox {
  private readonly held = new Map<string, string[]>()

  hold(principalId: string, title: string): void {
    const list = this.held.get(principalId) ?? []
    list.push(title)
    this.held.set(principalId, list)
  }

  count(principalId: string): number {
    return this.held.get(principalId)?.length ?? 0
  }

  titles(principalId: string): string[] {
    return [...(this.held.get(principalId) ?? [])]
  }

  /** Release everything held for a principal; returns the collapsed titles. */
  release(principalId: string): string[] {
    const titles = this.titles(principalId)
    this.held.delete(principalId)
    return titles
  }
}

export interface AgentsRuntime {
  readonly governance: InMemoryGovernanceStore
  readonly identity: InMemoryIdentityStore
  readonly audit: AuditWriter
  readonly rateLimiter: InMemoryRateLimiter
  readonly authorizer: Authorizer
  readonly notifications: HeldNotificationInbox
  /** Absent until a host wires the existing runtime (§13.1). */
  readonly invocation?: AgentInvocationPort
  /** Absent until a host wires the executor back in (§13.3). */
  readonly dispatchApproved?: ApprovedCommandDispatchPort
  /** `agents.autonomy.v1`; `true` in tests and in a host that owns the switch. */
  isEnabled(): boolean
  now(): Date
  newId(): string
  /** `rate_limit_policy` of a workspace; `DEFAULT_RATE_LIMIT_POLICY` when unset. */
  rateLimitPolicy(workspaceId: string): readonly RateLimitBucket[]
}

export interface CreateAgentsRuntimeOptions {
  /** `<configDir>` for the JSONL audit; defaults to `CRAFT_CONFIG_DIR` / `~/rox`. */
  configDir?: string
  audit?: AuditWriter
  governance?: InMemoryGovernanceStore
  identity?: InMemoryIdentityStore
  rateLimiter?: InMemoryRateLimiter
  authorizer?: Authorizer
  notifications?: HeldNotificationInbox
  invocation?: AgentInvocationPort
  dispatchApproved?: ApprovedCommandDispatchPort
  isEnabled?: () => boolean
  now?: () => Date
  newId?: () => string
  rateLimitPolicy?: (workspaceId: string) => readonly RateLimitBucket[]
  auditOptions?: JsonlAuditLogOptions
}

/** Deterministic id generator for hosts without `crypto.randomUUID`. */
function fallbackId(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID()
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

export function createAgentsRuntime(options: CreateAgentsRuntimeOptions = {}): AgentsRuntime {
  const governance = options.governance ?? new InMemoryGovernanceStore()
  const log = options.audit ? null : new JsonlAuditLog(options.auditOptions ?? (options.configDir ? { configDir: options.configDir } : {}))
  return {
    governance,
    identity: options.identity ?? new InMemoryIdentityStore(),
    audit: options.audit ?? { append: async row => log!.append(row) },
    rateLimiter: options.rateLimiter ?? new InMemoryRateLimiter(),
    authorizer: options.authorizer ?? LOCAL_OWNER_AUTHORIZER,
    notifications: options.notifications ?? new HeldNotificationInbox(),
    ...(options.invocation ? { invocation: options.invocation } : {}),
    ...(options.dispatchApproved ? { dispatchApproved: options.dispatchApproved } : {}),
    isEnabled: options.isEnabled ?? (() => true),
    now: options.now ?? (() => new Date()),
    newId: options.newId ?? fallbackId,
    rateLimitPolicy: options.rateLimitPolicy ?? (workspaceId => governance.rateLimitPolicy(workspaceId)),
  }
}

let configured: AgentsRuntime | null = null

/** Install the process runtime (the workspace service does this at boot). */
export function configureAgentsRuntime(runtime: AgentsRuntime | null): void {
  configured = runtime
}

/** The process runtime; the local one is created on first use. */
export function getAgentsRuntime(): AgentsRuntime {
  configured ??= createAgentsRuntime()
  return configured
}

/** The `DEFAULT_RATE_LIMIT_POLICY` rows plus a per-workspace override. */
export function rateLimitPolicyFor(runtime: AgentsRuntime, workspaceId: string): readonly RateLimitBucket[] {
  const policy = runtime.rateLimitPolicy(workspaceId)
  return policy.length > 0 ? policy : DEFAULT_RATE_LIMIT_POLICY
}

/**
 * The ten-step pipeline's ports, backed by one runtime. Both the middleware
 * chain and a direct `evaluatePolicy` call use this, so a matrix test and the
 * live bus exercise the same wiring.
 */
export function policyPortsFor(runtime: AgentsRuntime): PolicyGovernancePorts {
  return {
    agentBinding: async (workspaceId, agentPrincipalId) => {
      const binding: AgentBinding | null = runtime.governance.binding(agentPrincipalId)
      if (!binding || binding.workspaceId !== workspaceId) return null
      return binding
    },
    pauseAllAgents: async workspaceId => runtime.governance.isPauseAllAgents(workspaceId),
    grants: async (_workspaceId, agentPrincipalId) => runtime.governance.grantsOf(agentPrincipalId),
    authorizer: runtime.authorizer,
    approvalPolicy: async (workspaceId, ownerPrincipalId) => runtime.governance.policyOf(workspaceId, ownerPrincipalId) satisfies ApprovalPolicy,
    standingApprovals: async (_workspaceId, agentPrincipalId) => runtime.governance.standingOf(agentPrincipalId),
    rateLimit: async (spend: RateLimitSpend) => {
      runtime.rateLimiter.setPolicy(rateLimitPolicyFor(runtime, spend.workspaceId))
      return runtime.rateLimiter.consume(spend)
    },
    park: async (request: ApprovalRequest) => runtime.governance.park(request),
  }
}

/** The bucket subject of an agent (exposed so hosts log the same key). */
export function agentSubject(agentPrincipalId: string): string {
  return agentRateLimitSubject(agentPrincipalId)
}