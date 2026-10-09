/**
 * W1-14 (#1511) — Cross-surface command contracts (TECH-SPEC §12, package XSC).
 *
 * Every command that creates something **at** a place in another surface — a
 * task block in a doc, a task from a message, a group chat from a comment, a
 * call from a doc block — is one of these fourteen. They are ordinary
 * command-bus commands (zod-validated, idempotent through `command_receipt`,
 * emitting `domain_event`s); this module is their frozen signature and risk
 * table, and `@rox/server-core/xsc` binds the reference handlers.
 *
 * Shared rules (TECH-SPEC §12):
 * 1. every `*_from_*` and `insert_*_block` writes
 *    `entity_link(created → origin, 'derived-from', role:'origin', anchor)` in
 *    the same transaction;
 * 2. the block or card at the origin renders from the ref (live), never a copy;
 * 3. the idempotency key is the client `commandId`, and the entity a block
 *    command creates derives from `docRef + blockId`
 *    (`xscDerivationKey`), so a Yjs replay never double-creates;
 * 4. a private-note origin creates a local entity; the "create in workspace"
 *    choice dispatches to the server and the block stores the cross-authority
 *    ref;
 * 5. natural-language parsing runs client-side and is shown before confirm.
 */

import type { EntityRef } from '../entities/refs.ts'
import type { CommandOrigin } from '../commands/envelope.ts'
import type { CommandRiskContext, RiskClass } from '../commands/registry.ts'

// ── Origin ─────────────────────────────────────────────────────────────────

/**
 * The four origins of §12. `@rox/core/commands` already models them as
 * `CommandOrigin` variants, so the envelope type is reused instead of a second
 * union that could drift from it.
 */
export type XscOrigin = Extract<CommandOrigin, { kind: 'doc-block' } | { kind: 'message' } | { kind: 'comment' } | { kind: 'agent' }>

/** Principal id of a person. */
export type PersonRef = string

/** `ref` of `docs.insert_meeting_block`: an existing or scheduled call. */
export type NoteRef = string

/** A person, or an address to invite that has no account yet (§15.2). */
export type PersonOrEmail = PersonRef | { email: string }

/** What a Create-menu / quick-entry writes into a doc (X-01, X-02). */
export interface TaskDraft {
  title: string
  description?: string
  assignee?: PersonRef
  /** ISO-8601 date or timestamp. */
  due?: string
  listRef?: EntityRef
  followers?: PersonRef[]
}

/** What `docs.insert_event_block` and `calendar.create_event` write. */
export interface EventDraft {
  title: string
  /** ISO-8601 with offset. */
  start: string
  end: string
  /** IANA zone the times are authored in. */
  tz?: string
  attendees?: PersonOrEmail[]
  description?: string
  /** Also create a Rox call for the event. */
  call?: boolean
}

/** The `ref` of `docs.embed_view` (§12): a saved view, or an inline query. */
export type ViewQuery =
  | { kind: 'saved-view'; ref: EntityRef }
  | {
      kind: 'query'
      /** The list / base the query reads. */
      source: EntityRef
      filter?: Record<string, unknown>
      sort?: { field: string; direction: 'asc' | 'desc' }[]
      /** Row limit; the block renders "show all" beyond it. */
      limit?: number
    }

/**
 * The entity an origin is (the `to` side of the `derived-from` link). A
 * doc-block origin is the doc itself, with the block in the link anchor; a
 * message origin is the message.
 */
export function xscOriginRef(origin: XscOrigin): EntityRef {
  switch (origin.kind) {
    case 'doc-block': {
      const colon = origin.docRef.indexOf(':')
      return colon > 0 ? { kind: 'note', id: origin.docRef.slice(colon + 1) } : { kind: 'note', id: origin.docRef }
    }
    case 'message':
      return { kind: 'channel-message', id: `${origin.chatRef.includes(':') ? origin.chatRef.slice(origin.chatRef.indexOf(':') + 1) : origin.chatRef}:${origin.seq}` }
    case 'comment':
      return { kind: 'comment', id: origin.commentId }
    case 'agent': {
      const colon = origin.sessionRef.indexOf(':')
      return { kind: 'session', id: colon > 0 ? origin.sessionRef.slice(colon + 1) : origin.sessionRef }
    }
  }
}

