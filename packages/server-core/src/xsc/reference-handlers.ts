/**
 * W1-14 (#1511) — Reference handlers for the TECH-SPEC §12 cross-surface
 * commands.
 *
 * They are the *contract* implementation: they create the entity, write the
 * `derived-from` link to the origin (rule 1) and return the §12 result. The
 * wave-2 surfaces (XSC, MSG-2, TSK-1, CAL, MTG) replace them with the full
 * behaviour; the names, payloads and results below stay.
 *
 * Two rules are load-bearing here rather than in the UI:
 * - **rule 3**: a block command derives the ids it creates from
 *   `docRef + blockId` (`xscDerivationKey`), so a replayed command conflicts
 *   instead of creating a second row;
 * - **rule 2**: the block or card at the origin stores the **ref**, never a
 *   copy — a task created from a checklist item keeps its title empty and is
 *   rendered from the doc block it is anchored to.
 */

import { CommandRejection } from '@rox/core/commands'
import type { EntityRef } from '@rox/core/entities'
import { XSC_DERIVED_FROM_RELATION, XSC_DERIVED_FROM_ROLE, xscDerivationKey, xscOriginAnchor, xscOriginRef, type XscOrigin } from '@rox/core/xsc'

/** The message variant of the §12 origin union (the two `*_from_message` commands). */
type MessageOrigin = Extract<XscOrigin, { kind: 'message' }>
import { deterministicId, isDeleted, type ReferenceOutcome, type ReferenceTx } from '../work/reference/engine'
import { addLink, authorizeBound, authorizeId, authorizeOrigin, authorizeRef, authorizeTaskContainers, boundRef, refString, validateLink } from '../work/reference/ops'
import { appendMessage } from '../work/reference/specs/messenger'
import { taskDefaults } from '../work/reference/specs/tasks'
import type { RecordData, StoredRecord } from '../work/reference/types'
import type { ReferenceSpecMap } from '../work/reference/specs/types'

/** An id this module derives: the same inputs always produce the same uuid. */
function xscId(tx: ReferenceTx, ...parts: string[]): string {
  return deterministicId(tx.ctx.workspaceId, 'xsc', ...parts)
}

const out = (collection: string, record: StoredRecord, changes: string[], extra: Partial<ReferenceOutcome> = {}): ReferenceOutcome => ({
  collection, id: record.id, revision: record.revision, changes, ...extra,
})

/** `note:<id>` / `channel:<id>` / `session:<id>` payload strings. */
function idOfRef(value: string): string {
  const colon = value.indexOf(':')
  return colon > 0 ? value.slice(colon + 1) : value
}

/**
 * A `docRef` that may arrive as a ref string or as an `EntityRef`; `undefined`
 * when it is omitted and the envelope target names the doc (`boundRef`).
 */
function docRefOf(value: unknown): EntityRef | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') return { kind: 'note', id: idOfRef(value) }
  if (typeof value === 'object' && 'id' in value) {
    const id = value.id
    if (typeof id === 'string') return { kind: 'note', id }
  }
  throw new CommandRejection('VALIDATION', 'docRef must be a note reference')
}

const docRefLabel = (ref: EntityRef): string => refString(ref)

function taskFieldsFromDraft(draft: RecordData): RecordData {
  const fields: RecordData = { title: String(draft.title ?? '') }
  if (draft.description !== undefined) fields.notes = draft.description
  if (draft.assignee) fields.assigneeIds = [draft.assignee]
  if (draft.due !== undefined) fields.dueAt = draft.due
  if (draft.listRef) fields.listId = (draft.listRef as EntityRef).id
  return fields
}

/**
 * Create a task derived from an origin (rule 1). Everything that can fail is
 * checked before the first write, so a local (non-transactional) backend never
 * leaves a task without its link.
 */
async function insertTask(
  tx: ReferenceTx,
  id: string,
  fields: RecordData,
  originRef: EntityRef,
  anchor: Record<string, unknown>,
): Promise<{ ref: EntityRef; record: StoredRecord }> {
  validateLink({ kind: 'task', id }, originRef, XSC_DERIVED_FROM_RELATION)
  await tx.assertAbsent('task', id)
  const record = await tx.insert('task', id, { ...taskDefaults(tx), ...fields, origin: refString(originRef) })
  await addLink(tx, { kind: 'task', id }, originRef, XSC_DERIVED_FROM_RELATION, { role: XSC_DERIVED_FROM_ROLE, anchor })
  return { ref: { kind: 'task', id }, record }
}

