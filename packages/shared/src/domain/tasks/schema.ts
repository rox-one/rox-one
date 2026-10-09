/** W1-06 (#1503) — Tasks (WorkItem) schemas: TECH-SPEC §4.3, §12, §20; DATA-MODEL §5.1. */
import { z } from 'zod'
import {
  cmd, createIdShape, duePrecisionSchema, emptyPayload, entity, idSchema, isoDateSchema, isoDateTimeSchema, jsonObjectSchema,
  longTextSchema, nameSchema, principalListSchema, refSchema, sortKeySchema, timeZoneSchema, titleSchema,
  type CommandSchemaMap,
} from '../common'

export const taskListIdSchema = z.enum(['inbox', 'today', 'upcoming', 'anytime', 'someday'])
export const workItemPrioritySchema = z.enum(['none', 'low', 'normal', 'high', 'urgent'])
export const workItemSizeSchema = z.enum(['xs', 's', 'm', 'l', 'xl'])
export const statusKeySchema = z.string().regex(/^[a-z][a-z0-9_:-]{0,63}$/)
export const recurrenceSchema = z.object({
  rule: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
  interval: z.number().int().min(1).max(999),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  mode: z.enum(['fixed', 'after']).optional(),
  until: z.number().int().optional(),
  timeZone: timeZoneSchema.optional(),
}).strict()
export const checklistItemSchema = z.object({ id: idSchema, title: z.string().max(500), done: z.boolean() }).strict()
export const reminderErrorSchema = z.enum(['permission-denied', 'permission-required', 'presentation-failed'])

/** Fields a create / update may set (DATA-MODEL §5.1 WorkItem). */
const workItemFields = {
  title: titleSchema,
  notes: longTextSchema,
  notesDoc: z.record(z.string(), z.unknown()),
  list: taskListIdSchema,
  startAt: isoDateTimeSchema,
  evening: z.boolean(),
  order: z.number().finite(),
  listId: idSchema,
  sectionId: idSchema,
  listGroupId: idSchema,
  parentId: idSchema,
  projectId: idSchema,
  milestoneId: idSchema,
  spaceId: idSchema,
  statusKey: statusKeySchema,
  priority: workItemPrioritySchema,
  size: workItemSizeSchema,
  dueAt: isoDateTimeSchema,
  duePrecision: duePrecisionSchema,
  assigneeIds: principalListSchema,
  reminderAt: isoDateTimeSchema,
  reminderTimeZone: timeZoneSchema,
  recurrence: recurrenceSchema,
  checklist: z.array(checklistItemSchema).max(500),
  tags: z.array(z.string().min(1).max(100)).max(100),
  customFields: jsonObjectSchema,
  estimateMinutes: z.number().int().min(0).max(1_000_000),
}

const nullable = <T extends z.ZodType>(schema: T) => schema.nullable().optional()

/** Update patch: every field optional; `null` clears an optional field. */
const workItemPatchShape = {
  title: titleSchema.optional(),
  notes: longTextSchema.optional(),
  notesDoc: nullable(z.record(z.string(), z.unknown())),
  startAt: nullable(isoDateTimeSchema),
  evening: z.boolean().optional(),
  priority: workItemPrioritySchema.optional(),
  size: nullable(workItemSizeSchema),
  dueAt: nullable(isoDateTimeSchema),
  duePrecision: nullable(duePrecisionSchema),
  recurrence: nullable(recurrenceSchema),
  checklist: z.array(checklistItemSchema).max(500).optional(),
  tags: z.array(z.string().min(1).max(100)).max(100).optional(),
  customFields: nullable(jsonObjectSchema),
  estimateMinutes: nullable(z.number().int().min(0).max(1_000_000)),
}

export const workItemSchema = entity({
  ...Object.fromEntries(Object.entries(workItemFields).map(([key, schema]) => [key, (schema as z.ZodType).optional()])),
  title: titleSchema,
  notes: z.string(),
  list: taskListIdSchema,
  evening: z.boolean(),
  order: z.number(),
  statusKey: statusKeySchema,
  priority: workItemPrioritySchema,
  assigneeIds: principalListSchema,
  tags: z.array(z.string()),
  ownerPrincipalId: idSchema,
  completedAt: isoDateTimeSchema.optional(),
  cancelledAt: isoDateTimeSchema.optional(),
  reopenedAt: isoDateTimeSchema.optional(),
  trashedAt: isoDateTimeSchema.optional(),
  archivedAt: isoDateTimeSchema.optional(),
  origin: refSchema.optional(),
})