/** The link anchor of an origin (§12 rule 1: `anchor`). */
export function xscOriginAnchor(origin: XscOrigin): Record<string, unknown> {
  switch (origin.kind) {
    case 'doc-block':
      return { blockId: origin.blockId }
    case 'message':
      return { seq: origin.seq }
    case 'comment':
      return { commentId: origin.commentId }
    case 'agent':
      return { sessionRef: origin.sessionRef, ...(origin.messageRef ? { messageRef: origin.messageRef } : {}) }
  }
}

/** `derived-from` is the relation every XSC command writes (§12 rule 1). */
export const XSC_DERIVED_FROM_RELATION = 'derived-from'

/** …with `role: 'origin'`, so backlinks and the Origin chip can find it. */
export const XSC_DERIVED_FROM_ROLE = 'origin'

/**
 * The stable derivation key of a block command (§12 rule 3). Two dispatches
 * for the same block — a reconnect, a Yjs replay, a retry with a fresh
 * `commandId` — derive the same entity id from it.
 */
export function xscDerivationKey(docRef: EntityRef, blockId: string): string {
  return `${docRef.kind}:${docRef.id}${docRef.fragment ? `#${docRef.fragment}` : ''}#${blockId}`
}

/** A checklist longer than this is a bulk action (§12: `> 20 → privileged`). */
export const XSC_BULK_TASK_LIMIT = 20

// ── Payloads and results (one pair per §12 line) ────────────────────────────

/** `docs.insert_task_block` → the block and the task it nested. */
export interface InsertTaskBlockPayload {
  docRef: EntityRef
  /** Client-generated Yjs block id; the created ids derive from it (rule 3). */
  blockId: string
  afterBlockId?: string
  task: TaskDraft
}

export interface InsertTaskBlockResult {
  blockId: string
  taskRef: EntityRef
}

/** `docs.insert_event_block`. */
export interface InsertEventBlockPayload {
  docRef: EntityRef
  blockId: string
  afterBlockId?: string
  event: EventDraft
}

export interface InsertEventBlockResult {
  blockId: string
  eventRef: EntityRef
  callRef?: EntityRef
}

/** `docs.insert_meeting_block` (X-15: "start a meeting from a doc"). */
export interface InsertMeetingBlockPayload {
  docRef: EntityRef
  blockId: string
  afterBlockId?: string
  mode: 'now' | 'scheduled'
  event?: EventDraft
}

export interface InsertMeetingBlockResult {
  blockId: string
  callRef: EntityRef
  eventRef?: EntityRef
}

/** `docs.embed_view` (X-22). */
export interface EmbedViewPayload {
  docRef: EntityRef
  blockId: string
  afterBlockId?: string
  ref: ViewQuery
}

export interface EmbedViewResult {
  blockId: string
}

/** `docs.create_from_messages`: a new doc, or an append to an existing one. */
export interface CreateFromMessagesPayload {
  chatRef: EntityRef
  seqs: number[]
  target: { new: { title: string; folderRef?: EntityRef } } | { append: NoteRef }
  format: 'quotes' | 'plain'
}

export interface CreateFromMessagesResult {
  docRef: EntityRef
}

/** `tasks.create_from_selection` (X-02). */
export interface CreateTaskFromSelectionPayload {
  origin: Extract<XscOrigin, { kind: 'doc-block' }>
  title: string
  description?: string
  assignee?: PersonRef
  due?: string
  listRef?: EntityRef
}

export interface CreateTaskPayload {
  taskRef: EntityRef
}

/** `tasks.create_many_from_checklist` (X-19 bulk). */
export interface CreateTasksFromChecklistPayload {
  docRef: EntityRef
  blockIds: string[]
  shared?: Partial<TaskDraft>
}

export interface CreateTasksFromChecklistResult {
  taskRefs: EntityRef[]
}

