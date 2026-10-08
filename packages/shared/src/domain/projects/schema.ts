/** W1-06 (#1503) — Projects, milestones, project check-ins, reviews: TECH-SPEC §4.8, §4.9; DATA-MODEL §5.5, §5.6. */
import { z } from 'zod'
import {
  cmd, createIdShape, duePrecisionSchema, emptyPayload, entity, idSchema, isoDateSchema, isoDateTimeSchema, jsonObjectSchema,
  nameSchema, principalIdSchema, refSchema, richTextSchema, sortKeySchema, titleSchema, type CommandSchemaMap,
} from '../common'
import { checkInPayloadShape, checkInStatusSchema, successStatusSchema } from '../goals/schema'
import { taskStatusSchema } from '../tasks/schema'

export const projectStatusSchema = z.enum(['active', 'paused', 'closed'])
export const contributorRoleSchema = z.enum(['champion', 'reviewer', 'contributor'])
const stageSchema = z.object({
  id: idSchema, title: z.string().max(500), done: z.boolean(),
  substages: z.array(z.object({ id: idSchema, title: z.string().max(500), done: z.boolean() }).strict()).max(100).default([]),
}).strict()

/** Fields DATA-MODEL §5.5 adds to the Rox project (local `ProjectConfig` and server `project`). */
export const projectSchema = entity({
  slug: z.string().max(200).optional(),
  name: nameSchema,
  spaceId: idSchema.optional(),
  parentGoalId: idSchema.optional(),
  championId: idSchema.optional(),
  reviewerId: idSchema.optional(),
  contributors: z.array(z.object({ personId: idSchema, role: contributorRoleSchema, responsibility: z.string().max(500).optional() }).strict()).optional(),
  status: projectStatusSchema.optional(),
  description: richTextSchema.optional(),
  startedAt: isoDateSchema.optional(),
  deadline: isoDateSchema.optional(),
  deadlinePrecision: duePrecisionSchema.optional(),
  checkInCadence: z.enum(['weekly', 'biweekly', 'monthly', 'quarterly', 'none']).optional(),
  nextCheckInDueAt: isoDateTimeSchema.optional(),
  lastCheckInId: idSchema.optional(),
  lastCheckInStatus: checkInStatusSchema.optional(),
  closedAt: isoDateTimeSchema.optional(),
  successStatus: successStatusSchema.optional(),
  pausedAt: isoDateTimeSchema.optional(),
  privacy: z.enum(['private', 'members', 'space', 'company']).optional(),
})

export const milestoneSchema = entity({
  projectId: idSchema,
  title: titleSchema,
  description: richTextSchema.optional(),
  status: z.enum(['pending', 'done']),
  roadmapStatus: z.enum(['planned', 'active', 'done', 'blocked']).optional(),
  startOn: isoDateSchema.optional(),
  dueOn: isoDateSchema.optional(),
  duePrecision: duePrecisionSchema.optional(),
  completedAt: isoDateTimeSchema.optional(),
  stages: z.array(stageSchema).max(200),
  sortKey: sortKeySchema,
})

