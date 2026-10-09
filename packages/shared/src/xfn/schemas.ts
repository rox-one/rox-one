/**
 * W1-15 (#1512) — Zod schemas for the cross-functional capability contracts
 * X-13…X-26 (TECH-SPEC §20).
 *
 * `@rox/core/xfn` holds the types, risk classes and reference handlers; these
 * are the wire schemas (`registry.bindSchema`). `@rox/core` has no zod
 * dependency, so the schemas live here — the same split W1-03 uses for the
 * command envelope and W1-04 for `entity_link`.
 *
 * Queries (`agenda.today`, `people.get_overview`) and the UI command
 * (`agents.panel_open`) have no domain command behind them; their schemas are
 * still validated at the entry point, so they are declared here too.
 */

import { z } from 'zod'
import { entityKindSchema, entityRefSchema } from '../entities/schemas'
import { MAX_COMMAND_ID_LENGTH } from '@rox/core/commands'

/** ISO-8601 instant; the contract never accepts a local wall-clock string. */
const instantSchema = z
  .string()
  .min(20)
  .max(40)
  .refine((value) => Number.isFinite(Date.parse(value)) && /[Tt]/.test(value), { message: 'expected an ISO-8601 instant' })

/** Calendar day (`YYYY-MM-DD`) or a full instant. */
const dayOrInstantSchema = z
  .string()
  .min(10)
  .max(40)
  .refine((value) => /^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isFinite(Date.parse(value)), { message: 'expected a date or an ISO-8601 instant' })

const shortText = z.string().min(1).max(512)
const longText = z.string().max(20_000)
const principalIdSchema = z.string().min(1).max(MAX_COMMAND_ID_LENGTH)

/** 1…50 refs (the context cap of TECH-SPEC §18.1, reused for bulk entry points). */
const refListSchema = z.array(entityRefSchema).min(1).max(50)

// ---------------------------------------------------------------------------
// X-13 entities.drop / X-19 commands.batch / X-26 pins (core dispatcher)
// ---------------------------------------------------------------------------

export const entitiesDropSchema = z
  .object({
    source: refListSchema,
    target: entityRefSchema,
    /** Free-form hint from the drop affordance (`attach`, `copy`, `move`, …). */
    intent: z.string().min(1).max(64).optional(),
  })
  .strict()
export type EntitiesDropPayload = z.infer<typeof entitiesDropSchema>

const batchItemSchema = z
  .object({
    type: z.string().min(3).max(128),
    payload: z.unknown(),
    target: entityRefSchema.optional(),
  })
  .strict()

export const commandsBatchSchema = z
  .object({
    commands: z.array(batchItemSchema).min(1).max(200),
    /** Human label of the batch; becomes the undo group label (§20 X-19). */
    label: shortText,
  })
  .strict()
export type CommandsBatchPayload = z.infer<typeof commandsBatchSchema>

export const entitiesPinSchema = z.object({ ref: entityRefSchema }).strict()
export type EntitiesPinPayload = z.infer<typeof entitiesPinSchema>

export const entitiesReorderPinsSchema = z.object({ refs: refListSchema }).strict()
export type EntitiesReorderPinsPayload = z.infer<typeof entitiesReorderPinsSchema>

// ---------------------------------------------------------------------------
// X-14 time blocks (calendar)
// ---------------------------------------------------------------------------

export const calendarCreateTimeBlockSchema = z
  .object({
    taskRef: entityRefSchema,
    start: instantSchema,
    end: instantSchema,
    /** Defaults to the task title when the owner module resolves it. */
    title: shortText.optional(),
  })
  .strict()
  .refine((value) => Date.parse(value.end) > Date.parse(value.start), { message: 'end must be after start' })
export type CalendarCreateTimeBlockPayload = z.infer<typeof calendarCreateTimeBlockSchema>

// ---------------------------------------------------------------------------
// X-15 meeting outcomes (meetings)
// ---------------------------------------------------------------------------

const decisionDraftSchema = z
  .object({ title: shortText, body: longText.optional(), decidedAt: instantSchema.optional() })
  .strict()

const outcomeTaskDraftSchema = z
  .object({
    title: shortText,
    assignee: entityRefSchema.optional(),
    due: instantSchema.optional(),
    description: longText.optional(),
  })
  .strict()

export const meetingsPublishOutcomesSchema = z
  .object({
    callId: z.string().min(1).max(256),
    decisions: z.array(decisionDraftSchema).max(50),
    tasks: z.array(outcomeTaskDraftSchema).max(50),
    summary: longText,
    /** Minutes doc the summary block and decisions are appended to. */
    minutesRef: entityRefSchema.optional(),
  })
  .strict()
export type MeetingsPublishOutcomesPayload = z.infer<typeof meetingsPublishOutcomesSchema>

// ---------------------------------------------------------------------------
// X-16 reminders (local `reminder` kind 18)
// ---------------------------------------------------------------------------

