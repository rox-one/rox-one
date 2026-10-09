/** W1-06 (#1503) — Mail bridge, templates & export, forms, batches: TECH-SPEC §4.15, §20 X-19 / X-23. */
import { z } from 'zod'
import { cmd, createIdShape, idSchema, nameSchema, principalListSchema, refSchema, type CommandSchemaMap } from '../common'

export const WORKPLACE_COMMAND_SCHEMAS: CommandSchemaMap = {
  'mail.share_to_chat': cmd({ threadId: idSchema, chatId: idSchema.optional(), comment: z.string().max(5000).optional() }),
  'mail.create_task_from_thread': cmd({ ...createIdShape, threadId: idSchema, title: z.string().trim().min(1).max(500).optional(), listId: idSchema.optional(), assigneeIds: principalListSchema.optional() }),
  'project_templates.create_from_project': cmd({ ...createIdShape, name: nameSchema, includeTasks: z.boolean().default(true), includeMilestones: z.boolean().default(true) }),
  'project_templates.create_project': cmd({ ...createIdShape, name: nameSchema, spaceId: idSchema.optional(), startOn: z.iso.date().optional() }),
  'exports.markdown': cmd({ includeChildren: z.boolean().default(false) }),
  'commands.batch': cmd({
    commands: z.array(z.object({ type: z.string().regex(/^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/), target: refSchema.optional(), payload: z.unknown() }).strict()).min(1).max(100),
    atomic: z.boolean().default(true),
  }),
  'forms.configure_on_submit': cmd({ formRef: refSchema, actions: z.array(z.object({ type: z.string().min(1).max(128), params: z.record(z.string(), z.unknown()).optional() }).strict()).max(20) }),
}