/** A doc block that references a created entity (the doc renders it live). */
async function insertBlock(tx: ReferenceTx, docRef: EntityRef, blockId: string, kind: string, extra: RecordData): Promise<StoredRecord> {
  const id = xscId(tx, xscDerivationKey(docRef, blockId), 'block')
  await tx.assertAbsent('doc-block', id)
  return tx.insert('doc-block', id, { docKind: docRef.kind, docId: docRef.id, kind, afterBlockId: tx.payload.afterBlockId ?? null, ...extra })
}

/** Invitees: people are read; email-only invitees go through the invitation path (§15.2). */
async function authorizeAttendees(tx: ReferenceTx, attendees: readonly unknown[]): Promise<string[]> {
  const principals: string[] = []
  for (const attendee of attendees) {
    if (typeof attendee === 'string') {
      await authorizeRef(tx, { kind: 'person', id: attendee }, 'read')
      principals.push(attendee)
      continue
    }
    if (attendee && typeof attendee === 'object' && 'email' in attendee) principals.push(`email:${String(attendee.email)}`)
  }
  return principals
}

/** The calendar an event lands in: the payload's, or the caller's default one. */
async function resolveCalendar(tx: ReferenceTx, calendarRef: EntityRef | undefined): Promise<string> {
  if (calendarRef) {
    await authorizeBound(tx, calendarRef, 'write')
    await tx.require('calendar', calendarRef.id)
    return calendarRef.id
  }
  const id = xscId(tx, 'calendar', tx.actor)
  if (!(await tx.get('calendar', id))) await tx.insert('calendar', id, { name: `principal:${tx.actor}`, ownerType: 'principal', ownerId: tx.actor, isDefault: true })
  return id
}

/** An event with its RSVP rows, its calendar index entry and its origin link. */
async function insertEvent(
  tx: ReferenceTx,
  fields: { id: string; calendarId: string; title: string; start: string; end: string; timeZone?: string; description?: string },
  attendees: readonly string[],
  origin?: XscOrigin,
): Promise<StoredRecord> {
  await tx.assertAbsent('calendar-event', fields.id)
  const record = await tx.insert('calendar-event', fields.id, {
    calendarId: fields.calendarId,
    title: fields.title,
    startAt: fields.start,
    endAt: fields.end,
    ...(fields.timeZone ? { timeZone: fields.timeZone } : {}),
    ...(fields.description ? { description: fields.description } : {}),
    allDay: false,
    organizerId: tx.actor,
    status: 'confirmed',
  })
  const localAttendees = attendees.filter(principal => !principal.startsWith('email:'))
  for (const principalId of new Set([tx.actor, ...localAttendees])) {
    await tx.upsert('event-rsvp', `${fields.id}:${principalId}`, { status: principalId === tx.actor ? 'accepted' : 'needs_action' }, { eventId: fields.id, principalId })
  }
  for (const email of attendees.filter(principal => principal.startsWith('email:')).map(principal => principal.slice('email:'.length))) {
    await tx.upsert('event-rsvp', `${fields.id}:${email}`, { status: 'needs_action' }, { eventId: fields.id, inviteeEmail: email })
  }
  const index = await tx.get('calendar-index', fields.calendarId)
  const eventIds = index && !isDeleted(index) && Array.isArray(index.data.eventIds) ? (index.data.eventIds as string[]) : []
  await tx.upsert('calendar-index', fields.calendarId, { eventIds: [...new Set([...eventIds, fields.id])] }, { calendarId: fields.calendarId })
  if (origin) await addLink(tx, { kind: 'calendar-event', id: fields.id }, xscOriginRef(origin), XSC_DERIVED_FROM_RELATION, { role: XSC_DERIVED_FROM_ROLE, anchor: xscOriginAnchor(origin) })
  return record
}