export const remindersCreateSchema = z
  .object({
    /** Any entity the reminder points at — the new `subjectRef` field (§5.18). */
    subjectRef: entityRefSchema,
    at: instantSchema,
    note: z.string().max(2000).optional(),
    /** `os` mirrors the reminder to the OS notification centre (§9.2 `reminder_due`). */
    deliver: z.array(z.enum(['inbox', 'os'])).max(2).optional(),
  })
  .strict()
export type RemindersCreatePayload = z.infer<typeof remindersCreateSchema>

export const remindersCancelSchema = z.object({ id: z.string().min(1).max(256) }).strict()
export type RemindersCancelPayload = z.infer<typeof remindersCancelSchema>

// ---------------------------------------------------------------------------
// X-17 check-in draft (goals) — read-only
// ---------------------------------------------------------------------------

export const checkinsDraftFromActivitySchema = z
  .object({
    subjectRef: entityRefSchema,
    /** Start of the activity window (inclusive). */
    since: instantSchema,
    /** Optional narrowing to one author. */
    authorRef: entityRefSchema.optional(),
  })
  .strict()
export type CheckinsDraftFromActivityPayload = z.infer<typeof checkinsDraftFromActivitySchema>

// ---------------------------------------------------------------------------
// X-18 linked work (goals)
// ---------------------------------------------------------------------------

/** `aligned-to` = goal/kpi/project contributes to a goal; `member-of` = task belongs to a project. */
export const GOAL_WORK_RELATIONS = ['aligned-to', 'member-of'] as const
export type GoalWorkRelation = (typeof GOAL_WORK_RELATIONS)[number]

export const goalsLinkWorkSchema = z
  .object({
    goalRef: entityRefSchema,
    workRef: entityRefSchema,
    /** Defaults by pair: `aligned-to` for goal↔goal/kpi/project, `member-of` for task→project. */
    relation: z.enum(GOAL_WORK_RELATIONS).optional(),
    /** `okr-of` marks a migrated project OKR (DATA-MODEL §6.1). */
    role: z.enum(['okr-of']).optional(),
  })
  .strict()
export type GoalsLinkWorkPayload = z.infer<typeof goalsLinkWorkSchema>

export const goalsUnlinkWorkSchema = goalsLinkWorkSchema
export type GoalsUnlinkWorkPayload = z.infer<typeof goalsUnlinkWorkSchema>

// ---------------------------------------------------------------------------
// X-20 people overview / X-21 agenda (read models, no commands)
// ---------------------------------------------------------------------------

export const peopleGetOverviewSchema = z.object({ personRef: entityRefSchema }).strict()
export type PeopleGetOverviewPayload = z.infer<typeof peopleGetOverviewSchema>

export const agendaTodaySchema = z
  .object({
    date: dayOrInstantSchema.optional(),
    timeZone: z.string().min(1).max(64).optional(),
  })
  .strict()
export type AgendaTodayPayload = z.infer<typeof agendaTodaySchema>

// ---------------------------------------------------------------------------
// X-22 create-from-email (tasks / calendar / docs / messenger)
// ---------------------------------------------------------------------------

export const tasksCreateFromEmailSchema = z
  .object({
    messageRef: entityRefSchema,
    title: shortText.optional(),
    assignee: entityRefSchema.optional(),
    due: instantSchema.optional(),
    listRef: entityRefSchema.optional(),
    description: longText.optional(),
  })
  .strict()
export type TasksCreateFromEmailPayload = z.infer<typeof tasksCreateFromEmailSchema>

export const calendarCreateEventFromEmailSchema = z
  .object({
    messageRef: entityRefSchema,
    title: shortText.optional(),
    start: instantSchema.optional(),
    end: instantSchema.optional(),
    /** `sender` | `participants` | explicit refs; a non-empty list is consequential (§12). */
    attendees: z.union([z.enum(['sender', 'participants']), refListSchema]),
    call: z.boolean().optional(),
    /** Extract an .ics attachment instead of the body. */
    fromAttachment: z.boolean().optional(),
  })
  .strict()
export type CalendarCreateEventFromEmailPayload = z.infer<typeof calendarCreateEventFromEmailSchema>

export const docsCreateFromEmailSchema = z
  .object({
    messageRef: entityRefSchema,
    title: shortText.optional(),
    folderRef: entityRefSchema.optional(),
    /** Keep the full thread, not only the selected message. */
    wholeThread: z.boolean().optional(),
  })
  .strict()
export type DocsCreateFromEmailPayload = z.infer<typeof docsCreateFromEmailSchema>

export const imShareEntitySchema = z
  .object({
    /** Usually a `mail-thread`, but any ref may be shared (X-13 also resolves here). */
    ref: entityRefSchema,
    chatRef: entityRefSchema,
    comment: z.string().max(2000).optional(),
    /** Attachments are imported into Drive first (`drive.import_attachment`). */
    importAttachments: z.boolean().optional(),
  })
  .strict()
export type ImShareEntityPayload = z.infer<typeof imShareEntitySchema>

// ---------------------------------------------------------------------------
// X-23 form submit actions (forms / tables / messenger)
// ---------------------------------------------------------------------------

