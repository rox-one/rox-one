/** W1-06 (#1503) — `acl.*` sharing commands: TECH-SPEC §11.5; DATA-MODEL §5.14 (engine: W1-04). */
import { z } from 'zod'
import { cmd, createIdShape, entity, idSchema, principalIdSchema, refSchema, type CommandSchemaMap } from '../common'

export const aclRoleSchema = z.enum(['viewer', 'commenter', 'editor', 'full_access', 'owner'])
export const aclPrincipalSchema = z.object({ kind: z.enum(['user', 'group', 'space', 'workspace', 'link', 'agent']), id: idSchema }).strict()
export const aclEntrySchema = entity({ subjectRef: z.string(), principalKind: z.string(), principalId: idSchema, role: aclRoleSchema, inherited: z.boolean().optional() })

export const ACL_COMMAND_SCHEMAS: CommandSchemaMap = {
  'acl.grant': cmd({ subject: refSchema.optional(), principal: aclPrincipalSchema, role: aclRoleSchema.exclude(['owner']), notify: z.boolean().optional(), message: z.string().max(2000).optional() }),
  'acl.revoke': cmd({ subject: refSchema.optional(), principal: aclPrincipalSchema }),
  'acl.set_link': cmd({ subject: refSchema.optional(), scope: z.enum(['off', 'workspace', 'anyone']), role: aclRoleSchema.extract(['viewer', 'commenter', 'editor']).optional() }),
  'acl.request_access': cmd({ ...createIdShape, subject: refSchema.optional(), role: aclRoleSchema.exclude(['owner']).default('viewer'), message: z.string().max(2000).optional() }),
  'acl.decide_request': cmd({ requestId: idSchema, decision: z.enum(['approve', 'deny']), role: aclRoleSchema.exclude(['owner']).optional() }),
  'acl.transfer_ownership': cmd({ subject: refSchema.optional(), toPrincipalId: principalIdSchema }),
}

export const ACL_ENTITY_SCHEMAS = { 'acl-entry': aclEntrySchema } as const
