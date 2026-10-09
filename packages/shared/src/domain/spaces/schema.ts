/** W1-06 (#1503) — Spaces: TECH-SPEC §4.10; DATA-MODEL §5.7. */
import { z } from 'zod'
import { cmd, colorSchema, createIdShape, emptyPayload, entity, idSchema, nameSchema, principalListSchema, type CommandSchemaMap } from '../common'
import { taskStatusSchema } from '../tasks/schema'

export const spaceToolsSchema = z.object({
  goals_projects: z.boolean(), discussions: z.boolean(), docs: z.boolean(), tasks: z.boolean(), kpis: z.boolean(), templates: z.boolean(),
}).partial().strict()
export const spaceAccessSchema = z.enum(['members', 'company_view', 'company_comment', 'company_edit'])
export const spaceMemberRoleSchema = z.enum(['viewer', 'commenter', 'editor', 'full_access', 'owner'])

export const spaceSchema = entity({
  name: nameSchema, purpose: z.string().max(2000).optional(), icon: z.string().max(64).optional(), color: colorSchema.optional(),
  isCompanySpace: z.boolean(), tools: spaceToolsSchema, chatId: idSchema, rootFolderId: idSchema, wikiSpaceId: idSchema.optional(),
  defaultAccess: spaceAccessSchema, archivedAt: z.string().optional(),
})

const membersShape = z.array(z.object({ principalId: idSchema, role: spaceMemberRoleSchema }).strict()).min(1).max(500)

export const SPACES_COMMAND_SCHEMAS: CommandSchemaMap = {
  'spaces.create': cmd({
    ...createIdShape, name: nameSchema, purpose: z.string().max(2000).optional(), icon: z.string().max(64).optional(), color: colorSchema.optional(),
    tools: spaceToolsSchema.optional(), defaultAccess: spaceAccessSchema.optional(), memberIds: principalListSchema.optional(),
  }),
  'spaces.update': cmd({ name: nameSchema.optional(), purpose: z.string().max(2000).nullable().optional(), icon: z.string().max(64).nullable().optional(), color: colorSchema.nullable().optional() })
    .refine(value => Object.keys(value).length > 0, { message: 'empty update' }),
  'spaces.update_tools': cmd({ tools: spaceToolsSchema }),
  'spaces.add_members': cmd({ members: membersShape }),
  'spaces.remove_member': cmd({ principalId: idSchema }),
  'spaces.update_members_permissions': cmd({ members: membersShape }),
  'spaces.update_general_access': cmd({ defaultAccess: spaceAccessSchema }),
  'spaces.update_task_statuses': cmd({ statuses: z.array(taskStatusSchema).min(1).max(30) }),
  'spaces.join': emptyPayload,
  'spaces.leave': emptyPayload,
  'spaces.delete': cmd({ confirmName: nameSchema }),
}

export const SPACES_ENTITY_SCHEMAS = { space: spaceSchema } as const
