/**
 * W1-12 (#1509) — Automation rule schemas (TECH-SPEC §14, DATA-MODEL §5.16,
 * UI-SPEC §24 "settings API shape only, no UI here").
 *
 * Holds:
 * - the `automation_rule` / `rule_execution` wire shapes (settings API);
 * - the `docs.ensure_daily_note` / `docs.append_daily_link` contract that the
 *   rules dispatch (types in `@rox/core/docs/daily`);
 * - payload schemas of the new catalogue commands the rules need;
 * - payload schemas of the six W1-12 event types;
 * - the per-rule params of R1–R5.
 */

import { z } from 'zod'
import { RULE_IDS } from '@rox/core/automation'
import {
  cmd, emailSchema, idSchema, isoDateSchema, isoDateTimeSchema, principalIdSchema, refSchema,
  type CommandSchemaMap,
} from '../domain/common'

export const automationRuleIdSchema = z.enum(RULE_IDS)
export const ruleScopeSchema = z.enum(['workspace', 'principal'])
export const ruleExecutionStatusSchema = z.enum(['running', 'succeeded', 'partially_succeeded', 'failed', 'skipped'])
export const ruleStepStatusSchema = z.enum(['pending', 'succeeded', 'failed', 'skipped'])
export const ruleParamsSchema = z.record(z.string(), z.unknown())

// ── Settings API (UI-SPEC §24) ──────────────────────────────────────────────

/** `PUT /automation/rules/{ruleId}` body. */
export const automationRuleUpdateSchema = cmd({
  enabled: z.boolean().optional(),
  params: ruleParamsSchema.optional(),
  /** R1 only: the per-user override row (`scope: 'principal'`). */
  principalId: principalIdSchema.nullable().optional(),
}).refine(value => value.enabled !== undefined || value.params !== undefined, { message: 'nothing to update' })

export const automationRuleViewSchema = z.object({
  ruleId: automationRuleIdSchema,
  scope: ruleScopeSchema,
  enabled: z.boolean(),
  params: ruleParamsSchema,
  /** Effective value source; `default` means no `automation_rule` row exists. */
  source: z.enum(['workspace', 'principal', 'default']),
  updatedAt: isoDateTimeSchema.optional(),
  updatedBy: idSchema.optional(),
})

export const ruleStepRecordSchema = z.object({
  action: z.string().min(1).max(200),
  command_id: z.string().min(1).max(256),
  status: ruleStepStatusSchema,
  receipt_status: z.string().max(64).optional(),
  receipt_ref: z.string().max(512).optional(),
  error: z.string().max(2000).optional(),
  attempts: z.number().int().nonnegative().optional(),
  duration_ms: z.number().nonnegative().optional(),
  finished_at: isoDateTimeSchema.optional(),
}).strict()

export const ruleExecutionViewSchema = z.object({
  ruleExecutionId: idSchema,
  ruleId: automationRuleIdSchema,
  idempotencyKey: z.string().min(1).max(256),
  sourceEventId: z.string().min(1).max(256),
  status: ruleExecutionStatusSchema,
  steps: z.array(ruleStepRecordSchema).max(200),
  attempts: z.number().int().positive(),
  lastError: z.string().max(4000).optional(),
  /** Why a matched rule did not run (`skipped` rows; `SkipReason`). */
  skippedReason: z.string().max(64).optional(),
  createdAt: isoDateTimeSchema,
  finishedAt: isoDateTimeSchema.optional(),
})

export const automationRulesResponseSchema = z.object({
  enabled: z.boolean(),
  rules: z.array(automationRuleViewSchema).max(64),
})

export const ruleExecutionsResponseSchema = z.object({
  executions: z.array(ruleExecutionViewSchema).max(500),
  nextCursor: z.string().max(512).optional(),
})

// ── R1–R5 params (validated by the settings API) ────────────────────────────

export const r1ParamsSchema = z.object({
  for: z.enum(['organiser', 'all_rox_attendees']).optional(),
  skipAllDay: z.boolean().optional(),
  skipKeywords: z.array(z.string().min(1).max(64)).max(20).optional(),
  listSystemKey: z.string().min(1).max(64).optional(),
  prepTaskTitlePrefix: z.string().max(120).optional(),
}).strict()

export const r2ParamsSchema = z.object({
  announce: z.boolean().optional(),
  joinCardTemplate: z.string().min(1).max(2000).optional(),
}).strict()

export const r3ParamsSchema = z.object({
  welcomeTemplate: z.string().min(1).max(4000).optional(),
  handles: z.array(z.string().min(1).max(64)).max(20).optional(),
  locale: z.string().min(2).max(16).optional(),
}).strict()

export const r4ParamsSchema = z.object({ role: z.enum(['owner', 'admin', 'member']).optional() }).strict()

