/**
 * W1-14 (#1511) — Zod validation for the collaboration contracts
 * (TECH-SPEC §11, DATA-MODEL §5.17).
 *
 * Types come from `@rox/core/collab`; this file is the runtime boundary for
 * everything that arrives from a client: the presence heartbeats, the
 * suggestion observer, the doc-view ping, the read receipt and the free-busy
 * query. Payloads are strict objects — an unknown member is a VALIDATION
 * rejection (the convention of `@rox/shared/domain`).
 */

import { z } from 'zod'
import { PRESENCE_DEVICES, PRESENCE_STATUSES, SUGGESTION_DECISIONS, type DocSuggestion, type DocViewRecord, type PresenceHeartbeatPayload, type PresenceObjectPayload } from '@rox/core/collab'
import { CALENDAR_MEMBER_ROLES, CALENDAR_MEMBER_SUBJECT_TYPES } from '@rox/core/collab'
import { cmd, idSchema, isoDateTimeSchema, principalListSchema, refSchema, type CommandSchemaMap } from '../domain/common'

/** The Yjs relative-position envelope (`comment.anchor`, `doc_suggestion.anchor`). */
export const yAnchorSchema = z
  .object({
    start: z.string().min(4).max(512),
    end: z.string().min(4).max(512),
    quote: z.string().min(1).max(200).optional(),
    blockId: idSchema.optional(),
  })
  .strict()

const presenceDeviceSchema = z.enum(PRESENCE_DEVICES)

export const presenceHeartbeatSchema: z.ZodType<PresenceHeartbeatPayload> = z
  .object({
    status: z.enum(PRESENCE_STATUSES),
    device: presenceDeviceSchema,
    activeRef: refSchema.optional(),
    typingIn: idSchema.optional(),
  })
  .strict()

export const presenceObjectSchema: z.ZodType<PresenceObjectPayload> = z.object({ ref: refSchema }).strict()

export const timeRangeSchema = z
  .object({ start: isoDateTimeSchema, end: isoDateTimeSchema })
  .strict()
  .refine(range => Date.parse(range.end) > Date.parse(range.start), { message: 'range end must be after its start' })

export const freeBusySchema = cmd({
  principals: principalListSchema.min(1),
  range: timeRangeSchema,
  slotMinutes: z.number().int().min(5).max(240).optional(),
})

export const syncSuggestionsSchema = cmd({ suggestionIds: z.array(idSchema).max(500) })

export const decideSuggestionSchema = cmd({ suggestionId: idSchema, decision: z.enum(SUGGESTION_DECISIONS) })

export const DOC_SUGGESTION_STATUSES = ['open', 'accepted', 'rejected', 'stale'] as const

/** The mark kinds a client may report; `block` is derived from the doc structure. */
export const SUGGESTION_MARK_KINDS = ['insert', 'delete', 'replace', 'format', 'block'] as const

/**
 * A new suggestion mark: the kind, the Y-relative anchor the mark covers and
 * the summary the panel lists (`doc_suggestion`, 17-collab.sql).
 */
export const suggestChangesSchema = cmd({
  id: idSchema.optional(),
  kind: z.enum(SUGGESTION_MARK_KINDS.filter(kind => kind !== 'block')),
  anchor: yAnchorSchema,
  summary: z.string().min(1).max(2000),
})

/** `docs.record_view` and `im.mark_read` carry only their target / seq. */
export const markReadSchema = cmd({ seq: z.number().int().nonnegative() })

/** `docs.record_view`: the doc is the target, the call carries no other input. */
export const recordViewSchema = cmd({})

/** `doc_suggestion` row (`17-collab.sql`). */
export const docSuggestionSchema: z.ZodType<DocSuggestion> = z
  .object({
    suggestionId: idSchema,
    docId: idSchema,
    authorId: idSchema,
    kind: z.enum(SUGGESTION_MARK_KINDS),
    anchor: yAnchorSchema,
    summary: z.string().min(1).max(2000),
    status: z.enum(DOC_SUGGESTION_STATUSES),
    decidedBy: idSchema.optional(),
    decidedAt: isoDateTimeSchema.optional(),
    threadCommentId: idSchema.optional(),
    createdAt: isoDateTimeSchema,
  })
  .strict() as unknown as z.ZodType<DocSuggestion>

/** `doc_view` row (`17-collab.sql`). */
export const docViewSchema: z.ZodType<DocViewRecord> = z
  .object({
    docId: idSchema,
    principalId: idSchema,
    firstViewedAt: isoDateTimeSchema,
    lastViewedAt: isoDateTimeSchema,
    viewCount: z.number().int().positive(),
  })
  .strict()

/** `calendar_member` row (`17-collab.sql`). */
export const calendarMemberSchema = z
  .object({
    calendarId: idSchema,
    subjectType: z.enum(CALENDAR_MEMBER_SUBJECT_TYPES),
    subjectId: idSchema,
    role: z.enum(CALENDAR_MEMBER_ROLES),
    color: z.string().min(1).max(32).optional(),
    visible: z.boolean(),
    notify: z.boolean(),
    createdAt: isoDateTimeSchema,
  })
  .strict()

/** `field_revisions` jsonb of a patched row (TECH-SPEC §11.6). */
export const fieldRevisionsSchema = z.record(z.string().min(1).max(64), z.number().int().nonnegative())

/** A redacted busy block: what a `free_busy` subscriber receives. */
export const busyBlockSchema = z.object({ start: isoDateTimeSchema, end: isoDateTimeSchema, busy: z.literal(true) }).strict()

/** Payload schema per catalogue command this package owns. */
export const COLLAB_COMMAND_SCHEMAS: CommandSchemaMap = {
  'presence.heartbeat': presenceHeartbeatSchema,
  'docs.suggest_changes': suggestChangesSchema,
  'docs.record_view': recordViewSchema,
  'presence.join': presenceObjectSchema,
  'presence.leave': presenceObjectSchema,
  'calendar.free_busy': freeBusySchema,
  'docs.sync_suggestions': syncSuggestionsSchema,
  'docs.decide_suggestion': decideSuggestionSchema,
  'im.mark_read': markReadSchema,
}