/** `tasks.create_from_message` (X-03): the task plus the card posted back. */
export interface CreateTaskFromMessagePayload {
  origin: Extract<XscOrigin, { kind: 'message' }>
  title: string
  assignee?: PersonRef
  due?: string
  listRef?: EntityRef
  followers?: PersonRef[]
}

export interface CreateTaskFromMessageResult {
  taskRef: EntityRef
  /** `seq` of the card message posted into the origin chat. */
  cardMessageSeq: number
}

/** `calendar.create_event`. */
export interface CreateEventPayload {
  calendarRef: EntityRef
  title: string
  start: string
  end: string
  tz: string
  attendees?: PersonOrEmail[]
  call?: boolean
  origin?: XscOrigin
  description?: string
}

export interface CreateEventResult {
  eventRef: EntityRef
  callRef?: EntityRef
}

/** `calendar.create_event_from_message`. */
export interface CreateEventFromMessagePayload {
  origin: Extract<XscOrigin, { kind: 'message' }>
  title?: string
  start?: string
  end?: string
  attendees: 'chat' | 'mentioned' | PersonRef[]
  call?: boolean
}

export interface CreateEventFromMessageResult {
  eventRef: EntityRef
  cardMessageSeq: number
}

/** `vc.start_meeting` (X-15). */
export interface StartMeetingPayload {
  origin?: XscOrigin
  participants?: PersonRef[]
  notesDocRef?: NoteRef
}

export interface StartMeetingResult {
  callRef: EntityRef
  joinUrl: string
}

/** `im.create_chat` (§12: a group created from a comment or a doc). */
export interface CreateChatPayload {
  kind: 'group' | 'channel'
  name?: string
  description?: string
  visibility: 'public' | 'private'
  members: PersonRef[]
  postingPolicy?: 'all' | 'admins'
  from?: XscOrigin
  /** Carry the last N messages of the origin chat into the new one. */
  carryContext?: { lastN: number }
}

export interface CreateChatResult {
  chatRef: EntityRef
}

/** `im.send_message` (the agent posts its report card the same way). */
export interface SendMessagePayload {
  chatRef: EntityRef
  /** TipTap JSON (mentions are nodes inside it, never text). */
  body: Record<string, unknown>
  mentions: PersonRef[]
  attribution?: 'user' | 'agent' | 'unprompted'
  notify?: 'default' | 'mentions_only'
  /** Stable id for a message the sender may re-send (agent report cards). */
  messageId?: string
}

export interface SendMessageResult {
  seq: number
}

/** `agents.invoke` (AGT-2; §13.1 routes it to an omp session). */
export interface InvokeAgentPayload {
  agentRef: EntityRef
  instruction: string
  origin: XscOrigin
  context?: EntityRef[]
}

export interface InvokeAgentResult {
  sessionRef: string
  replyThread: EntityRef
}

// ── Risk classes (TECH-SPEC §12 "risk", §13.2 step 5) ──────────────────────

/**
 * A doc-block insert is routine while the doc is private and consequential
 * once it is shared (§12). The command payload and `CommandRiskContext` carry
 * no authority discriminator, so the registry binds the strict side; a
 * local-authority host that knows the doc is private uses
 * `XSC_DOC_BLOCK_RISK.local`.
 */
export const XSC_DOC_BLOCK_RISK: Readonly<Record<'local' | 'workspace', RiskClass>> = {
  local: 'routine',
  workspace: 'consequential',
}

export function xscDocBlockRisk(_payload?: unknown, _ctx?: CommandRiskContext): RiskClass {
  return XSC_DOC_BLOCK_RISK.workspace
}

function assignedToOther(payload: unknown, ctx: CommandRiskContext): boolean {
  if (!payload || typeof payload !== 'object' || !('assignee' in payload)) return false
  const assignee = payload.assignee
  return typeof assignee === 'string' && assignee !== '' && assignee !== ctx.actor.principalId
}

/** `tasks.create_from_selection`: routine, consequential when assigning someone else. */
export function xscTaskAssignRisk(payload: unknown, ctx: CommandRiskContext): RiskClass {
  return assignedToOther(payload, ctx) ? 'consequential' : 'routine'
}

