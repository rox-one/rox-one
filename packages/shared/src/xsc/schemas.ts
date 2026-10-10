/**
 * W1-14 (#1511) — Zod validation for the TECH-SPEC §12 cross-surface commands.
 *
 * These schemas replace the #1503 placeholders for the fourteen §12 names:
 * the spec's signatures are the contract wave 2 codes against, and §12 says so
 * explicitly ("types are shorthand; real schemas are zod"). Bindings happen in
 * `@rox/server-core/xsc`, together with the reference handlers.
 *
 * Two deliberate sharpening moves over the shorthand:
 * - a block command carries the **client block id** (`blockId`), because §12
 *   rule 3 defines the created entity id as `docRef + blockId` — a rule that
 *   cannot be implemented without it;
 * - `people` are principal ids (`person:<id>` refs stay entities): §12 writes
 *   `PersonRef` for assignees, attendees and members.
 */

import { z } from 'zod'
import { cmd, createIdShape, idSchema, isoDateTimeSchema, longTextSchema, refSchema, type CommandSchemaMap } from '../domain/common'
import { yAnchorSchema } from '../collab/schemas'

/** A principal id (`person` people are the references; the id is the principal). */
export const personRefSchema = idSchema

/** A person, or an email to invite (§15.2). */
export const personOrEmailSchema = z.union([personRefSchema, z.object({ email: z.string().email().max(320) }).strict()])

/** `note:<id>` as a string (§12 `NoteRef`: `docs.create_from_messages`, `vc.start_meeting`). */
export const noteRefSchema = z.string().max(512).regex(/^note:.+$/, { message: 'noteRef must look like note:<id>' })

const docBlockOriginSchema = z
  .object({ kind: z.literal('doc-block'), docRef: z.string().min(1).max(512), blockId: idSchema, anchor: yAnchorSchema.optional() })
  .strict()

const messageOriginSchema = z
  .object({ kind: z.literal('message'), chatRef: z.string().min(1).max(512), seq: z.number().int().nonnegative(), threadRootSeq: z.number().int().nonnegative().optional() })
  .strict()

const commentOriginSchema = z.object({ kind: z.literal('comment'), commentId: idSchema }).strict()

const agentOriginSchema = z.object({ kind: z.literal('agent'), sessionRef: z.string().min(1).max(512), messageRef: z.string().min(1).max(512).optional() }).strict()

/** The §12 `Origin` union, for the payloads that carry one inline. */
export const xscOriginSchema = z.union([docBlockOriginSchema, messageOriginSchema, commentOriginSchema, agentOriginSchema])

export const taskDraftSchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    description: longTextSchema.optional(),
    assignee: personRefSchema.optional(),
    due: z.string().min(1).max(64).optional(),
    listRef: refSchema.optional(),
    followers: z.array(personRefSchema).max(500).optional(),
  })
  .strict()

export const eventDraftSchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    start: isoDateTimeSchema,
    end: isoDateTimeSchema,
    tz: z.string().min(1).max(64).optional(),
    attendees: z.array(personOrEmailSchema).max(500).optional(),
    description: longTextSchema.optional(),
    call: z.boolean().optional(),
  })
  .strict()
  .refine(event => Date.parse(event.end) > Date.parse(event.start), { message: 'event end must not precede its start' })

export const viewQuerySchema = z.union([
  z.object({ kind: z.literal('saved-view'), ref: refSchema }).strict(),
  z
    .object({
      kind: z.literal('query'),
      source: refSchema,
      filter: z.record(z.string(), z.unknown()).optional(),
      sort: z.array(z.object({ field: z.string().min(1).max(64), direction: z.enum(['asc', 'desc']) }).strict()).max(8).optional(),
      limit: z.number().int().positive().max(1000).optional(),
    })
    .strict(),
])

/**
 * The block payload of every `docs.insert_*_block` / `docs.embed_view`.
 * `docRef` may be omitted when the envelope target already names the doc.
 */
const blockShape = { docRef: refSchema.optional(), blockId: idSchema, afterBlockId: idSchema.optional() }

