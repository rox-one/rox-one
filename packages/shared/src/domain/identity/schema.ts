/** W1-06 (#1503) — Workspaces, identity lifecycle, onboarding, agents: TECH-SPEC §12–§15, §17.2. */
import { z } from 'zod'
import { cmd, createIdShape, emailSchema, idSchema, nameSchema, principalIdSchema, refSchema, timeZoneSchema, type CommandSchemaMap } from '../common'

export const IDENTITY_COMMAND_SCHEMAS: CommandSchemaMap = {
  'workspaces.create': cmd({ ...createIdShape, name: nameSchema, slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/).optional(), timeZone: timeZoneSchema.optional() }),
  'identity.ensure_placeholder': cmd({ ...createIdShape, displayName: nameSchema, email: emailSchema.optional(), externalRef: z.string().max(500).optional() }),
  'identity.activate_placeholder': cmd({ placeholderId: idSchema, principalId: principalIdSchema }),
  'identity.merge_placeholder': cmd({ placeholderId: idSchema, intoPrincipalId: principalIdSchema }),
  'onboarding.seed_starter_content': cmd({ pack: z.enum(['welcome', 'team', 'personal']).default('welcome'), locale: z.string().max(16).optional() }),
}

export const AGENTS_COMMAND_SCHEMAS: CommandSchemaMap = {
  'agents.provision_personal_agent': cmd({ ...createIdShape, ownerId: principalIdSchema, name: nameSchema.optional() }),
  'agents.invoke': cmd({ ...createIdShape, agentId: idSchema, prompt: z.string().min(1).max(50_000), context: z.array(refSchema).max(100).optional() }),
  'agents.decide_approval': cmd({ approvalId: idSchema, decision: z.enum(['approve', 'deny']), note: z.string().max(2000).optional() }),
  'agents.pause': cmd({ agentId: idSchema, paused: z.boolean().default(true) }),
}
