/**
 * W1-12 (#1509) — Domain rule engine contract (TECH-SPEC §14.1–14.3,
 * DATA-MODEL §5.16).
 *
 * A domain rule is a `domain_event` consumer, not an orchestrator and not the
 * Automations canvas (#1096–#1100). It declares its triggers, conditions,
 * idempotency key and ordered steps; the runtime (server-core locally, the
 * workspace service as the `rules` consumer group) evaluates every committed
 * event and dispatches each step as an ordinary command through the command
 * bus (W1-03), so ACL, `rule:*` rate limits, receipts and audit apply.
 *
 * `@rox/core` stays dependency-free: this module holds types and small pure
 * helpers only.
 */

import type { CommandAuthorityHint, CommandOrigin, CommandType } from '../commands/envelope.ts'
import type { CommandActor } from '../commands/registry.ts'
import type { EntityRef } from '../entities/refs.ts'
import type { DomainEvent, DomainEventType } from '../events/types.ts'

export const RULE_IDS = ['R1', 'R2', 'R3', 'R4', 'R5'] as const

/**
 * The flag every consumer checks before subscribing and before every
 * evaluation (`WORKBENCH_FLAG.automationRulesV1`, default OFF).
 */
export const AUTOMATION_RULES_FLAG = 'automation.rules.v1'

export type RuleId = (typeof RULE_IDS)[number]

export function isRuleId(value: unknown): value is RuleId {
  return typeof value === 'string' && (RULE_IDS as readonly string[]).includes(value)
}

export type PrincipalId = string

/** Principal id the engine itself acts as (`actor.kind === 'system'`). */
export const SYSTEM_PRINCIPAL_ID = 'system'

/**
 * `R1` is per-user (the organiser can opt out); `R2`–`R5` are workspace-level
 * and admin-only (DATA-MODEL §5.16 "Opt-out").
 */
export type RuleScope = 'workspace' | 'principal'

/** Why a matched rule did not run (stored on the `skipped` execution row). */
export type SkipReason =
  | 'rule_disabled'
  | 'not_organiser'
  | 'all_day'
  | 'declined'
  | 'free'
  | 'no_notes_keyword'
  | 'event_cancelled'
  | 'no_general_chat'
  | 'not_active_member'
  | 'no_agent'
  | 'workspace_disconnected'
  | 'unknown_event'

/** Effective `automation_rule` settings for one rule (and one principal, for R1). */
export interface RuleSettings {
  ruleId: RuleId
  /** Effective `enabled`; the per-principal row wins over the workspace row. */
  enabled: boolean
  /** Effective params; the per-principal row overrides the workspace row key by key. */
  params: Readonly<Record<string, unknown>>
  /** Where the effective value came from (`default`: no `automation_rule` row). */
  source: 'workspace' | 'principal' | 'default'
}

/** `automation_rule.enabled` defaults to true, `params` to `{}` (W1-05 `515-automation-rules.sql`). */
export function defaultRuleSettings(ruleId: RuleId): RuleSettings {
  return { ruleId, enabled: true, params: {}, source: 'default' }
}

/**
 * Host ports the engine needs. One adapter per authority:
 * `packages/server-core/src/rules/host.ts` (local) and
 * `apps/workspace-service/src/modules/rules/host.ts` (workspace).
 */
export interface RuleHostPorts {
  now(): Date
  /** `automation_rule` read; `principalId`: a principal, or `null` for the workspace row only. */
  settings(ruleId: RuleId, principalId?: PrincipalId | null): Promise<RuleSettings>
  /** Live flag lookup. Consumers are inert while `automation.rules.v1` is off. */
  isFlagEnabled(flag: string): boolean
  /** The workspace's General chat (D-v2-2); `undefined` locally or before it exists. */
  generalChatId(): Promise<string | undefined>
  /**
   * The personal agent principal of a user (`@rox`). W1-11 owns provisioning;
   * a host may answer with the deterministic id before the agent row exists.
   */
  personalAgent(principalId: PrincipalId): Promise<PrincipalId | undefined>
  /**
   * The direct (p2p) chat between `subjectPrincipalId` and `peerPrincipalId`.
   * The messenger owns the id scheme (`im.get_or_create_p2p`); the host
   * answers with the same deterministic ref, so a step can target the DM
   * before the chat row exists.
   */
  directChatRef(subjectPrincipalId: PrincipalId, peerPrincipalId: PrincipalId): Promise<EntityRef | undefined>
  /** Display name used in rule copy (join card); defaults to the principal id. */
  displayName(principalId: PrincipalId): Promise<string | undefined>
}

