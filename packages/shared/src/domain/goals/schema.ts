/** W1-06 (#1503) — Goals & OKR + check-ins schemas: TECH-SPEC §4.7, §4.9, §20; DATA-MODEL §5.4, §5.6. */
import { z } from 'zod'
import {
  cmd, createIdShape, duePrecisionSchema, emptyPayload, entity, idSchema, isoDateSchema, isoDateTimeSchema, jsonObjectSchema,
  nameSchema, principalIdSchema, principalListSchema, refSchema, richTextSchema, sortKeySchema, timeZoneSchema,
  type CommandSchemaMap,
} from '../common'

export const checkInStatusSchema = z.enum(['on_track', 'caution', 'off_track', 'pending'])
export const goalScopeSchema = z.enum(['company', 'space', 'personal'])
export const cadenceSchema = z.enum(['weekly', 'biweekly', 'monthly', 'quarterly', 'none'])
export const successStatusSchema = z.enum(['achieved', 'missed'])
const weightSchema = z.number().min(0).max(999)
const evidenceSchema = z.array(z.object({ id: idSchema, label: z.string().max(500), uri: z.string().max(4096).optional(), source: z.string().max(200).optional(), observedAt: isoDateTimeSchema.optional() }).strict()).max(100)

const targetFields = {
  name: nameSchema,
  fromValue: z.number().finite(),
  toValue: z.number().finite(),
  value: z.number().finite().nullable(),
  unit: z.string().max(32),
  direction: z.enum(['increase', 'decrease']),
  weight: weightSchema,
  ownerId: principalIdSchema,
  evidence: evidenceSchema,
  measuredAt: isoDateTimeSchema,
  freshnessDays: z.number().int().min(0).max(3650),
}
const checkFields = { name: nameSchema, done: z.boolean(), weight: weightSchema, evidence: evidenceSchema }

export const goalTargetSchema = entity({ goalId: idSchema, sortKey: sortKeySchema, statusOverride: checkInStatusSchema.nullable().optional(), ...partial(targetFields), name: nameSchema, fromValue: z.number(), toValue: z.number() })
export const goalCheckSchema = entity({ goalId: idSchema, sortKey: sortKeySchema, doneAt: isoDateTimeSchema.optional(), doneBy: idSchema.optional(), ...partial(checkFields), name: nameSchema })

export const goalSchema = entity({
  scope: goalScopeSchema,
  spaceId: idSchema.optional(),
  parentGoalId: idSchema.optional(),
  goalKind: z.enum(['goal', 'objective']),
  okrCycleId: idSchema.optional(),
  name: nameSchema,
  description: richTextSchema.optional(),
  championId: idSchema.optional(),
  reviewerId: idSchema.optional(),
  creatorId: idSchema,
  startOn: isoDateSchema.optional(),
  dueOn: isoDateSchema.optional(),
  duePrecision: duePrecisionSchema.optional(),
  weight: weightSchema.optional(),
  sortKey: sortKeySchema.optional(),
  publishState: z.enum(['draft', 'published']),
  checkInCadence: cadenceSchema.optional(),
  lastCheckInId: idSchema.optional(),
  lastCheckInStatus: checkInStatusSchema.optional(),
  nextCheckInDueAt: isoDateTimeSchema.optional(),
  closedAt: isoDateTimeSchema.optional(),
  successStatus: successStatusSchema.optional(),
  closedBy: idSchema.optional(),
  /** Local mode embeds targets and checks (DATA-MODEL §5.4). */
  targets: z.array(goalTargetSchema.partial({ revision: true, authority: true })).optional(),
  checks: z.array(goalCheckSchema.partial({ revision: true, authority: true })).optional(),
})

export const okrCycleSchema = entity({
  name: nameSchema, startsOn: isoDateSchema, endsOn: isoDateSchema, timeZone: timeZoneSchema,
  status: z.enum(['draft', 'published', 'archived']), originProjectId: idSchema.optional(),
})