/** A call with its participants (X-15). */
async function insertCall(tx: ReferenceTx, callId: string, participants: readonly string[], origin?: XscOrigin, notesDocRef?: string): Promise<StoredRecord> {
  await tx.assertAbsent('call', callId)
  const record = await tx.insert('call', callId, {
    hostId: tx.actor,
    state: 'live',
    startedAt: tx.now,
    recording: false,
    ...(origin ? { originRef: refString(xscOriginRef(origin)) } : {}),
    ...(notesDocRef ? { notesDocRef } : {}),
  })
  for (const principalId of new Set([tx.actor, ...participants])) {
    await tx.upsert('call-participant', `${callId}:${principalId}`, { joinedAt: tx.now, role: principalId === tx.actor ? 'host' : 'invitee' }, { callId, principalId })
  }
  if (origin) await addLink(tx, { kind: 'call', id: callId }, xscOriginRef(origin), XSC_DERIVED_FROM_RELATION, { role: XSC_DERIVED_FROM_ROLE, anchor: xscOriginAnchor(origin) })
  return record
}

/** The card a `*_from_message` command posts back into the origin chat (rule 2: a ref, not a copy). */
async function postCard(tx: ReferenceTx, chatId: string, salt: string, card: RecordData): Promise<StoredRecord> {
  await authorizeRef(tx, { kind: 'channel', id: chatId }, 'write')
  const chat = await tx.require('channel', chatId)
  return appendMessage(tx, chat, { doc: '', card }, {}, salt)
}

/** The active members of a chat, from the index the channel carries. */
async function chatMembers(tx: ReferenceTx, chatId: string): Promise<string[]> {
  const chat = await tx.require('channel', chatId)
  const indexed = Array.isArray(chat.data.memberIds) ? (chat.data.memberIds as string[]) : []
  return [...new Set([String(chat.data.ownerId ?? tx.actor), ...indexed])].filter(Boolean)
}