export const FORM_ON_SUBMIT_KINDS = ['tasks.create', 'tables.insert_row', 'im.send_message'] as const
export type FormOnSubmitKind = (typeof FORM_ON_SUBMIT_KINDS)[number]

const formActionSchema = z
  .object({
    kind: z.enum(FORM_ON_SUBMIT_KINDS),
    /** Action-specific configuration; validated by the owner module on dispatch. */
    config: z.record(z.string(), z.unknown()),
  })
  .strict()

export const formsConfigureOnSubmitSchema = z.object({ formRef: entityRefSchema, actions: z.array(formActionSchema).max(20) }).strict()
export type FormsConfigureOnSubmitPayload = z.infer<typeof formsConfigureOnSubmitSchema>

// ---------------------------------------------------------------------------
// X-24 start a meeting (meetings)
// ---------------------------------------------------------------------------

export const vcStartMeetingSchema = z
  .object({
    origin: entityRefSchema,
    /** Empty = the origin's audience is used; a non-empty list is consequential. */
    invite: z.array(principalIdSchema).max(200).optional(),
    /** The meeting is scheduled on a calendar event as well. */
    eventRef: entityRefSchema.optional(),
    notesDocRef: entityRefSchema.optional(),
  })
  .strict()
export type VcStartMeetingPayload = z.infer<typeof vcStartMeetingSchema>

// ---------------------------------------------------------------------------
// X-25 agent panel entry point (UI command, no domain command)
// ---------------------------------------------------------------------------

export const agentsPanelOpenSchema = z
  .object({
    focusRef: entityRefSchema.optional(),
    /** Prefills the composer, e.g. «Про выделенное: » from ⌘⇧J (§25.2). */
    prefill: z.string().max(2000).optional(),
    /** Open even while the panel is hidden (⌘J / ⌘⇧J / context menu). */
    focusComposer: z.boolean().optional(),
  })
  .strict()
export type AgentsPanelOpenPayload = z.infer<typeof agentsPanelOpenSchema>

// ---------------------------------------------------------------------------
// Names X-15 / X-23 need and W1-15 registers (no owner module shipped them yet)
// ---------------------------------------------------------------------------

/** X-15 writes `decision` records (kind 49) for the published outcomes. */
export const decisionsCreateSchema = z
  .object({
    title: shortText,
    body: longText.optional(),
    /** The call the decision came from; also written as a `derived-from` link. */
    originRef: entityRefSchema.optional(),
    decidedAt: instantSchema.optional(),
  })
  .strict()
export type DecisionsCreatePayload = z.infer<typeof decisionsCreateSchema>

/** X-23 runtime action: one form response appended to a Base table. */
export const tablesInsertRowSchema = z
  .object({
    baseRef: entityRefSchema,
    tableRef: entityRefSchema.optional(),
    row: z.record(z.string(), z.unknown()),
    /** `formResponseId:actionIndex` while dispatching from a form submit (X-23). */
    idempotencyKey: z.string().min(1).max(MAX_COMMAND_ID_LENGTH).optional(),
  })
  .strict()
export type TablesInsertRowPayload = z.infer<typeof tablesInsertRowSchema>

// ---------------------------------------------------------------------------
// Kind tables the drop dispatcher and the risk classes read
// ---------------------------------------------------------------------------

/** Kinds accepted as a drop source / target; validated against the registry. */
export const xfnEntityKindSchema = entityKindSchema

export const XFN_SCHEMAS = {
  'entities.drop': entitiesDropSchema,
  'entities.pin': entitiesPinSchema,
  'entities.unpin': entitiesPinSchema,
  'entities.reorder_pins': entitiesReorderPinsSchema,
  'commands.batch': commandsBatchSchema,
  'calendar.create_time_block': calendarCreateTimeBlockSchema,
  'meetings.publish_outcomes': meetingsPublishOutcomesSchema,
  'reminders.create': remindersCreateSchema,
  'reminders.cancel': remindersCancelSchema,
  'checkins.draft_from_activity': checkinsDraftFromActivitySchema,
  'goals.link_work': goalsLinkWorkSchema,
  'goals.unlink_work': goalsUnlinkWorkSchema,
  'tasks.create_from_email': tasksCreateFromEmailSchema,
  'calendar.create_event_from_email': calendarCreateEventFromEmailSchema,
  'docs.create_from_email': docsCreateFromEmailSchema,
  'im.share_entity': imShareEntitySchema,
  'forms.configure_on_submit': formsConfigureOnSubmitSchema,
  'vc.start_meeting': vcStartMeetingSchema,
  'decisions.create': decisionsCreateSchema,
  'tables.insert_row': tablesInsertRowSchema,
} as const

/** Query / UI-entry schemas (not domain commands). */
export const XFN_QUERY_SCHEMAS = {
  'people.get_overview': peopleGetOverviewSchema,
  'agenda.today': agendaTodaySchema,
  'agents.panel_open': agentsPanelOpenSchema,
} as const

export type XfnCommandName = keyof typeof XFN_SCHEMAS
export type XfnQueryName = keyof typeof XFN_QUERY_SCHEMAS