export const PROJECTS_COMMAND_SCHEMAS: CommandSchemaMap = {
  'projects.create': cmd({
    ...createIdShape, name: nameSchema, slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/).optional(), spaceId: idSchema.optional(),
    parentGoalId: idSchema.optional(), championId: principalIdSchema.optional(), reviewerId: principalIdSchema.optional(),
    description: richTextSchema.optional(), startedAt: isoDateSchema.optional(), deadline: isoDateSchema.optional(),
    deadlinePrecision: duePrecisionSchema.optional(), privacy: z.enum(['private', 'members', 'space', 'company']).optional(),
    templateId: idSchema.optional(),
  }),
  'projects.update_name': cmd({ name: nameSchema }),
  'projects.update_description': cmd({ description: richTextSchema }),
  'projects.update_parent_goal': cmd({ parentGoalId: idSchema.nullable() }),
  'projects.update_champion': cmd({ championId: principalIdSchema.nullable() }),
  'projects.update_reviewer': cmd({ reviewerId: principalIdSchema.nullable() }),
  'projects.add_contributor': cmd({ personId: principalIdSchema, role: contributorRoleSchema.default('contributor'), responsibility: z.string().max(500).optional() }),
  'projects.update_contributor': cmd({ personId: principalIdSchema, role: contributorRoleSchema.optional(), responsibility: z.string().max(500).nullable().optional() }),
  'projects.remove_contributor': cmd({ personId: principalIdSchema, role: contributorRoleSchema.optional() }),
  'projects.update_dates': cmd({ startedAt: isoDateSchema.nullable().optional(), deadline: isoDateSchema.nullable().optional(), deadlinePrecision: duePrecisionSchema.optional() }),
  'projects.pause': emptyPayload,
  'projects.resume': emptyPayload,
  'projects.close': cmd({ successStatus: successStatusSchema, retrospective: richTextSchema.optional(), closedAt: isoDateTimeSchema.optional() }),
  'projects.move': cmd({ spaceId: idSchema.nullable() }),
  'projects.delete': emptyPayload,
  'projects.share': cmd({ workspaceId: idSchema, spaceId: idSchema.optional() }),
  'projects.add_resource': cmd({ resource: refSchema, title: z.string().max(500).optional() }),
  'projects.remove_resource': cmd({ resource: refSchema }),
  'projects.update_task_statuses': cmd({ statuses: z.array(taskStatusSchema).min(1).max(30) }),
  'milestones.create': cmd({
    ...createIdShape, projectId: idSchema, title: titleSchema, description: richTextSchema.optional(), startOn: isoDateSchema.optional(),
    dueOn: isoDateSchema.optional(), duePrecision: duePrecisionSchema.optional(), stages: z.array(stageSchema).max(200).optional(),
    sortKey: sortKeySchema.optional(), roadmapStatus: z.enum(['planned', 'active', 'done', 'blocked']).optional(),
  }),
  'milestones.update': cmd({
    title: titleSchema.optional(), description: richTextSchema.nullable().optional(), startOn: isoDateSchema.nullable().optional(),
    dueOn: isoDateSchema.nullable().optional(), duePrecision: duePrecisionSchema.optional(), stages: z.array(stageSchema).max(200).optional(),
    roadmapStatus: z.enum(['planned', 'active', 'done', 'blocked']).nullable().optional(),
  }).refine(value => Object.keys(value).length > 0, { message: 'empty update' }),
  'milestones.complete': cmd({ openTasks: z.enum(['keep', 'complete', 'move']).default('keep'), moveToMilestoneId: idSchema.optional() }),
  'milestones.reopen': emptyPayload,
  'milestones.delete': emptyPayload,
  'milestones.reorder': cmd({ order: z.array(idSchema).min(1).max(500) }),
  'projects.create_check_in': cmd({ ...createIdShape, ...checkInPayloadShape }),
  'projects.update_check_in': cmd({ status: checkInStatusSchema.optional(), message: richTextSchema.optional() }),
  'projects.delete_check_in': emptyPayload,
  'projects.acknowledge_check_in': emptyPayload,
  'reviews.create': cmd({ ...createIdShape, subjectType: z.enum(['goal', 'project', 'okr_cycle']), subjectId: idSchema, successStatus: successStatusSchema.optional(), notes: richTextSchema.optional(), docId: idSchema.optional() }),
  'reviews.acknowledge': emptyPayload,
  'reviews.create_cycle_review': cmd({ ...createIdShape, okrCycleId: idSchema, notes: richTextSchema.optional(), score: jsonObjectSchema.optional() }),
}

export const PROJECTS_ENTITY_SCHEMAS = { project: projectSchema, milestone: milestoneSchema } as const
