/**
 * W1-11 (#1508) — Zod validation for the agent-governance commands and rows
 * (TECH-SPEC §13.1–§13.3, §13.8; DATA-MODEL §5.12–§5.14).
 *
 * `@rox/core/agents` holds the types and the pure rules; this file validates
 * untrusted payloads and the rows a store hands back. Lives in `@rox/shared`
 * (zod is a dependency here, not in the dependency-free `@rox/core`).
 */

import { z } from 'zod'
import {
  AGENT_BINDING_STATUSES,
  APPROVAL_MODES,
  APPROVAL_REQUEST_STATUSES,
  RATE_LIMIT_WINDOWS,
  RISK_CLASSES,
  AGENT_SCOPES,
  isAgentBindingStatus,
  isApprovalMode,
  isApprovalRequestStatus,
  isAgentScope,
  isRateLimitWindow,
  isRiskClass,
  type AgentBinding,
  type AgentGrant,
  type ApprovalPolicy,
  type ApprovalPolicyRule,
  type ApprovalRequest,
  type RateLimitBucket,
  type StandingApproval,
  type WorkspaceFloor,
} from '@rox/core/agents'

const idSchema = z.string().min(1).max(256)
const isoDateSchema = z.string().datetime()
const containerSchema = z.string().min(1).max(512)

function enumerated<T extends string>(values: readonly T[], guard: (value: unknown) => value is T, what: string) {
  return z.string().refine(guard, { message: `unknown ${what}: expected one of ${values.join(', ')}` })
}

export const riskClassSchema = enumerated(RISK_CLASSES, isRiskClass, 'risk class')
export const agentScopeSchema = enumerated(AGENT_SCOPES, isAgentScope, 'agent scope')
export const approvalModeSchema = enumerated(APPROVAL_MODES, isApprovalMode, 'approval mode')
export const agentBindingStatusSchema = enumerated(AGENT_BINDING_STATUSES, isAgentBindingStatus, 'agent status')
export const approvalRequestStatusSchema = enumerated(APPROVAL_REQUEST_STATUSES, isApprovalRequestStatus, 'approval status')
export const rateLimitWindowSchema = enumerated(RATE_LIMIT_WINDOWS, isRateLimitWindow, 'rate-limit window')

/** `agent_grant.selector` (DATA-MODEL §5.14). */
export const grantSelectorSchema = z.object({
  container: containerSchema.optional(),
  kinds: z.array(z.string().min(1).max(64)).max(64).optional(),
})

export const agentGrantSchema: z.ZodType<AgentGrant> = z.object({
  agentGrantId: idSchema,
  workspaceId: idSchema,
  agentPrincipalId: idSchema,
  scope: agentScopeSchema,
  selector: grantSelectorSchema,
  grantedBy: idSchema,
  expiresAt: isoDateSchema.nullable().optional(),
  revokedAt: isoDateSchema.nullable().optional(),
  createdAt: isoDateSchema.optional(),
})

/** `agent_binding` (DATA-MODEL §5.12). */
export const agentBindingSchema: z.ZodType<AgentBinding> = z.object({
  agentPrincipalId: idSchema,
  workspaceId: idSchema,
  ownerPrincipalId: idSchema,
  handle: z.string().min(1).max(64),
  displayName: z.string().min(1).max(128),
  displayHandle: z.string().min(1).max(128).optional(),
  runtime: z.enum(['omp', 'external']),
  dmChatId: idSchema.nullable().optional(),
  status: agentBindingStatusSchema,
  policyId: idSchema.nullable().optional(),
})

/** `approval_policy.rules[]` and the admin floor (§5.14). */
export const approvalPolicyRuleSchema: z.ZodType<ApprovalPolicyRule> = z.object({
  scope: agentScopeSchema,
  riskClass: riskClassSchema,
  mode: approvalModeSchema,
})

export const workspaceFloorSchema: z.ZodType<WorkspaceFloor> = z.record(agentScopeSchema, approvalModeSchema)

export const approvalPolicySchema: z.ZodType<ApprovalPolicy> = z.object({
  ownerPrincipalId: idSchema,
  rules: z.array(approvalPolicyRuleSchema).max(256),
  workspaceFloor: workspaceFloorSchema,
  revision: z.number().int().nonnegative().optional(),
})