export const checkInSchema = entity({
  subjectType: z.enum(['goal', 'project']), subjectId: idSchema, authorId: idSchema, status: checkInStatusSchema,
  message: richTextSchema,
  targetSnapshot: z.array(z.object({ targetId: idSchema, value: z.number().nullable(), prevValue: z.number().nullable().optional() }).strict()).optional(),
  checkSnapshot: z.array(z.object({ checkId: idSchema, done: z.boolean() }).strict()).optional(),
  dueDateChange: z.object({ from: isoDateSchema.nullable(), to: isoDateSchema.nullable(), precision: duePrecisionSchema.optional() }).strict().optional(),
  source: z.enum(['form', 'kr_update', 'agent_draft', 'import']),
  state: z.enum(['draft', 'scheduled', 'published']),
  scheduledAt: isoDateTimeSchema.optional(), publishedAt: isoDateTimeSchema.optional(),
  notify: z.enum(['everyone', 'selected', 'none']),
  acknowledgedBy: idSchema.optional(), acknowledgedAt: isoDateTimeSchema.optional(), editableUntil: isoDateTimeSchema.optional(),
})

export const reviewSchema = entity({
  subjectType: z.enum(['goal', 'project', 'okr_cycle']), subjectId: idSchema, authorId: idSchema,
  successStatus: successStatusSchema.optional(), notes: richTextSchema.optional(), docId: idSchema.optional(), score: jsonObjectSchema.optional(),
  acknowledgedBy: idSchema.optional(), acknowledgedAt: isoDateTimeSchema.optional(),
})

function partial<T extends z.ZodRawShape>(shape: T): { [K in keyof T]: z.ZodOptional<T[K]> } {
  return Object.fromEntries(Object.entries(shape).map(([key, schema]) => [key, (schema as z.ZodType).optional()])) as unknown as { [K in keyof T]: z.ZodOptional<T[K]> }
}

export const checkInPayloadShape = {
  status: checkInStatusSchema,
  message: richTextSchema,
  targetValues: z.array(z.object({ targetId: idSchema, value: z.number().finite().nullable() }).strict()).max(200).optional(),
  checkValues: z.array(z.object({ checkId: idSchema, done: z.boolean() }).strict()).max(200).optional(),
  dueDateChange: z.object({ to: isoDateSchema.nullable(), precision: duePrecisionSchema.optional() }).strict().optional(),
  state: z.enum(['draft', 'scheduled', 'published']).optional(),
  scheduledAt: isoDateTimeSchema.optional(),
  notify: z.enum(['everyone', 'selected', 'none']).optional(),
  notifyIds: principalListSchema.optional(),
  source: z.enum(['form', 'kr_update', 'agent_draft', 'import']).optional(),
}

