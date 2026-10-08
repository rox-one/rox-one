/** W1-06 (#1503) — Meetings `vc.*`, `meetings.*`: TECH-SPEC §4.5, §12, §20; DATA-MODEL §5.10. */
import { z } from 'zod'
import { cmd, createIdShape, entity, idSchema, isoDateTimeSchema, principalListSchema, refSchema, titleSchema, type CommandSchemaMap } from '../common'

export const callSchema = entity({ eventId: idSchema.optional(), chatId: idSchema.optional(), title: z.string().optional(), startedAt: isoDateTimeSchema.optional(), endedAt: isoDateTimeSchema.optional(), recording: z.boolean().optional(), hostId: idSchema.optional() })

export const MEETINGS_COMMAND_SCHEMAS: CommandSchemaMap = {
  'vc.start_meeting': cmd({ ...createIdShape, title: titleSchema.optional(), eventId: idSchema.optional(), chatId: idSchema.optional(), inviteeIds: principalListSchema.optional() }),
  'vc.join': cmd({ callId: idSchema, audio: z.boolean().optional(), video: z.boolean().optional() }),
  'vc.end': cmd({ callId: idSchema }),
  'vc.set_recording': cmd({ callId: idSchema, recording: z.boolean() }),
  'meetings.publish_outcomes': cmd({
    notesDocId: idSchema.optional(), toChatId: idSchema.optional(),
    tasks: z.array(z.object({ title: titleSchema, assigneeIds: principalListSchema.optional(), dueAt: isoDateTimeSchema.optional() }).strict()).max(200).optional(),
    decisions: z.array(z.object({ title: titleSchema, source: refSchema.optional() }).strict()).max(200).optional(),
  }),
}

export const MEETINGS_ENTITY_SCHEMAS = { call: callSchema } as const
