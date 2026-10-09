/** W1-06 (#1503) — Notifications, reminders: TECH-SPEC §4.14; DATA-MODEL §5.13. */
import { z } from 'zod'
import { cmd, createIdShape, emptyPayload, entity, idSchema, isoDateTimeSchema, refSchema, type CommandSchemaMap } from '../common'

export const notificationChannelSchema = z.enum(['in_app', 'email', 'push', 'desktop'])
export const notificationSchema = entity({ recipientId: idSchema, type: z.string(), subjectRef: z.string().optional(), readAt: isoDateTimeSchema.optional(), payload: z.record(z.string(), z.unknown()).optional() })
export const reminderSchema = entity({ ownerId: idSchema.optional(), subjectRef: z.string(), remindAt: isoDateTimeSchema, note: z.string().optional(), state: z.enum(['scheduled', 'fired', 'cancelled']) })

export const NOTIFY_COMMAND_SCHEMAS: CommandSchemaMap = {
  'notifications.mark_read': cmd({ notificationIds: z.array(idSchema).min(1).max(500) }),
  'notifications.mark_all_read': cmd({ before: isoDateTimeSchema.optional() }),
  'notifications.update_prefs': cmd({
    prefs: z.array(z.object({ eventType: z.string().min(1).max(128), channel: notificationChannelSchema, enabled: z.boolean() }).strict()).min(1).max(500),
    quietHours: z.object({ start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/) }).strict().nullable().optional(),
  }),
  'reminders.create': cmd({ ...createIdShape, subject: refSchema.optional(), remindAt: isoDateTimeSchema, note: z.string().max(2000).optional() }),
  'reminders.cancel': emptyPayload,
}

export const NOTIFY_ENTITY_SCHEMAS = { notification: notificationSchema, reminder: reminderSchema } as const