/**
 * One execution target: the principal the execution acts for plus an optional
 * token that disambiguates expansions of the same event (R4: one execution per
 * invited email). The idempotency key is built from both.
 */
export interface RuleTarget {
  subject: PrincipalId
  token?: string
}

/**
 * Evaluation context. One instance is bound to one `(workspace, subject,
 * token)`: the engine sets them per target, because a rule's idempotency key
 * embeds the owner (`R1:{event}:{occurrence}:{owner}`).
 */
export interface RuleCtx extends RuleHostPorts {
  readonly workspaceId: string
  /** The principal this evaluation is for (the rule's owner). */
  readonly subject: PrincipalId
  /** Per-target discriminator of the key (may be undefined). */
  readonly token: string | undefined
  /** Effective params for a rule (per-principal row over the workspace row). */
  params(ruleId: RuleId, principalId?: PrincipalId | null): Promise<Readonly<Record<string, unknown>>>
}

/**
 * The command a step dispatches. The runtime stamps the envelope:
 * `commandId = idempotencyKey + ':' + step.name` (TECH-SPEC §14.2 step 3), so
 * a replayed event or a resumed execution can never apply a step twice
 * (`command_receipt` dedupes).
 */
export interface RuleCommandDraft {
  type: CommandType
  payload: Record<string, unknown>
  /** Defaults to the step's own ref (`person:<owner>` for owner-scoped steps). */
  target?: EntityRef
  /** Overrides the runtime authority hint for `by-target` commands. */
  authorityHint?: CommandAuthorityHint
  origin?: CommandOrigin
}

/** One ordered step of a rule: exactly one command (TECH-SPEC §14.1). */
export interface RuleStep {
  /** Stable step name; the command id is `${key}:${name}`. */
  name: string
  /**
   * Fixed command id shared with another rule's step, when two rules must
   * produce one effect (R2 and R3 both provision the personal agent — same
   * command id → one agent, commands_receipt dedupes).
   */
  commandId?: string
  command: RuleCommandDraft
  /**
   * `'system'`: the engine acts for the affected principal — actor
   * `{ principalId: subject, kind: 'system' }` (TECH-SPEC §14.2 "actor =
   * system … on behalf of the affected principal"), so per-principal rows
   * (daily note, task, drive, agent) are created for that principal.
   * `{ agentOf: p }`: the step runs as p's personal agent (`kind: 'agent'`,
   * `onBehalfOf: p`), audited as an agent action.
   */
  actor: 'system' | { agentOf: PrincipalId }
  /** A failing optional step does not fail the execution (`partially_succeeded`). */
  optional?: boolean
}

export interface DomainRule<E extends DomainEvent = DomainEvent> {
  id: RuleId
  /** `domain_event.type` values that trigger this rule. */
  triggers: readonly DomainEventType[]
  scope: RuleScope
  /**
   * Executions this event expands to: the engine runs one per target. R1: the
   * organiser, or every Rox attendee with `params.for = 'all_rox_attendees'`.
   */
  targets(ctx: RuleCtx, event: E): Promise<readonly RuleTarget[]>
  /** Reads `automation_rule` (+ the per-user override for R1). */
  enabled(ctx: RuleCtx, event: E): Promise<boolean>
  /** `null` → run; otherwise the execution is recorded as `skipped`. */
  conditions(ctx: RuleCtx, event: E): Promise<SkipReason | null>
  /** Idempotency key (`rule_execution.idempotency_key`, DATA-MODEL §5.16). */
  key(ctx: RuleCtx, event: E): string
  /** Ordered steps; each is one command. */
  steps(ctx: RuleCtx, event: E): readonly RuleStep[] | Promise<readonly RuleStep[]>
}

/** Deterministic command id of a step: its own override, else `{key}:{step}`. */
export function ruleStepCommandId(step: RuleStep, idempotencyKey: string): string {
  return step.commandId ?? `${idempotencyKey}:${step.name}`
}

/** Command id shared by R2 step 2 and R3 step 1: one personal agent per member. */
export function personalAgentCommandId(workspaceId: string, principalId: PrincipalId): string {
  return `R-agent:${workspaceId}:${principalId}`
}

/** The actor a step dispatches as (see `RuleStep.actor`). */
export function ruleStepActor(step: RuleStep, subject: PrincipalId, agentId?: PrincipalId): CommandActor {
  if (step.actor === 'system') return { principalId: subject, kind: 'system' }
  if (!agentId) throw new Error(`Rule step ${step.name} needs the personal agent of ${subject}`)
  return { principalId: agentId, kind: 'agent', onBehalfOf: subject }
}