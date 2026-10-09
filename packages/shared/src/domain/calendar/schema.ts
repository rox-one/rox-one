/** W1-06 (#1503) — Calendar: TECH-SPEC §4.4, §12, §20; DATA-MODEL §5.10. */
import { z } from 'zod'
import { cmd, colorSchema, createIdShape, entity, idSchema, isoDateTimeSchema, longTextSchema, nameSchema, principalListSchema, refSchema, timeZoneSchema, titleSchema, type CommandSchemaMap } from '../common'

export const rsvpSchema = z.enum(['accepted', 'declined', 'tentative', 'needs_action'])
const timeRangeShape = { startAt: isoDateTimeSchema, endAt: isoDateTimeSchema, allDay: z.boolean().optional(), timeZone: timeZoneSchema.optional() }
const endAfterStart = (value: { startAt?: string; endAt?: string }) => !value.startAt || !value.endAt || Date.parse(value.endAt) >= Date.parse(value.startAt)
const RANGE = { message: 'endAt must not precede startAt', path: ['endAt'] }

export const calendarSchema = entity({ ownerType: z.enum(['user', 'space', 'resource', 'shared']), ownerId: idSchema.optional(), name: nameSchema, color: colorSchema.optional(), timeZone: timeZoneSchema.optional() })
export const calendarEventSchema = entity({
  calendarId: idSchema, organizerId: idSchema.optional(), title: z.string().max(500), description: z.string().optional(),
  startAt: isoDateTimeSchema, endAt: isoDateTimeSchema, allDay: z.boolean(), timeZone: timeZoneSchema.optional(), rrule: z.string().optional(),
  kind: z.enum(['event', 'time_block']).optional(), roomId: idSchema.optional(), callId: idSchema.optional(), notesDocId: idSchema.optional(),
  status: z.enum(['confirmed', 'tentative', 'cancelled']).optional(),
})

const eventCreateShape = {
  ...createIdShape, calendarId: idSchema.optional(), title: titleSchema, description: longTextSchema.optional(), ...timeRangeShape,
  rrule: z.string().max(1000).optional(), attendeeIds: principalListSchema.optional(), roomId: idSchema.optional(), location: z.string().max(500).optional(),
}

export const CALENDAR_COMMAND_SCHEMAS: CommandSchemaMap = {
  'calendar.create_event': cmd(eventCreateShape).refine(endAfterStart, RANGE),
  'calendar.update_event': cmd({
    title: titleSchema.optional(), description: longTextSchema.nullable().optional(), startAt: isoDateTimeSchema.optional(), endAt: isoDateTimeSchema.optional(),
    allDay: z.boolean().optional(), timeZone: timeZoneSchema.optional(), rrule: z.string().max(1000).nullable().optional(),
    attendeeIds: principalListSchema.optional(), location: z.string().max(500).nullable().optional(), scope: z.enum(['this', 'following', 'all']).optional(),
  }).refine(endAfterStart, RANGE),
  'calendar.delete_event': cmd({ scope: z.enum(['this', 'following', 'all']).optional() }),
  'calendar.rsvp': cmd({ response: rsvpSchema, comment: z.string().max(2000).optional() }),
  'calendar.create_calendar': cmd({ ...createIdShape, name: nameSchema, color: colorSchema.optional(), timeZone: timeZoneSchema.optional(), ownerType: z.enum(['user', 'space', 'shared']).optional(), ownerId: idSchema.optional() }),
  'calendar.subscribe': cmd({ calendarId: idSchema, color: colorSchema.optional(), hidden: z.boolean().optional() }),
  'calendar.book_room': cmd({ roomId: idSchema, ...timeRangeShape }).refine(endAfterStart, RANGE),
  'calendar.create_time_block': cmd({ ...createIdShape, title: titleSchema, ...timeRangeShape, source: refSchema.optional() }).refine(endAfterStart, RANGE),
  'calendar.create_event_from_message': cmd({ ...eventCreateShape, chatId: idSchema, seq: z.number().int().nonnegative() }).refine(endAfterStart, RANGE),
  'calendar.create_event_from_email': cmd({ ...eventCreateShape, threadId: idSchema }).refine(endAfterStart, RANGE),
}

export const CALENDAR_ENTITY_SCHEMAS = { calendar: calendarSchema, event: calendarEventSchema } as const