export const XSC_COMMAND_SCHEMAS: CommandSchemaMap = {
  'docs.insert_task_block': cmd({ ...blockShape, task: taskDraftSchema }),
  'tasks.create_from_selection': cmd({
    ...createIdShape,
    origin: docBlockOriginSchema,
    title: z.string().trim().min(1).max(500),
    description: longTextSchema.optional(),
    assignee: personRefSchema.optional(),
    due: z.string().min(1).max(64).optional(),
    listRef: refSchema.optional(),
  }),
  'tasks.create_many_from_checklist': cmd({
    docRef: refSchema.optional(),
    blockIds: z.array(idSchema).min(1).max(500),
    shared: taskDraftSchema.partial().optional(),
  }),
  'tasks.create_from_message': cmd({
    ...createIdShape,
    origin: messageOriginSchema,
    title: z.string().trim().min(1).max(500),
    assignee: personRefSchema.optional(),
    due: z.string().min(1).max(64).optional(),
    listRef: refSchema.optional(),
    followers: z.array(personRefSchema).max(500).optional(),
  }),
  'docs.insert_event_block': cmd({ ...blockShape, event: eventDraftSchema }),
  'calendar.create_event': cmd({
    ...createIdShape,
    calendarRef: refSchema.optional(),
    title: z.string().trim().min(1).max(500),
    start: isoDateTimeSchema,
    end: isoDateTimeSchema,
    tz: z.string().min(1).max(64),
    attendees: z.array(personOrEmailSchema).max(500).optional(),
    call: z.boolean().optional(),
    origin: xscOriginSchema.optional(),
    description: longTextSchema.optional(),
  }).refine(payload => Date.parse(payload.end) > Date.parse(payload.start), { message: 'event end must not precede its start' }),
  'calendar.create_event_from_message': cmd({
    ...createIdShape,
    origin: messageOriginSchema,
    title: z.string().trim().min(1).max(500).optional(),
    start: isoDateTimeSchema.optional(),
    end: isoDateTimeSchema.optional(),
    attendees: z.union([z.literal('chat'), z.literal('mentioned'), z.array(personRefSchema).min(1).max(500)]),
    call: z.boolean().optional(),
  }),
  'docs.insert_meeting_block': cmd({ ...blockShape, mode: z.enum(['now', 'scheduled']), event: eventDraftSchema.optional() }),
  'vc.start_meeting': cmd({
    ...createIdShape,
    origin: xscOriginSchema.optional(),
    participants: z.array(personRefSchema).max(500).optional(),
    notesDocRef: noteRefSchema.optional(),
  }),
  'docs.embed_view': cmd({ ...blockShape, ref: viewQuerySchema }),
  'docs.create_from_messages': cmd({
    ...createIdShape,
    chatRef: refSchema.optional(),
    seqs: z.array(z.number().int().nonnegative()).min(1).max(500),
    target: z.union([
      z.object({ new: z.object({ title: z.string().trim().min(1).max(500), folderRef: refSchema.optional() }).strict() }).strict(),
      z.object({ append: noteRefSchema }).strict(),
    ]),
    format: z.enum(['quotes', 'plain']),
  }),
  // `im.create_chat` and `agents.invoke` are owned by `AGENTS_COMMAND_MODULE`
  // (W1-11 #1508): the wired registry runs that module's handler, so the §12
  // signatures that used to be bound here would only shadow the real schemas
  // (`@rox/shared/identity/schemas.ts: createChatSchema` /
  // `@rox/shared/agents/schemas.ts: agentInvokeSchema`). Their §12 risk class
  // also comes from the catalogue (`@rox/core/agents/risk.ts`), not from here.
  // Both remain in `XSC_COMMAND_TYPES` / `XSC_COMMAND_RISK` as the §12 record.

  'im.send_message': cmd({
    chatRef: refSchema.optional(),
    /** TipTap JSON; mentions are nodes inside it (§11.3), never parsed from text. */
    body: z.record(z.string(), z.unknown()),
    mentions: z.array(personRefSchema).max(500),
    attribution: z.enum(['user', 'agent', 'unprompted']).optional(),
    notify: z.enum(['default', 'mentions_only']).optional(),
    messageId: idSchema.optional(),
  }),
}