/** W1-06 (#1503) — People & contacts: TECH-SPEC §4.6, §15; DATA-MODEL §5.11. */
import { z } from 'zod'
import { cmd, createIdShape, emailSchema, entity, idSchema, isoDateTimeSchema, nameSchema, principalIdSchema, refSchema, timeZoneSchema, urlSchema, type CommandSchemaMap } from '../common'

export const memberRoleSchema = z.enum(['owner', 'admin', 'member', 'guest'])
const handleSchema = z.object({ kind: z.enum(['email', 'phone', 'telegram', 'slack', 'github', 'x', 'url', 'other']), value: z.string().min(1).max(500), label: z.string().max(100).optional() }).strict()

export const contactCardSchema = entity({
  ownerId: idSchema.optional(), personId: idSchema.optional(), displayName: nameSchema, handles: z.array(handleSchema), organization: z.string().optional(),
  jobTitle: z.string().optional(), notes: z.string().optional(), starred: z.boolean().optional(), lastTouchAt: isoDateTimeSchema.optional(),
})
export const personSchema = entity({
  displayName: nameSchema, email: emailSchema.optional(), title: z.string().optional(), managerId: idSchema.optional(), timeZone: timeZoneSchema.optional(),
  role: memberRoleSchema.optional(), state: z.enum(['active', 'placeholder', 'guest', 'suspended']).optional(),
})

export const CONTACTS_COMMAND_SCHEMAS: CommandSchemaMap = {
  'people.invite': cmd({ ...createIdShape, email: emailSchema, displayName: nameSchema.optional(), role: memberRoleSchema.default('member'), spaceIds: z.array(idSchema).max(100).optional() }),
  'people.add_workspace_member': cmd({
    principalId: principalIdSchema, role: memberRoleSchema.default('member'),
    // W1-12 (#1509): R4 adds placeholders as invited members (DATA-MODEL §5.16);
    // the reference handler records `state: 'active'` until ONB owns invites.
    status: z.enum(['active', 'invited']).optional(),
  }),
  'people.update_profile': cmd({
    displayName: nameSchema.optional(), title: z.string().max(200).nullable().optional(), timeZone: timeZoneSchema.optional(),
    avatarUrl: urlSchema.nullable().optional(), about: z.string().max(5000).nullable().optional(),
  }).refine(value => Object.keys(value).length > 0, { message: 'empty update' }),
  'people.set_manager': cmd({ managerId: principalIdSchema.nullable() }),
  'people.convert_to_guest': cmd({ keepSpaceIds: z.array(idSchema).max(100).optional() }),
  'contacts.create_card': cmd({ ...createIdShape, displayName: nameSchema, handles: z.array(handleSchema).max(50).default([]), organization: z.string().max(200).optional(), jobTitle: z.string().max(200).optional(), notes: z.string().max(20_000).optional(), personId: idSchema.optional() }),
  'contacts.update_card': cmd({ displayName: nameSchema.optional(), handles: z.array(handleSchema).max(50).optional(), organization: z.string().max(200).nullable().optional(), jobTitle: z.string().max(200).nullable().optional(), notes: z.string().max(20_000).nullable().optional() })
    .refine(value => Object.keys(value).length > 0, { message: 'empty update' }),
  'contacts.merge_cards': cmd({ sourceIds: z.array(idSchema).min(1).max(50) }),
  'contacts.star': cmd({ starred: z.boolean() }),
  'contacts.add_touch': cmd({ at: isoDateTimeSchema.optional(), channel: z.string().max(64).optional(), source: refSchema.optional(), note: z.string().max(5000).optional() }),
}

export const CONTACTS_ENTITY_SCHEMAS = { contact: contactCardSchema, person: personSchema } as const