/** Status definition carried in `task_statuses.update_set` / `projects|spaces.update_task_statuses` payloads. */
export const taskStatusDefinitionSchema = z.object({
  key: statusKeySchema,
  label: z.string().min(1).max(100),
  color: z.enum(['gray', 'blue', 'green', 'red', 'amber', 'purple']),
  icon: z.string().max(64).optional(),
  closed: z.boolean(),
  kind: z.enum(['open', 'done', 'canceled']),
}).strict()

/** Stored `task_status` row (520-work-item.sql): a status entry scoped to its set owner. */
export const taskStatusRowSchema = z.object({
  workspaceId: idSchema,
  setOwnerType: z.enum(['workspace', 'project', 'space', 'task_list']),
  setOwnerId: idSchema,
  key: statusKeySchema,
  label: z.string().min(1).max(100),
  color: z.enum(['gray', 'blue', 'green', 'red', 'amber', 'purple']),
  icon: z.string().max(64),
  closed: z.boolean(),
  kind: z.enum(['open', 'done', 'canceled']),
  sortKey: sortKeySchema,
}).strict()

export const taskListSchema = entity({
  ownerType: z.enum(['user', 'project', 'space', 'chat']),
  ownerId: idSchema,
  name: nameSchema,
  notes: z.string().optional(),
  deadlineAt: isoDateTimeSchema.optional(),
  groupId: idSchema.optional(),
  sortKey: sortKeySchema,
  statusSetEnabled: z.boolean(),
  completedAt: isoDateTimeSchema.optional(),
  archivedAt: isoDateTimeSchema.optional(),
})
export const taskSectionSchema = entity({ taskListId: idSchema, title: titleSchema, sortKey: sortKeySchema })
export const taskListGroupSchema = entity({ principalId: idSchema, name: nameSchema, sortKey: sortKeySchema, collapsed: z.boolean() })

const createTaskShape = {
  ...createIdShape,
  ...Object.fromEntries(Object.entries(workItemFields).map(([key, schema]) => [key, (schema as z.ZodType).optional()])),
  title: titleSchema,
}

const originShape = {
  title: titleSchema.optional(),
  listId: idSchema.optional(),
  assigneeIds: principalListSchema.optional(),
  dueAt: isoDateTimeSchema.optional(),
}