/** `approval_request` (§13.3, §5.14). */
export const approvalRequestSchema: z.ZodType<ApprovalRequest> = z.object({
  approvalRequestId: idSchema,
  workspaceId: idSchema,
  agentPrincipalId: idSchema,
  ownerPrincipalId: idSchema,
  command: z.unknown(),
  riskClass: riskClassSchema,
  summary: z.string().min(1).max(1024),
  preview: z.unknown(),
  status: approvalRequestStatusSchema,
  decidedBy: idSchema.nullable().optional(),
  decidedAt: isoDateSchema.nullable().optional(),
  remember: z.object({ standing: z.literal(true), selector: grantSelectorSchema.optional(), until: isoDateSchema.optional() }).nullable().optional(),
  expiresAt: isoDateSchema,
  createdAt: isoDateSchema,
  supersedes: idSchema.nullable().optional(),
})

export const standingApprovalSchema: z.ZodType<StandingApproval> = z.object({
  standingApprovalId: idSchema,
  workspaceId: idSchema,
  agentPrincipalId: idSchema,
  scope: agentScopeSchema,
  selector: grantSelectorSchema,
  createdFrom: idSchema.nullable().optional(),
  expiresAt: isoDateSchema.nullable().optional(),
  createdBy: idSchema,
  createdAt: isoDateSchema.optional(),
  revokedAt: isoDateSchema.nullable().optional(),
})

/** `rate_limit_policy` row (DATA-MODEL §5.14). */
export const rateLimitBucketSchema: z.ZodType<RateLimitBucket> = z.object({
  subject: z.string().min(1).max(128),
  scope: z.string().min(1).max(128),
  perMinute: z.number().int().positive().nullable(),
  perHour: z.number().int().positive().nullable(),
  perDay: z.number().int().positive().nullable(),
})

// ── Command payloads ────────────────────────────────────────────────────────

/** `agents.provision_personal_agent` — idempotent per (workspace, owner). */
export const provisionPersonalAgentSchema = z.object({
  workspaceId: idSchema,
  ownerPrincipalId: idSchema,
  username: z.string().min(1).max(64).optional(),
  ownerDisplayName: z.string().min(1).max(128).optional(),
})
export type ProvisionPersonalAgentPayload = z.infer<typeof provisionPersonalAgentSchema>

/** `agents.invoke` — the mention / DM / rule trigger (§13.7). */
export const agentInvokeSchema = z.object({
  workspaceId: idSchema,
  agentPrincipalId: idSchema,
  ownerPrincipalId: idSchema,
  instruction: z.string().min(1).max(20_000),
  /** §13.7: an explicit mention, a DM, a rule or a schedule. */
  provenance: z.object({
    trigger: z.enum(['mention', 'dm', 'rule', 'schedule']),
    sessionId: idSchema.optional(),
    messageRef: z.string().min(1).max(512).optional(),
    ruleId: z.enum(['R1', 'R2', 'R3', 'R4', 'R5']).optional(),
  }),
  /** `{kind:'agent-panel', …}` and the other §18.2 origins arrive on the envelope. */
  origin: z.unknown().optional(),
})
export type AgentInvokePayload = z.infer<typeof agentInvokeSchema>

/** `agents.decide_approval` — the owner's decision on a parked request (§13.3). */
export const decideApprovalSchema = z.object({
  approvalRequestId: idSchema,
  decision: z.enum(['approve', 'reject']),
  /** The envelope the owner edited ("Изменить" produces a new envelope). */
  editedCommand: z.unknown().optional(),
  remember: z.object({ standing: z.literal(true), container: containerSchema.optional(), until: isoDateSchema.optional() }).optional(),
})
export type DecideApprovalPayload = z.infer<typeof decideApprovalSchema>

/** `agents.pause` — the kill switch (§13.2 step 1). */
export const pauseAgentSchema = z.object({
  agentPrincipalId: idSchema,
  paused: z.boolean(),
})
export type PauseAgentPayload = z.infer<typeof pauseAgentSchema>

/** Payload schemas of this package's commands, keyed by command name. */
export const AGENT_PAYLOAD_SCHEMAS = {
  'agents.provision_personal_agent': provisionPersonalAgentSchema,
  'agents.invoke': agentInvokeSchema,
  'agents.decide_approval': decideApprovalSchema,
  'agents.pause': pauseAgentSchema,
} as const