export const XSC_REFERENCE_SPECS: ReferenceSpecMap = {
  // ── docs.insert_*_block / embed_view (X-01, X-15, X-22) ──────────────────

  'docs.insert_task_block': {
    event: 'task.task_adding',
    op: async tx => {
      const docRef = boundRef(tx, docRefOf(tx.payload.docRef))
      const blockId = String(tx.payload.blockId)
      const draft = (tx.payload.task ?? {}) as RecordData
      if (draft.listRef) await authorizeTaskContainers(tx, { listId: (draft.listRef as EntityRef).id })
      const taskId = xscId(tx, xscDerivationKey(docRef, blockId), 'task')
      const { ref } = await insertTask(tx, taskId, taskFieldsFromDraft(draft), docRef, { blockId })
      const block = await insertBlock(tx, docRef, blockId, 'task', { taskRef: refString(ref) })
      // The doc embeds the entity its block renders (DATA-MODEL §6.1 `embeds`).
      await addLink(tx, docRef, ref, 'embeds', { anchor: { blockId } })
      return out('doc-block', block, ['taskRef'], { ref: docRef, result: { blockId: block.id, taskRef: ref } })
    },
  },

  'docs.insert_event_block': {
    event: 'calendar.calendar.event.changed_v4',
    op: async tx => {
      const docRef = boundRef(tx, docRefOf(tx.payload.docRef))
      const blockId = String(tx.payload.blockId)
      const event = (tx.payload.event ?? {}) as RecordData
      const attendees = await authorizeAttendees(tx, (event.attendees ?? []) as unknown[])
      const eventId = xscId(tx, xscDerivationKey(docRef, blockId), 'event')
      await insertEvent(tx, {
        id: eventId,
        calendarId: await resolveCalendar(tx, undefined),
        title: String(event.title ?? ''),
        start: String(event.start ?? ''),
        end: String(event.end ?? ''),
        ...(event.tz ? { timeZone: String(event.tz) } : {}),
        ...(event.description ? { description: String(event.description) } : {}),
      }, attendees, { kind: 'doc-block', docRef: docRefLabel(docRef), blockId })
      const block = await insertBlock(tx, docRef, blockId, 'event', { eventRef: refString({ kind: 'calendar-event', id: eventId }) })
      await addLink(tx, docRef, { kind: 'calendar-event', id: eventId }, 'embeds', { anchor: { blockId } })
      return out('doc-block', block, ['eventRef'], { ref: docRef, result: { blockId: block.id, eventRef: { kind: 'calendar-event', id: eventId } } })
    },
  },

  'docs.insert_meeting_block': {
    event: 'vc.meeting.started_v1',
    op: async tx => {
      const docRef = boundRef(tx, docRefOf(tx.payload.docRef))
      const blockId = String(tx.payload.blockId)
      const origin: XscOrigin = { kind: 'doc-block', docRef: docRefLabel(docRef), blockId }
      const event = tx.payload.event as RecordData | undefined
      let eventRef: EntityRef | undefined
      if (event) {
        const attendees = await authorizeAttendees(tx, (event.attendees ?? []) as unknown[])
        const eventId = xscId(tx, xscDerivationKey(docRef, blockId), 'event')
        await insertEvent(tx, {
          id: eventId,
          calendarId: await resolveCalendar(tx, undefined),
          title: String(event.title ?? ''),
          start: String(event.start ?? ''),
          end: String(event.end ?? ''),
          ...(event.tz ? { timeZone: String(event.tz) } : {}),
        }, attendees, origin)
        eventRef = { kind: 'calendar-event', id: eventId }
      }
      const callId = xscId(tx, xscDerivationKey(docRef, blockId), 'call')
      await insertCall(tx, callId, [], origin)
      const block = await insertBlock(tx, docRef, blockId, 'meeting', { callRef: refString({ kind: 'call', id: callId }), mode: tx.payload.mode })
      await addLink(tx, docRef, { kind: 'call', id: callId }, 'embeds', { anchor: { blockId } })
      return out('doc-block', block, ['callRef'], {
        ref: docRef,
        result: { blockId: block.id, callRef: { kind: 'call', id: callId }, ...(eventRef ? { eventRef } : {}) },
      })
    },
  },

  'docs.embed_view': async tx => {
    const docRef = boundRef(tx, docRefOf(tx.payload.docRef), { requireTarget: true })
    const view = tx.payload.ref as { kind?: string; ref?: EntityRef; source?: EntityRef }
    if (view?.kind === 'saved-view' && view.ref) await authorizeRef(tx, view.ref, 'read')
    else if (view?.kind === 'query' && view.source) await authorizeRef(tx, view.source, 'read')
    else throw new CommandRejection('VALIDATION', 'embed_view needs a saved view or a query')
    const target = view.kind === 'saved-view' ? view.ref! : view.source!
    const block = await insertBlock(tx, docRef, String(tx.payload.blockId), 'view', { viewRef: refString(target), viewKind: view.kind, view })
    return out('doc-block', block, ['viewRef'], { ref: docRef, result: { blockId: block.id } })
  },

  // ── tasks from a selection / checklist / message (X-02, X-03, X-19) ──────

  'tasks.create_from_selection': {
    event: 'task.task_adding',
    op: async tx => {
      const origin = tx.payload.origin as XscOrigin
      const originRef = xscOriginRef(origin)
      await authorizeOrigin(tx, originRef)
      if (tx.payload.listRef) await authorizeTaskContainers(tx, { listId: (tx.payload.listRef as EntityRef).id })
      const id = tx.createId()
      const { ref } = await insertTask(tx, id, {
        title: String(tx.payload.title ?? ''),
        ...(tx.payload.description !== undefined ? { notes: tx.payload.description } : {}),
        ...(tx.payload.assignee ? { assigneeIds: [tx.payload.assignee] } : {}),
        ...(tx.payload.due !== undefined ? { dueAt: tx.payload.due } : {}),
        ...(tx.payload.listRef ? { listId: (tx.payload.listRef as EntityRef).id } : {}),
      }, originRef, xscOriginAnchor(origin))
      return { collection: 'task', id, changes: ['title'], result: { taskRef: ref } }
    },
  },

  /**
   * A checklist becomes one task per item. The tasks carry the **anchor**, not
   * the item text (rule 2): the doc block is the title's source of truth, so
   * editing the list in the doc is what the task shows.
   */
  'tasks.create_many_from_checklist': {
    event: 'task.task_adding',
    op: async tx => {
      const docRef = boundRef(tx, docRefOf(tx.payload.docRef))
      const shared = (tx.payload.shared ?? {}) as RecordData
      if (shared.listRef) await authorizeTaskContainers(tx, { listId: (shared.listRef as EntityRef).id })
      const blockIds = tx.payload.blockIds as string[]
      const ids = blockIds.map(blockId => xscId(tx, xscDerivationKey(docRef, blockId), 'task'))
      for (const id of ids) validateLink({ kind: 'task', id }, docRef, XSC_DERIVED_FROM_RELATION)
      const taskRefs: EntityRef[] = []
      for (const [index, id] of ids.entries()) {
        const { ref } = await insertTask(tx, id, taskFieldsFromDraft(shared), docRef, { blockId: blockIds[index] })
        taskRefs.push(ref)
      }
      return { collection: 'task', id: ids[0] ?? '', changes: ['title'], result: { taskRefs } }
    },
  },

  'tasks.create_from_message': {
    event: 'task.task_adding',
    op: async tx => {
      const origin = tx.payload.origin as MessageOrigin
      const originRef = xscOriginRef(origin)
      await authorizeOrigin(tx, originRef)
      if (tx.payload.listRef) await authorizeTaskContainers(tx, { listId: (tx.payload.listRef as EntityRef).id })
      const id = tx.createId()
      const { ref } = await insertTask(tx, id, {
        title: String(tx.payload.title ?? ''),
        ...(tx.payload.assignee ? { assigneeIds: [tx.payload.assignee] } : {}),
        ...(tx.payload.due !== undefined ? { dueAt: tx.payload.due } : {}),
        ...(tx.payload.listRef ? { listId: (tx.payload.listRef as EntityRef).id } : {}),
      }, originRef, xscOriginAnchor(origin))
      for (const follower of (tx.payload.followers ?? []) as string[]) {
        await tx.upsert('subscription', `${refString(ref)}:${follower}`, { kind: 'follower', canceled: false }, { resourceKind: 'task', resourceId: id, principalId: follower })
      }
      const card = await postCard(tx, idOfRef(String(origin.chatRef)), 'card', { kind: 'task', ref })
      return { collection: 'task', id, changes: ['title'], result: { taskRef: ref, cardMessageSeq: card.data.seq } }
    },
  },

  // ── events and calls (X-03, X-15) ────────────────────────────────────────

  'calendar.create_event': {
    event: 'calendar.calendar.event.changed_v4',
    op: async tx => {
      const attendees = await authorizeAttendees(tx, (tx.payload.attendees ?? []) as unknown[])
      const origin = tx.payload.origin as XscOrigin | undefined
      if (origin) await authorizeOrigin(tx, xscOriginRef(origin))
      const id = tx.createId()
      const calendarRef = tx.payload.calendarRef as EntityRef | undefined
      const calendarId = await resolveCalendar(tx, calendarRef ? boundRef(tx, calendarRef) : undefined)
      const record = await insertEvent(tx, {
        id,
        calendarId,
        title: String(tx.payload.title ?? ''),
        start: String(tx.payload.start ?? ''),
        end: String(tx.payload.end ?? ''),
        timeZone: String(tx.payload.tz ?? 'UTC'),
        ...(tx.payload.description ? { description: String(tx.payload.description) } : {}),
      }, attendees, origin)
      let callRef: EntityRef | undefined
      if (tx.payload.call) {
        const callId = xscId(tx, 'event-call', id)
        await insertCall(tx, callId, attendees.filter(principal => !principal.startsWith('email:')), origin)
        callRef = { kind: 'call', id: callId }
      }
      return out('calendar-event', record, ['startAt', 'endAt', 'title'], {
        result: { eventRef: { kind: 'calendar-event', id }, ...(callRef ? { callRef } : {}) },
      })
    },
  },

  'calendar.create_event_from_message': {
    event: 'calendar.calendar.event.changed_v4',
    op: async tx => {
      const origin = tx.payload.origin as MessageOrigin
      const chatId = idOfRef(String(origin.chatRef))
      await authorizeOrigin(tx, xscOriginRef(origin))
      const requested = tx.payload.attendees
      const attendees = requested === 'chat' ? await chatMembers(tx, chatId) : await authorizeAttendees(tx, requested as unknown[])
      const start = String(tx.payload.start ?? tx.now)
      const end = String(tx.payload.end ?? new Date(Date.parse(start) + 60 * 60 * 1000).toISOString())
      const id = tx.createId()
      const record = await insertEvent(tx, {
        id,
        calendarId: await resolveCalendar(tx, undefined),
        title: String(tx.payload.title ?? `channel:${chatId}#${String(origin.seq)}`),
        start,
        end,
      }, attendees, origin)
      const card = await postCard(tx, chatId, 'card', { kind: 'calendar-event', ref: { kind: 'calendar-event', id } })
      return out('calendar-event', record, ['startAt', 'endAt'], { result: { eventRef: { kind: 'calendar-event', id }, cardMessageSeq: card.data.seq } })
    },
  },

  'vc.start_meeting': {
    event: 'vc.meeting.started_v1',
    op: async tx => {
      const origin = tx.payload.origin as XscOrigin | undefined
      if (origin) await authorizeOrigin(tx, xscOriginRef(origin))
      const participants = (tx.payload.participants ?? []) as string[]
      for (const participant of participants) await authorizeRef(tx, { kind: 'person', id: participant }, 'read')
      let notesDocRef: string | undefined
      if (tx.payload.notesDocRef) {
        notesDocRef = String(tx.payload.notesDocRef)
        await authorizeId(tx, 'note', idOfRef(notesDocRef), 'write')
      }
      const callId = tx.createId()
      const record = await insertCall(tx, callId, participants, origin, notesDocRef)
      const callRef: EntityRef = { kind: 'call', id: callId }
      return out('call', record, ['state'], { ref: callRef, result: { callRef, joinUrl: `rox://call/${callId}` } })
    },
  },

  // ── docs.create_from_messages ────────────────────────────────────────────

  'docs.create_from_messages': {
    event: 'docs.document_created',
    op: async tx => {
      const chatRef = boundRef(tx, tx.payload.chatRef as EntityRef | undefined)
      const chat = await tx.require('channel', chatRef.id)
      const seqs = tx.payload.seqs as number[]
      const sequence = await tx.get('channel-sequence', chat.id)
      const seqIndex = sequence && typeof sequence.data.seqIndex === 'object' && sequence.data.seqIndex !== null ? (sequence.data.seqIndex as Record<string, string>) : {}
      const messages: Array<{ seq: number; record: StoredRecord }> = []
      for (const seq of seqs) {
        const messageId = seqIndex[String(seq)]
        const record = messageId ? await tx.get('channel-message', messageId) : null
        if (!record || isDeleted(record) || record.data.chatId !== chat.id) throw new CommandRejection('NOT_FOUND', `message ${chat.id}:${seq} not found`)
        messages.push({ seq, record })
      }
      const body = messages.map(({ record }) => String((record.data.content as RecordData | undefined)?.doc ?? ''))
      const format = String(tx.payload.format)
      const text = format === 'quotes' ? body.map(line => `> ${line}`).join('\n\n') : body.join('\n')
      const target = tx.payload.target as { new?: { title: string; folderRef?: EntityRef }; append?: string }
      const appending = target.append !== undefined
      const noteId = appending ? idOfRef(String(target.append)) : tx.createId()
      if (appending) {
        await authorizeId(tx, 'note', noteId, 'write')
        await tx.require('note', noteId)
      } else {
        await tx.assertAbsent('note', noteId)
      }
      const block = await insertBlock(tx, { kind: 'note', id: noteId }, xscId(tx, 'messages', chat.id, seqs.join(',')).slice(0, 32), `messages-${format}`, { markdown: text })
      const note = appending
        ? await tx.require('note', noteId)
        : await tx.insert('note', noteId, {
          ownerId: tx.actor, subtype: 'doc', state: 'draft',
          title: String(target.new?.title ?? `channel:${chat.id}`),
          markdownSnapshot: text,
          ...(target.new?.folderRef ? { folderId: target.new.folderRef.id } : {}),
        })
      for (const { seq, record } of messages) {
        await addLink(tx, { kind: 'note', id: noteId }, { kind: 'channel-message', id: record.id }, XSC_DERIVED_FROM_RELATION, { role: XSC_DERIVED_FROM_ROLE, anchor: { seq } })
      }
      return out('note', note, ['blocks'], { ref: tx.rawTarget ?? null, result: { docRef: { kind: 'note', id: noteId }, blockId: block.id } })
    },
  },

  // ── messenger ────────────────────────────────────────────────────────────

  'im.create_chat': {
    event: 'im.chat.member.user.added_v1',
    op: async tx => {
      const members = tx.payload.members as string[]
      const from = tx.payload.from as XscOrigin | undefined
      if (from) await authorizeOrigin(tx, xscOriginRef(from))
      const id = tx.createId()
      await tx.assertAbsent('channel', id)
      const record = await tx.insert('channel', id, {
        kind: tx.payload.kind,
        visibility: tx.payload.visibility,
        postingPolicy: tx.payload.postingPolicy ?? 'all',
        invitePolicy: 'members',
        memberIds: [...new Set([tx.actor, ...members])],
        ownerId: tx.actor,
        ...(tx.payload.name ? { name: tx.payload.name } : {}),
        ...(tx.payload.description ? { description: tx.payload.description } : {}),
      })
      for (const principalId of new Set([tx.actor, ...members])) {
        await tx.upsert('channel-member', `${id}:${principalId}`, { state: 'active', role: principalId === tx.actor ? 'owner' : 'member', joinedAt: tx.now }, { chatId: id, principalId })
      }
      const carry = tx.payload.carryContext as { lastN: number } | undefined
      if (carry && from?.kind === 'message') {
        const sourceChatId = idOfRef(String(from.chatRef))
        await tx.require('channel', sourceChatId)
        let sequence = 0
        const source = await tx.get('channel-sequence', sourceChatId)
        const sourceIndex = source && typeof source.data.seqIndex === 'object' && source.data.seqIndex !== null ? (source.data.seqIndex as Record<string, string>) : {}
        for (let seq = Math.max(1, from.seq - carry.lastN + 1); seq <= from.seq; seq += 1) {
          const messageId = sourceIndex[String(seq)]
          const message = messageId ? await tx.get('channel-message', messageId) : null
          if (!message || isDeleted(message)) continue
          sequence += 1
          await tx.insert('channel-message', xscId(tx, 'carry', id, String(seq)), { chatId: id, seq: sequence, senderId: message.data.senderId, content: message.data.content, carriedFrom: { chatId: sourceChatId, seq } })
        }
        if (sequence > 0) await tx.upsert('channel-sequence', id, { lastSeq: sequence }, { chatId: id })
      }
      return out('channel', record, ['kind', 'name', 'visibility'], { result: { chatRef: { kind: 'channel', id } } })
    },
  },

  'im.send_message': {
    event: 'im.message.receive_v1',
    op: async tx => {
      // The chat is the authorized resource: named by the payload or the target.
      const chatRef = boundRef(tx, tx.payload.chatRef as EntityRef | undefined)
      await authorizeRef(tx, chatRef, 'write')
      const chat = await tx.require('channel', chatRef.id)
      const message = await appendMessage(tx, chat, tx.payload.body, {
        mentions: tx.payload.mentions ?? [],
        attribution: tx.payload.attribution ?? 'user',
        notify: tx.payload.notify ?? 'default',
      }, 'message', tx.payload.messageId ? String(tx.payload.messageId) : undefined)
      const messageRef = { kind: 'channel-message' as const, id: message.id }
      for (const principalId of (tx.payload.mentions ?? []) as string[]) {
        await tx.upsert('subscription', `${refString(messageRef)}:${principalId}`, { kind: 'mentioned', canceled: false }, { resourceKind: 'channel-message', resourceId: message.id, principalId })
      }
      return out('channel-message', message, ['content'], { result: { seq: message.data.seq } })
    },
  },

  // ── agents.invoke (§13.1 routes the session; the reference one queues it) ─

  'agents.invoke': {
    event: 'agents.agent_action_executed',
    op: async tx => {
      // `agentRef` names the agent's principal (DATA-MODEL §5.12: a
      // principal(kind='bot') plus its binding); the reference store keys the
      // `agent` row by it.
      const agentRef = tx.payload.agentRef as EntityRef
      const agent = await tx.require('agent', agentRef.id)
      if (agent.data.ownerId !== tx.actor) throw new CommandRejection('FORBIDDEN', 'only the owner can invoke a personal agent')
      if (agent.data.status === 'paused') throw new CommandRejection('UNAVAILABLE', 'agent is paused')
      for (const ref of (tx.payload.context ?? []) as EntityRef[]) await authorizeRef(tx, ref, 'read')
      const origin = tx.payload.origin as XscOrigin
      const originRef = xscOriginRef(origin)
      await authorizeOrigin(tx, originRef)
      const id = tx.createId()
      await tx.assertAbsent('agent-invocation', id)
      const record = await tx.insert('agent-invocation', id, {
        agentId: agentRef.id,
        instruction: tx.payload.instruction,
        origin: refString(originRef),
        originAnchor: xscOriginAnchor(origin),
        status: 'queued',
        invokedBy: tx.actor,
        approvalId: id,
      })
      // A consequential agent action parks until its owner decides (§13.2 step 9);
      // the policy engine of #1508 replaces this reference approval.
      await tx.insert('agent-approval', id, { invocationId: id, agentId: agentRef.id, status: 'pending', approverIds: [String(agent.data.ownerId)], requestedBy: tx.actor })
      return out('agent-invocation', record, ['status'], {
        result: { sessionRef: `session:${id}`, replyThread: originRef },
      })
    },
  },
}