export const TASKS_COMMAND_SCHEMAS: CommandSchemaMap = {
  'tasks.create': cmd(createTaskShape),
  'tasks.update': cmd(workItemPatchShape).refine(value => Object.keys(value).length > 0, { message: 'empty update' }),
  'tasks.update_status': cmd({ statusKey: statusKeySchema }),
  'tasks.complete': cmd({ completedAt: isoDateTimeSchema.optional() }),
  'tasks.reopen': emptyPayload,
  'tasks.cancel': cmd({ cancelledAt: isoDateTimeSchema.optional() }),
  'tasks.archive': cmd({ archived: z.boolean().default(true) }),
  'tasks.delete': cmd({ hard: z.boolean().optional() }),
  'tasks.duplicate': cmd({ ...createIdShape, title: titleSchema.optional() }),
  'tasks.move': cmd({
    listId: idSchema.nullable().optional(),
    sectionId: idSchema.nullable().optional(),
    listGroupId: idSchema.nullable().optional(),
    parentId: idSchema.nullable().optional(),
    projectId: idSchema.nullable().optional(),
    spaceId: idSchema.nullable().optional(),
    milestoneId: idSchema.nullable().optional(),
  }).refine(value => Object.keys(value).length > 0, { message: 'empty move' }),
  'tasks.update_assignees': cmd({ add: principalListSchema.optional(), remove: principalListSchema.optional(), set: principalListSchema.optional() }),
  'tasks.set_user_state': cmd({
    list: taskListIdSchema.optional(), startAt: isoDateTimeSchema.nullable().optional(), evening: z.boolean().optional(),
    order: z.number().finite().optional(), hidden: z.boolean().optional(),
  }),
  'tasks.add_to_list': cmd({ listId: idSchema, sectionId: idSchema.optional(), sortKey: sortKeySchema.optional() }),
  'tasks.remove_from_list': cmd({ listId: idSchema }),
  'tasks.share': cmd({ workspaceId: idSchema, listId: idSchema.optional() }),
  'tasks.add_dependency': cmd({ blocks: idSchema.optional(), blockedBy: idSchema.optional() })
    .refine(value => (value.blocks === undefined) !== (value.blockedBy === undefined), { message: 'exactly one of blocks / blockedBy' }),
  'tasks.update_reminders': cmd({
    reminderAt: isoDateTimeSchema.nullable().optional(),
    reminderTimeZone: timeZoneSchema.optional(),
    reminderOffsets: z.array(z.number().int().min(0).max(525_600)).max(20).optional(),
    reminderOnDates: z.array(isoDateSchema).max(50).optional(),
    remindDueDay: z.boolean().optional(),
    remindOverdue: z.boolean().optional(),
  }),
  'task_lists.create': cmd({
    ...createIdShape, name: nameSchema, ownerType: z.enum(['user', 'project', 'space', 'chat']).optional(), ownerId: idSchema.optional(),
    notes: z.string().max(20_000).optional(), deadlineAt: isoDateTimeSchema.optional(), groupId: idSchema.optional(), sortKey: sortKeySchema.optional(),
    statusSetEnabled: z.boolean().optional(),
  }),
  'task_lists.update': cmd({
    name: nameSchema.optional(), notes: z.string().max(20_000).nullable().optional(), deadlineAt: isoDateTimeSchema.nullable().optional(),
    groupId: idSchema.nullable().optional(), sortKey: sortKeySchema.optional(), statusSetEnabled: z.boolean().optional(),
    completedAt: isoDateTimeSchema.nullable().optional(),
  }),
  'task_lists.archive': cmd({ archived: z.boolean().default(true) }),
  'task_lists.delete': emptyPayload,
  'task_sections.create': cmd({ ...createIdShape, taskListId: idSchema, title: titleSchema, sortKey: sortKeySchema.optional() }),
  'task_sections.update': cmd({ title: titleSchema }),
  'task_sections.move': cmd({ sortKey: sortKeySchema, taskListId: idSchema.optional() }),
  'task_sections.delete': emptyPayload,
  'task_list_groups.create': cmd({ ...createIdShape, name: nameSchema, sortKey: sortKeySchema.optional() }),
  'task_list_groups.update': cmd({ name: nameSchema.optional(), sortKey: sortKeySchema.optional(), collapsed: z.boolean().optional() }),
  'task_list_groups.delete': emptyPayload,
  'task_statuses.update_set': cmd({ statuses: z.array(taskStatusDefinitionSchema).min(1).max(30) })
    .refine(value => new Set(value.statuses.map(status => status.key)).size === value.statuses.length, { message: 'duplicate status key' }),
  'tasks.create_from_selection': cmd({ ...createIdShape, ...originShape, docRef: refSchema, blockId: idSchema, text: z.string().min(1).max(5000) }),
  'tasks.create_many_from_checklist': cmd({ docRef: refSchema, items: z.array(z.object({ blockId: idSchema, text: titleSchema }).strict()).min(1).max(100), listId: idSchema.optional() }),
  'tasks.create_from_message': cmd({ ...createIdShape, ...originShape, chatId: idSchema, seq: z.number().int().nonnegative() }),
  'tasks.create_from_email': cmd({ ...createIdShape, ...originShape, threadId: idSchema, messageId: idSchema.optional() }),
}

export const TASKS_ENTITY_SCHEMAS = {
  task: workItemSchema,
  'task-list': taskListSchema,
  'task-section': taskSectionSchema,
  'task-list-group': taskListGroupSchema,
  'task-status': taskStatusRowSchema,
} as const