/** `tasks.create_many_from_checklist`: more than 20 rows is a bulk action. */
export function xscChecklistBulkRisk(payload: unknown): RiskClass {
  if (!payload || typeof payload !== 'object' || !('blockIds' in payload)) return 'routine'
  const ids = payload.blockIds
  return Array.isArray(ids) && ids.length > XSC_BULK_TASK_LIMIT ? 'privileged' : 'routine'
}

/** `docs.insert_meeting_block` / `docs.insert_event_block` carry the invitation in the draft. */
export function xscEventDraftRisk(payload: unknown): RiskClass {
  if (!payload || typeof payload !== 'object' || !('event' in payload)) return 'routine'
  return xscParticipantRisk(payload.event)
}

/** `docs.insert_task_block`: a shared doc makes the nested create consequential. */
export function xscNestedTaskRisk(payload: unknown, ctx: CommandRiskContext): RiskClass {
  const task = payload && typeof payload === 'object' && 'task' in payload ? payload.task : undefined
  return assignedToOther(task, ctx) ? 'consequential' : xscDocBlockRisk()
}

/** Any command that ends up inviting people (`attendees` / `participants`). */
export function xscParticipantRisk(payload: unknown): RiskClass {
  if (!payload || typeof payload !== 'object') return 'routine'
  const list = 'attendees' in payload ? payload.attendees : 'participants' in payload ? payload.participants : undefined
  return Array.isArray(list) && list.length > 0 ? 'consequential' : 'routine'
}

/** `calendar.create_event_from_message` always resolves at least one attendee. */
export function xscAlwaysParticipantRisk(): RiskClass {
  return 'consequential'
}

/** Everything else in §12: routine. */
export function xscRoutineRisk(): RiskClass {
  return 'routine'
}

/** `im.create_chat` and `agents.invoke` are consequential for an agent (§12). */
export function xscConsequentialRisk(): RiskClass {
  return 'consequential'
}

export type XscCommandType =
  | 'docs.insert_task_block'
  | 'tasks.create_from_selection'
  | 'tasks.create_many_from_checklist'
  | 'tasks.create_from_message'
  | 'docs.insert_event_block'
  | 'calendar.create_event'
  | 'calendar.create_event_from_message'
  | 'docs.insert_meeting_block'
  | 'vc.start_meeting'
  | 'docs.embed_view'
  | 'docs.create_from_messages'
  | 'im.create_chat'
  | 'im.send_message'
  | 'agents.invoke'

/** The fourteen §12 commands, in the order of the spec's code block. */
export const XSC_COMMAND_TYPES: readonly XscCommandType[] = [
  'docs.insert_task_block',
  'tasks.create_from_selection',
  'tasks.create_many_from_checklist',
  'tasks.create_from_message',
  'docs.insert_event_block',
  'calendar.create_event',
  'calendar.create_event_from_message',
  'docs.insert_meeting_block',
  'vc.start_meeting',
  'docs.embed_view',
  'docs.create_from_messages',
  'im.create_chat',
  'im.send_message',
  'agents.invoke',
]

/** The risk class of every §12 command; `@rox/server-core/xsc` binds these. */
export const XSC_COMMAND_RISK: Readonly<Record<XscCommandType, (payload: unknown, ctx: CommandRiskContext) => RiskClass>> = {
  'docs.insert_task_block': xscNestedTaskRisk,
  'tasks.create_from_selection': xscTaskAssignRisk,
  'tasks.create_many_from_checklist': xscChecklistBulkRisk,
  'tasks.create_from_message': xscTaskAssignRisk,
  'docs.insert_event_block': xscEventDraftRisk,
  'calendar.create_event': xscParticipantRisk,
  'calendar.create_event_from_message': xscAlwaysParticipantRisk,
  'docs.insert_meeting_block': xscRoutineRisk,
  'vc.start_meeting': xscParticipantRisk,
  'docs.embed_view': xscRoutineRisk,
  'docs.create_from_messages': xscRoutineRisk,
  'im.create_chat': xscConsequentialRisk,
  'im.send_message': xscRoutineRisk,
  'agents.invoke': xscConsequentialRisk,
}