export const GOALS_COMMAND_SCHEMAS: CommandSchemaMap = {
  'goals.create': cmd({
    ...createIdShape, name: nameSchema, scope: goalScopeSchema.optional(), spaceId: idSchema.optional(), parentGoalId: idSchema.optional(),
    goalKind: z.enum(['goal', 'objective']).optional(), okrCycleId: idSchema.optional(), description: richTextSchema.optional(),
    championId: principalIdSchema.optional(), reviewerId: principalIdSchema.optional(), startOn: isoDateSchema.optional(),
    dueOn: isoDateSchema.optional(), duePrecision: duePrecisionSchema.optional(), weight: weightSchema.optional(),
    publishState: z.enum(['draft', 'published']).optional(), checkInCadence: cadenceSchema.optional(),
    targets: z.array(cmd({ ...createIdShape, ...partial(targetFields), name: nameSchema, fromValue: z.number().finite(), toValue: z.number().finite() })).max(50).optional(),
    checks: z.array(cmd({ ...createIdShape, name: nameSchema })).max(100).optional(),
  }),
  'goals.update_name': cmd({ name: nameSchema }),
  'goals.update_description': cmd({ description: richTextSchema }),
  'goals.update_parent_goal': cmd({ parentGoalId: idSchema.nullable() }),
  'goals.update_start_date': cmd({ startOn: isoDateSchema.nullable() }),
  'goals.update_due_date': cmd({ dueOn: isoDateSchema.nullable(), duePrecision: duePrecisionSchema.optional() }),
  'goals.update_champion': cmd({ championId: principalIdSchema.nullable() }),
  'goals.update_reviewer': cmd({ reviewerId: principalIdSchema.nullable() }),
  'goals.update_space': cmd({ spaceId: idSchema.nullable() }),
  'goals.update_access_levels': cmd({
    companyAccess: z.enum(['no_access', 'view', 'comment', 'edit', 'full_access']).optional(),
    spaceAccess: z.enum(['no_access', 'view', 'comment', 'edit', 'full_access']).optional(),
    entries: z.array(z.object({ principalId: principalIdSchema, role: z.enum(['viewer', 'commenter', 'editor', 'full_access']) }).strict()).max(500).optional(),
  }),
  'goals.create_target': cmd({ ...createIdShape, ...partial(targetFields), name: nameSchema, fromValue: z.number().finite(), toValue: z.number().finite(), sortKey: sortKeySchema.optional() }),
  'goals.update_target': cmd({ targetId: idSchema, ...partial(targetFields) }).refine(value => Object.keys(value).length > 1, { message: 'empty update' }),
  'goals.update_target_value': cmd({ targetId: idSchema, value: z.number().finite().nullable(), measuredAt: isoDateTimeSchema.optional() }),
  'goals.update_target_index': cmd({ targetId: idSchema, sortKey: sortKeySchema }),
  'goals.delete_target': cmd({ targetId: idSchema }),
  'goals.create_check': cmd({ ...createIdShape, name: nameSchema, weight: weightSchema.optional(), sortKey: sortKeySchema.optional() }),
  'goals.update_check': cmd({ checkId: idSchema, name: nameSchema.optional(), weight: weightSchema.optional(), evidence: evidenceSchema.optional() }),
  'goals.toggle_check': cmd({ checkId: idSchema, done: z.boolean() }),
  'goals.update_check_index': cmd({ checkId: idSchema, sortKey: sortKeySchema }),
  'goals.delete_check': cmd({ checkId: idSchema }),
  'goals.close': cmd({ successStatus: successStatusSchema, retrospective: richTextSchema.optional(), closedAt: isoDateTimeSchema.optional() }),
  'goals.reopen': cmd({ message: richTextSchema.optional() }),
  'goals.delete': emptyPayload,
  'goals.align': cmd({ toGoalId: idSchema }),
  'goals.unalign': cmd({ toGoalId: idSchema }),
  'goals.set_target_status_override': cmd({ targetId: idSchema, status: checkInStatusSchema.nullable() }),
  'okr.create_cycle': cmd({ ...createIdShape, name: nameSchema, startsOn: isoDateSchema, endsOn: isoDateSchema, timeZone: timeZoneSchema.optional() })
    .refine(value => value.startsOn <= value.endsOn, { message: 'cycle ends before it starts' }),
  'okr.publish_cycle': emptyPayload,
  'okr.publish_objectives': cmd({ goalIds: z.array(idSchema).min(1).max(200) }),
  'okr.import_from_cycle': cmd({ fromCycleId: idSchema, goalIds: z.array(idSchema).max(200).optional() }),
  'goals.create_check_in': cmd({ ...createIdShape, ...checkInPayloadShape }),
  'goals.update_check_in': cmd({ status: checkInStatusSchema.optional(), message: richTextSchema.optional(), targetValues: checkInPayloadShape.targetValues, checkValues: checkInPayloadShape.checkValues }),
  'goals.delete_check_in': emptyPayload,
  'goals.acknowledge_check_in': emptyPayload,
  'goals.record_check_in_summary': cmd({ checkInId: idSchema, status: checkInStatusSchema, at: isoDateTimeSchema.optional(), nextCheckInDueAt: isoDateTimeSchema.nullable().optional() }),
  'checkins.draft_from_activity': cmd({ ...createIdShape, since: isoDateTimeSchema.optional() }),
  'goals.link_work': cmd({ work: refSchema, relation: z.enum(['aligned-to', 'member-of']).optional() }),
  'goals.unlink_work': cmd({ work: refSchema, relation: z.enum(['aligned-to', 'member-of']).optional() }),
}

export const GOALS_ENTITY_SCHEMAS = {
  goal: goalSchema,
  'goal-target': goalTargetSchema,
  'goal-check': goalCheckSchema,
  'okr-cycle': okrCycleSchema,
  'check-in': checkInSchema,
  review: reviewSchema,
} as const