export const r5ParamsSchema = z.object({
  quotaBytes: z.number().int().positive().max(1024 ** 5).optional(),
  folders: z.array(z.string().min(1).max(120)).max(20).optional(),
}).strict()

/** Params schema per rule; the settings API validates the body against it. */
export const RULE_PARAMS_SCHEMAS: Readonly<Record<string, z.ZodType>> = {
  R1: r1ParamsSchema,
  R2: r2ParamsSchema,
  R3: r3ParamsSchema,
  R4: r4ParamsSchema,
  R5: r5ParamsSchema,
}

// ── Rule command payload schemas (the two W1-12 command names) ──────────────

export const AUTOMATION_COMMAND_SCHEMAS: CommandSchemaMap = {
  /** R1 step 1 — the per-user system list «Бэклог» (D-v2-4). */
  'task_lists.ensure_system_list': cmd({
    systemKey: z.string().min(1).max(64),
    ownerId: principalIdSchema.optional(),
    /** Deterministic list id (`systemListId`), so a replay finds the same list. */
    id: idSchema.optional(),
    name: z.string().trim().min(1).max(200).optional(),
  }),
  /** R4 step 4 — the invitation email (TECH-SPEC §15.2). */
  'notify.send_invite_email': cmd({
    email: emailSchema,
    principalId: principalIdSchema.optional(),
    role: z.enum(['owner', 'admin', 'member']).optional(),
    workspaceId: idSchema.optional(),
    message: z.string().max(2000).optional(),
  }),
}

// ── Daily-note contract (TECH-SPEC §14.3) ───────────────────────────────────

export const ensureDailyNoteRequestSchema = z.object({
  date: isoDateSchema,
  ownerId: principalIdSchema.optional(),
  id: idSchema.optional(),
}).strict()

export const appendDailyLinkRequestSchema = z.object({
  date: isoDateSchema,
  ownerId: principalIdSchema.optional(),
  id: idSchema.optional(),
  link: refSchema,
  label: z.string().max(500).optional(),
  /** Deterministic block id; re-runs update the block in place. */
  blockId: idSchema.optional(),
  time: isoDateTimeSchema.optional(),
}).strict()

// ── Trigger event payloads (§14.3, §15.1) ──────────────────────────────────

export const calendarEventSnapshotSchema = z.object({
  ref: refSchema,
  calendarId: idSchema,
  title: z.string().max(500),
  startAt: isoDateTimeSchema,
  endAt: isoDateTimeSchema,
  allDay: z.boolean(),
  timeZone: z.string().max(64).optional(),
  rrule: z.string().max(1000).optional(),
  status: z.enum(['confirmed', 'tentative', 'cancelled']).optional(),
  organizerId: principalIdSchema.optional(),
  attendeeIds: z.array(principalIdSchema).max(500).optional(),
  declinedByIds: z.array(principalIdSchema).max(500).optional(),
  transparency: z.enum(['busy', 'free']).optional(),
  keywords: z.array(z.string().max(64)).max(50).optional(),
})

export const calendarEventCreatedPayloadSchema = z.object({ event: calendarEventSnapshotSchema })
export const calendarExternalEventSeenPayloadSchema = z.object({
  event: calendarEventSnapshotSchema, provider: z.string().min(1).max(64), providerUid: z.string().min(1).max(512),
})
export const calendarOccurrenceUpcomingPayloadSchema = z.object({
  event: calendarEventSnapshotSchema, occurrenceStart: isoDateTimeSchema, occurrenceEnd: isoDateTimeSchema, leadMs: z.number().int().positive().optional(),
})

export const identityAccountCreatedPayloadSchema = z.object({
  principalId: principalIdSchema,
  email: emailSchema.optional(),
  displayName: z.string().max(200).optional(),
  locale: z.string().max(16).optional(),
  source: z.enum(['oidc', 'password', 'magic-link', 'local-profile']).optional(),
  verified: z.boolean().optional(),
})

export const peopleMemberAddedPayloadSchema = z.object({
  principalId: principalIdSchema,
  workspaceId: idSchema.optional(),
  status: z.enum(['active', 'invited']).optional(),
  generalChatId: idSchema.optional(),
  invitedBy: principalIdSchema.optional(),
})

export const peopleInvitationsSentPayloadSchema = z.object({
  invitations: z.array(z.object({
    email: emailSchema,
    role: z.enum(['owner', 'admin', 'member']).optional(),
    targets: z.array(refSchema).max(50).optional(),
    principalId: principalIdSchema.optional(),
  })).min(1).max(500),
  invitedBy: principalIdSchema.optional(),
  message: z.string().max(2000).optional(),
})

/** Data the settings API returns for one rule (UI-SPEC §24: settings API shape only). */
export type AutomationRuleView = z.infer<typeof automationRuleViewSchema>
export type RuleExecutionView = z.infer<typeof ruleExecutionViewSchema>
export type AutomationRuleUpdate = z.infer<typeof automationRuleUpdateSchema>