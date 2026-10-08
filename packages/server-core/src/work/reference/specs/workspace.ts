/**
 * W1-06 (#1503) — Reference ops: calendar, meetings, people & contacts,
 * social, notifications, ACL, entities, identity, agents, workplace.
 */

import { CommandRejection } from '@rox/core/commands'
import type { EntityRef } from '@rox/core/entities'
import { deterministicId, isDeleted, type ReferenceOutcome, type ReferenceTx } from '../engine'
import { addLink, boundRef, create, omit, patchMany, payloadFields, refString, removeLink, setting, softDelete, storedAclRole, subjectTypeOf, targetRef, transition, update, validateLink } from '../ops'
import type { RecordData, StoredRecord } from '../types'
import { appendMessage } from './messenger'
import { taskDefaults } from './tasks'
import type { ReferenceSpecMap } from './types'

const DAY_MS = 24 * 60 * 60 * 1000
const later = (tx: ReferenceTx, days: number) => new Date(Date.parse(tx.now) + days * DAY_MS).toISOString()
const out = (collection: string, record: StoredRecord, changes: string[], extra: Partial<ReferenceOutcome> = {}): ReferenceOutcome => ({ collection, id: record.id, revision: record.revision, changes, ...extra })

// ── calendar ─────────────────────────────────────────────────────────────

async function defaultCalendar(tx: ReferenceTx): Promise<string> {
  const id = deterministicId(tx.ctx.workspaceId, 'calendar', tx.actor)
  // Named by its owner ref (no locale string in the handler); the client renders a localised label.
  if (!(await tx.get('calendar', id))) await tx.insert('calendar', id, { name: `principal:${tx.actor}`, ownerType: 'principal', ownerId: tx.actor, isDefault: true })
  return id
}

async function createEvent(tx: ReferenceTx, fields: RecordData, origin?: EntityRef): Promise<ReferenceOutcome> {
  const calendarId = (fields.calendarId as string | undefined) ?? tx.targetOf('calendar') ?? await defaultCalendar(tx)
  await tx.require('calendar', calendarId)
  const id = tx.createId()
  const attendees = (fields.attendeeIds as string[] | undefined) ?? []
  const record = await tx.insert('calendar-event', id, { allDay: false, organizerId: tx.actor, status: 'confirmed', ...omit(fields, ['id', 'attendeeIds', 'chatId', 'seq', 'threadId', 'source']), calendarId })
  for (const principalId of new Set([tx.actor, ...attendees])) {
    await tx.upsert('event-rsvp', `${id}:${principalId}`, { status: principalId === tx.actor ? 'accepted' : 'needs_action' }, { eventId: id, principalId })
  }
  if (origin) await addLink(tx, { kind: 'calendar-event', id }, origin, 'derived-from', { role: 'origin' })
  return out('calendar-event', record, ['startAt', 'endAt', 'title'])
}

export const CALENDAR_REFERENCE_SPECS: ReferenceSpecMap = {
  'calendar.create_event': { op: tx => createEvent(tx, tx.payload), event: 'calendar.calendar.event.changed_v4' },
  'calendar.update_event': {
    event: 'calendar.calendar.event.changed_v4',
    op: async tx => {
      const result = await update('calendar-event', payloadFields('scope', 'attendeeIds'))(tx)
      for (const principalId of (tx.payload.attendeeIds ?? []) as string[]) {
        const id = `${result.id}:${principalId}`
        if (!(await tx.get('event-rsvp', id))) await tx.insert('event-rsvp', id, { eventId: result.id, principalId, status: 'needs_action' })
      }
      return result
    },
  },
  'calendar.delete_event': { op: softDelete('calendar-event'), event: 'calendar.calendar.event.changed_v4' },
  'calendar.rsvp': {
    event: 'calendar.rsvp_changed',
    op: async tx => {
      const event = await tx.requireTarget('calendar-event')
      const row = await tx.upsert('event-rsvp', `${event.id}:${tx.actor}`, { status: tx.payload.response, ...(tx.payload.comment ? { comment: tx.payload.comment } : {}) }, { eventId: event.id, principalId: tx.actor })
      return out('event-rsvp', row, ['status'], { ref: tx.rawTarget ?? null })
    },
  },
  'calendar.create_calendar': create('calendar', payloadFields(), { defaults: tx => ({ ownerType: 'principal', ownerId: tx.actor }) }),
  'calendar.subscribe': async tx => {
    const calendar = await tx.require('calendar', tx.payload.calendarId)
    const row = await tx.upsert('calendar-subscription', `${calendar.id}:${tx.actor}`, payloadFields('calendarId')(tx) as RecordData, { calendarId: calendar.id, principalId: tx.actor })
    return out('calendar-subscription', row, ['subscribed'], { ref: { kind: 'calendar', id: calendar.id } })
  },
  'calendar.book_room': async tx => {
    const id = tx.newId('booking')
    const row = await tx.insert('room-booking', id, { ...tx.payload, bookedBy: tx.actor })
    return out('room-booking', row, ['roomId', 'startAt', 'endAt'], { ref: { kind: 'room', id: tx.payload.roomId } })
  },
  'calendar.create_time_block': tx => createEvent(tx, { ...tx.payload, kind: 'time_block' }, tx.payload.source),
  'calendar.create_event_from_message': tx => createEvent(tx, tx.payload, { kind: 'channel-message', id: `${tx.payload.chatId}:${tx.payload.seq}` }),
  'calendar.create_event_from_email': tx => createEvent(tx, tx.payload, { kind: 'mail-thread', id: tx.payload.threadId }),
}

// ── meetings ─────────────────────────────────────────────────────────────

async function hostCall(tx: ReferenceTx): Promise<StoredRecord> {
  const call = await tx.require('call', tx.payload.callId)
  if (call.data.hostId !== tx.actor) throw new CommandRejection('FORBIDDEN', 'only the host can do this')
  return call
}

export const MEETINGS_REFERENCE_SPECS: ReferenceSpecMap = {
  'vc.start_meeting': async tx => {
    const id = tx.createId()
    const record = await tx.insert('call', id, { ...payloadFields('inviteeIds')(tx), hostId: tx.actor, state: 'live', startedAt: tx.now, recording: false })
    await tx.upsert('call-participant', `${id}:${tx.actor}`, { joinedAt: tx.now, role: 'host' }, { callId: id, principalId: tx.actor })
    return out('call', record, ['state'], { result: { invited: tx.payload.inviteeIds ?? [] } })
  },
  'vc.join': async tx => {
    const call = await tx.require('call', tx.payload.callId)
    if (call.data.state === 'ended') throw new CommandRejection('VALIDATION', 'meeting has ended')
    const row = await tx.upsert('call-participant', `${call.id}:${tx.actor}`, { joinedAt: tx.now, ...payloadFields('callId')(tx) }, { callId: call.id, principalId: tx.actor })
    return out('call-participant', row, ['joinedAt'], { ref: { kind: 'call', id: call.id } })
  },
  'vc.end': { op: async tx => out('call', await tx.update('call', await hostCall(tx), { state: 'ended', endedAt: tx.now }), ['state']), event: 'vc.meeting.all_meeting_ended_v1' },
  'vc.set_recording': async tx => out('call', await tx.update('call', await hostCall(tx), { recording: tx.payload.recording }), ['recording']),
  'meetings.publish_outcomes': async tx => {
    const source = targetRef(tx)
    const tasks: string[] = []
    for (const [index, task] of ((tx.payload.tasks ?? []) as RecordData[]).entries()) {
      const id = tx.newId(`task-${index}`)
      await tx.insert('task', id, { ...(await taskDefaults(tx)), ...task })
      await addLink(tx, { kind: 'task', id }, source, 'derived-from', { role: 'meeting-outcome' })
      tasks.push(id)
    }
    const decisions: string[] = []
    for (const [index, decision] of ((tx.payload.decisions ?? []) as RecordData[]).entries()) {
      const id = tx.newId(`decision-${index}`)
      await tx.insert('doc-block', id, { docKind: source.kind, docId: source.id, kind: 'decision', ...decision })
      decisions.push(id)
    }
    if (tx.payload.toChatId) {
      const chat = await tx.require('channel', tx.payload.toChatId)
      await appendMessage(tx, chat, { doc: '', unfurls: [{ ref: source }] }, {}, 'outcomes')
    }
    return { collection: 'doc-block', id: decisions[0] ?? tasks[0] ?? tx.newId('outcomes'), ref: source, changes: ['tasks', 'decisions'], result: { tasks, decisions } }
  },
}

// ── people & contacts ────────────────────────────────────────────────────

export const CONTACTS_REFERENCE_SPECS: ReferenceSpecMap = {
  'people.update_profile': async tx => out('person', await tx.upsert('person', tx.actor, payloadFields()(tx) as RecordData, { principalId: tx.actor }), Object.keys(tx.payload).sort()),
  'people.set_manager': async tx => {
    const personId = tx.target('person')
    if (tx.payload.managerId === personId) throw new CommandRejection('VALIDATION', 'a person cannot manage themselves')
    return out('person', await tx.upsert('person', personId, { managerId: tx.payload.managerId }, { principalId: personId }), ['managerId'])
  },
  'people.invite': { op: create('invitation', payloadFields('spaceIds'), { defaults: tx => ({ status: 'pending', invitedBy: tx.actor, expiresAt: later(tx, 14), targets: tx.payload.spaceIds ?? [] }) }), event: 'people.invitations_sent' },
  'people.convert_to_guest': async tx => {
    const personId = tx.target('person')
    if (personId === tx.actor) throw new CommandRejection('FORBIDDEN', 'cannot convert yourself to a guest')
    return out('person', await tx.upsert('person', personId, { role: 'guest', state: 'guest', ...(tx.payload.keepSpaceIds ? { keepSpaceIds: tx.payload.keepSpaceIds } : {}) }, { principalId: personId }), ['role'])
  },
  'people.add_workspace_member': { op: async tx => out('person', await tx.upsert('person', tx.payload.principalId, { role: tx.payload.role, state: 'active' }, { principalId: tx.payload.principalId }), ['role'], { ref: { kind: 'person', id: tx.payload.principalId } }), event: 'people.member_added' },
  'contacts.create_card': create('contact-card', payloadFields(), { defaults: tx => ({ ownerScope: 'personal', ownerId: tx.actor, kind: 'person', handles: [] }) }),
  'contacts.update_card': update('contact-card'),
  'contacts.merge_cards': async tx => {
    const card = await tx.requireTarget('contact-card')
    for (const sourceId of tx.payload.sourceIds as string[]) {
      if (sourceId === card.id) throw new CommandRejection('VALIDATION', 'cannot merge a card into itself')
      const source = await tx.require('contact-card', sourceId)
      await tx.update('contact-card', source, { mergedInto: card.id, deletedAt: tx.now })
    }
    const merged = [...new Set([...((card.data.mergedFrom as string[] | undefined) ?? []), ...tx.payload.sourceIds])]
    return out('contact-card', await tx.update('contact-card', card, { mergedFrom: merged }), ['mergedFrom'])
  },
  'contacts.star': update('contact-card'),
  'contacts.add_touch': update('contact-card', (tx, current) => {
    const touch = { at: tx.payload.at ?? tx.now, ...omit(tx.payload, ['at']), ...(tx.payload.source ? { source: refString(tx.payload.source) } : {}) }
    return { lastTouchAt: touch.at, touches: [...((current!.data.touches as RecordData[] | undefined) ?? []), touch] }
  }),
}

// ── social ───────────────────────────────────────────────────────────────

async function ownComment(tx: ReferenceTx): Promise<StoredRecord> {
  const comment = await tx.requireTarget('comment')
  if (comment.data.authorId !== tx.actor) throw new CommandRejection('FORBIDDEN', 'only the author can change a comment')
  return comment
}

async function threadRoot(tx: ReferenceTx): Promise<StoredRecord> {
  const resource = targetRef(tx)
  const root = await tx.require('comment', tx.payload.threadId)
  if (root.data.resourceKind !== resource.kind || root.data.resourceId !== resource.id) throw new CommandRejection('NOT_FOUND', 'thread is not on this entity')
  return root
}

async function react(tx: ReferenceTx, subject: EntityRef, emoji: string, on: boolean): Promise<ReferenceOutcome> {
  const id = `${refString(subject)}:${tx.actor}:${emoji}`
  const current = await tx.get('reaction', id)
  if (!on) {
    if (!current || isDeleted(current)) throw new CommandRejection('NOT_FOUND', 'reaction not found')
    return out('reaction', await tx.softDelete('reaction', current), ['emoji'], { ref: subject })
  }
  return out('reaction', await tx.upsert('reaction', id, {}, { resourceKind: subject.kind, resourceId: subject.id, principalId: tx.actor, emoji }), ['emoji'], { ref: subject })
}

async function subscribe(tx: ReferenceTx, canceled: boolean): Promise<ReferenceOutcome> {
  const subject = targetRef(tx)
  const principals: string[] = tx.payload.principalIds?.length ? tx.payload.principalIds : [tx.actor]
  let last: StoredRecord | null = null
  for (const principalId of principals) {
    last = await tx.upsert('subscription', `${refString(subject)}:${principalId}`, { canceled }, { resourceKind: subject.kind, resourceId: subject.id, principalId, kind: 'explicit' })
  }
  return out('subscription', last!, ['canceled'], { ref: subject, result: { principals } })
}

export const SOCIAL_REFERENCE_SPECS: ReferenceSpecMap = {
  'comments.create': {
    event: 'entities.comment_added',
    op: async tx => {
      const parent = (tx.payload.parent as EntityRef | undefined) ?? targetRef(tx)
      if (tx.payload.threadId) {
        const root = await tx.require('comment', tx.payload.threadId)
        if (root.data.resourceId !== parent.id) throw new CommandRejection('NOT_FOUND', 'thread is not on this entity')
      }
      const id = tx.createId()
      const record = await tx.insert('comment', id, {
        resourceKind: parent.kind, resourceId: parent.id, authorId: tx.actor, content: tx.payload.content, threadStatus: 'open',
        ...(tx.payload.threadId ? { parentId: tx.payload.threadId } : {}), ...(tx.payload.anchor ? { anchor: tx.payload.anchor } : {}), ...(tx.payload.mentions ? { mentions: tx.payload.mentions } : {}),
      })
      return out('comment', record, ['content'])
    },
  },
  'comments.edit': async tx => out('comment', await tx.update('comment', await ownComment(tx), { content: tx.payload.content, editedAt: tx.now }), ['content']),
  'comments.delete': async tx => out('comment', await tx.softDelete('comment', await ownComment(tx)), ['deletedAt']),
  'comments.react': async tx => react(tx, { kind: 'comment', id: (await tx.requireTarget('comment')).id }, tx.payload.emoji, tx.payload.on !== false),
  'comments.resolve': transition('comment', tx => ({ resolvedAt: tx.now, resolvedBy: tx.actor, threadStatus: 'resolved' })),
  'comments.resolve_thread': async tx => out('comment', await tx.update('comment', await threadRoot(tx), { threadStatus: 'resolved', resolvedAt: tx.now, resolvedBy: tx.actor }), ['threadStatus'], { ref: tx.rawTarget ?? null }),
  'comments.reopen_thread': async tx => out('comment', await tx.update('comment', await threadRoot(tx), { threadStatus: 'open', resolvedAt: null, resolvedBy: null }), ['threadStatus'], { ref: tx.rawTarget ?? null }),
  'comments.convert_to_task': {
    event: 'task.task_adding',
    op: async tx => {
      const comment = await tx.requireTarget('comment')
      const content = comment.data.content
      const id = tx.createId()
      const record = await tx.insert('task', id, { ...(await taskDefaults(tx)), title: tx.payload.title ?? (typeof content === 'string' ? content.slice(0, 500) : `comment:${comment.id}`), ...(tx.payload.listId ? { listId: tx.payload.listId } : {}), ...(tx.payload.assigneeIds ? { assigneeIds: tx.payload.assigneeIds } : {}), origin: { kind: 'comment', id: comment.id } })
      await addLink(tx, { kind: 'task', id }, { kind: 'comment', id: comment.id }, 'derived-from', { role: 'origin' })
      return out('task', record, ['title'])
    },
  },
  'reactions.add': { op: tx => react(tx, targetRef(tx), tx.payload.emoji, true), event: 'im.message.reaction.created_v1' },
  'reactions.remove': { op: tx => react(tx, targetRef(tx), tx.payload.emoji, false), event: 'im.message.reaction.deleted_v1' },
  'subscriptions.subscribe': tx => subscribe(tx, false),
  'subscriptions.unsubscribe': tx => subscribe(tx, true),
  'subscriptions.set_notify_everyone': setting('subscription-policy', tx => refString(targetRef(tx)), tx => ({ notifyEveryone: tx.payload.enabled })),
}

// ── notifications & reminders ────────────────────────────────────────────

export const NOTIFY_REFERENCE_SPECS: ReferenceSpecMap = {
  'notifications.mark_read': async tx => {
    const own: string[] = []
    for (const id of tx.payload.notificationIds as string[]) {
      const notification = await tx.get('notification', id)
      if (notification?.data.principalId === tx.actor) own.push(id)
    }
    const { updated } = await patchMany(tx, 'notification', own, () => ({ readAt: tx.now }))
    const missing = (tx.payload.notificationIds as string[]).filter(id => !updated.includes(id))
    return { collection: 'notification', id: updated[0] ?? tx.newId('none'), ref: null, changes: ['readAt'], result: { updated, missing } }
  },
  'notifications.mark_all_read': setting('notification-pref', tx => `${tx.actor}:read-marker`, tx => ({ principalId: tx.actor, allReadBefore: tx.payload.before ?? tx.now })),
  'notifications.update_prefs': async tx => {
    let last: StoredRecord | null = null
    for (const pref of tx.payload.prefs as Array<{ eventType: string; channel: string; enabled: boolean }>) {
      last = await tx.upsert('notification-pref', `${tx.actor}:${pref.eventType}:${pref.channel}`, { enabled: pref.enabled }, { principalId: tx.actor, kind: pref.eventType, channel: pref.channel })
    }
    if (tx.payload.quietHours !== undefined) last = await tx.upsert('notification-pref', `${tx.actor}:quiet-hours`, { quietHours: tx.payload.quietHours }, { principalId: tx.actor })
    return out('notification-pref', last!, ['prefs'], { ref: null })
  },
  'reminders.create': create('reminder', tx => ({ remindAt: tx.payload.remindAt, ...(tx.payload.note ? { note: tx.payload.note } : {}), subjectRef: refString(boundRef(tx, tx.payload.subject as EntityRef | undefined)) }), { defaults: tx => ({ state: 'scheduled', ownerId: tx.actor }) }),
  'reminders.cancel': transition('reminder', () => ({ state: 'cancelled' })),
}

// ── ACL ──────────────────────────────────────────────────────────────────

/** ACL commands act on the authorized target; `payload.subject` may only repeat it. */
const aclSubject = (tx: ReferenceTx, requireTarget = true): EntityRef => {
  const subject = boundRef(tx, tx.payload.subject as EntityRef | undefined, { requireTarget })
  return { kind: subject.kind, id: subject.id } as EntityRef
}
const aclId = (tx: ReferenceTx, subject: EntityRef, kind: string, id: string) => deterministicId(tx.ctx.workspaceId, 'acl', refString(subject), kind, id)


async function grant(tx: ReferenceTx, subject: EntityRef, principal: { kind: string; id: string }, role: string): Promise<StoredRecord> {
  const subjectType = subjectTypeOf(principal.kind)
  return tx.upsert('acl-entry', aclId(tx, subject, subjectType, principal.id), { role: storedAclRole(role), grantedBy: tx.actor }, { resourceType: subject.kind, resourceId: subject.id, subjectType, subjectId: principal.id })
}

export const ACL_REFERENCE_SPECS: ReferenceSpecMap = {
  'acl.grant': async tx => { const subject = aclSubject(tx); return out('acl-entry', await grant(tx, subject, tx.payload.principal, tx.payload.role), ['role'], { ref: subject }) },
  'acl.revoke': async tx => {
    const subject = aclSubject(tx)
    const entry = await tx.get('acl-entry', aclId(tx, subject, subjectTypeOf(tx.payload.principal.kind), tx.payload.principal.id))
    if (!entry || isDeleted(entry)) throw new CommandRejection('NOT_FOUND', 'no such grant')
    if (entry.data.role === 'owner') throw new CommandRejection('FORBIDDEN', 'transfer ownership instead of revoking the owner')
    return out('acl-entry', await tx.softDelete('acl-entry', entry), ['role'], { ref: subject })
  },
  'acl.set_link': async tx => { const subject = aclSubject(tx); return out('acl-link', await tx.upsert('acl-link', refString(subject), { scope: tx.payload.scope, role: tx.payload.role ?? null }, { resourceType: subject.kind, resourceId: subject.id }), ['scope'], { ref: subject }) },
  'acl.request_access': async tx => {
    // A requester may lack access to the resource, so a bare `subject` is allowed here (it only files a request).
    const subject = aclSubject(tx, false)
    const id = tx.createId()
    const record = await tx.insert('access-request', id, { resourceType: subject.kind, resourceId: subject.id, requesterId: tx.actor, role: tx.payload.role, status: 'pending', expiresAt: later(tx, 7), ...(tx.payload.message ? { message: tx.payload.message } : {}) })
    return out('access-request', record, ['status'], { ref: subject })
  },
  'acl.decide_request': async tx => {
    const target = targetRef(tx)
    const request = await tx.require('access-request', tx.payload.requestId)
    // The executor authorized `share` on the target: it must be the requested resource.
    if (request.data.resourceType !== target.kind || request.data.resourceId !== target.id) throw new CommandRejection('FORBIDDEN', 'the request is for another resource')
    if (request.data.requesterId === tx.actor) throw new CommandRejection('FORBIDDEN', 'cannot decide your own request')
    if (request.data.status !== 'pending') throw new CommandRejection('VALIDATION', `request is ${String(request.data.status)}`)
    if (typeof request.data.expiresAt === 'string' && Date.parse(request.data.expiresAt) <= Date.parse(tx.now)) throw new CommandRejection('VALIDATION', 'request expired')
    const subject = { kind: request.data.resourceType, id: request.data.resourceId } as EntityRef
    if (tx.payload.decision === 'approve') await grant(tx, subject, { kind: 'user', id: String(request.data.requesterId) }, tx.payload.role ?? String(request.data.role))
    return out('access-request', await tx.update('access-request', request, { status: tx.payload.decision === 'approve' ? 'approved' : 'denied', decidedBy: tx.actor, decidedAt: tx.now }), ['status'], { ref: subject })
  },
  'acl.transfer_ownership': async tx => {
    const subject = aclSubject(tx)
    if (tx.payload.toPrincipalId === tx.actor) throw new CommandRejection('VALIDATION', 'already the owner')
    const owner = await grant(tx, subject, { kind: 'user', id: tx.payload.toPrincipalId }, 'owner')
    await grant(tx, subject, { kind: 'user', id: tx.actor }, 'full_access')
    return out('acl-entry', owner, ['role'], { ref: subject })
  },
}

// ── entities ─────────────────────────────────────────────────────────────

const DROP_RELATIONS: Record<string, string> = { link: 'relates-to', embed: 'embeds', attach: 'attached-to' }
const pinKey = (tx: ReferenceTx, entity: EntityRef) => `${tx.actor}:${tx.rawTarget ? refString(tx.rawTarget) : 'workspace'}:${refString(entity)}`

export const ENTITIES_REFERENCE_SPECS: ReferenceSpecMap = {
  'links.add': {
    event: 'entities.link_added',
    op: async tx => {
      const from = boundRef(tx, tx.payload.from as EntityRef | undefined, { requireTarget: true })
      const link = await addLink(tx, from, tx.payload.to, tx.payload.relation, { ...(tx.payload.role ? { role: tx.payload.role } : {}), ...(tx.payload.anchor ? { anchor: tx.payload.anchor } : {}) })
      return out('entity-link', link, ['relation'], { ref: from })
    },
  },
  'links.remove': {
    event: 'entities.link_removed',
    op: async tx => {
      const from = boundRef(tx, tx.payload.from as EntityRef | undefined, { requireTarget: true })
      const link = await removeLink(tx, from, tx.payload.to, tx.payload.relation)
      if (!link) throw new CommandRejection('NOT_FOUND', 'link not found')
      return out('entity-link', link, ['relation'], { ref: from })
    },
  },
  'entities.drop': async tx => {
    const target = targetRef(tx)
    const id = tx.newId('drop')
    const record = await tx.insert('entity-drop', id, { targetRef: refString(target), sourceRef: refString(tx.payload.source), intent: tx.payload.intent })
    const relation = DROP_RELATIONS[tx.payload.intent]
    if (relation) await addLink(tx, tx.payload.source, target, relation, { role: 'drop' })
    return out('entity-drop', record, ['intent'], { ref: target })
  },
  'entities.pin': async tx => out('entity-pin', await tx.upsert('entity-pin', pinKey(tx, tx.payload.entity), { sortKey: tx.payload.sortKey ?? 'a0' }, { principalId: tx.actor, entityRef: refString(tx.payload.entity) }), ['pinned'], { ref: tx.payload.entity }),
  'entities.unpin': async tx => {
    const pin = await tx.get('entity-pin', pinKey(tx, tx.payload.entity))
    if (!pin || isDeleted(pin)) throw new CommandRejection('NOT_FOUND', 'not pinned')
    return out('entity-pin', await tx.softDelete('entity-pin', pin), ['pinned'], { ref: tx.payload.entity })
  },
  'entities.reorder_pins': async tx => {
    const ids = (tx.payload.order as EntityRef[]).map(entity => pinKey(tx, entity))
    const { updated, missing } = await patchMany(tx, 'entity-pin', ids, (_record, index) => ({ sortKey: `a${String(index).padStart(4, '0')}` }))
    return { collection: 'entity-pin', id: updated[0] ?? tx.newId('none'), ref: tx.rawTarget ?? null, changes: ['sortKey'], result: { updated: updated.length, missing: missing.length } }
  },
}

// ── identity, agents ─────────────────────────────────────────────────────

const placeholderKey = (tx: ReferenceTx) => deterministicId(tx.ctx.workspaceId, 'placeholder', String(tx.payload.email ?? tx.payload.externalRef ?? tx.payload.displayName).toLowerCase())

async function placeholderIn(tx: ReferenceTx, state: string): Promise<StoredRecord> {
  const placeholder = await tx.require('placeholder', tx.payload.placeholderId)
  if (placeholder.data.state !== state) throw new CommandRejection('VALIDATION', `placeholder is ${String(placeholder.data.state)}`)
  return placeholder
}

async function ownAgent(tx: ReferenceTx): Promise<StoredRecord> {
  const agent = await tx.require('agent', tx.payload.agentId)
  if (agent.data.ownerId !== tx.actor) throw new CommandRejection('FORBIDDEN', 'only the owner can manage this agent')
  return agent
}

export const IDENTITY_REFERENCE_SPECS: ReferenceSpecMap = {
  'workspaces.create': create('workspace', payloadFields(), { defaults: tx => ({ ownerId: tx.actor }) }),
  'identity.ensure_placeholder': async tx => {
    const id = (tx.payload.id as string | undefined) ?? placeholderKey(tx)
    const current = await tx.get('placeholder', id)
    if (current) return out('placeholder', current, [], { ref: { kind: 'person', id }, result: { existed: true } })
    return out('placeholder', await tx.insert('placeholder', id, { ...payloadFields()(tx), state: 'placeholder' }), ['state'], { ref: { kind: 'person', id }, result: { existed: false } })
  },
  'identity.activate_placeholder': async tx => out('placeholder', await tx.update('placeholder', await placeholderIn(tx, 'placeholder'), { state: 'active', principalId: tx.payload.principalId, activatedAt: tx.now }), ['state'], { ref: { kind: 'person', id: tx.payload.placeholderId } }),
  'identity.merge_placeholder': async tx => out('placeholder', await tx.update('placeholder', await placeholderIn(tx, 'placeholder'), { state: 'merged', mergedInto: tx.payload.intoPrincipalId, mergedAt: tx.now }), ['state'], { ref: { kind: 'person', id: tx.payload.placeholderId } }),
  'onboarding.seed_starter_content': async tx => {
    const key = `${tx.actor}:${tx.rawTarget ? refString(tx.rawTarget) : 'workspace'}:${tx.payload.pack}`
    const current = await tx.get('onboarding-seed', key)
    if (current) return out('onboarding-seed', current, [], { ref: tx.rawTarget ?? null, result: { seeded: false } })
    return out('onboarding-seed', await tx.insert('onboarding-seed', key, { pack: tx.payload.pack, ...(tx.payload.locale ? { locale: tx.payload.locale } : {}), seededAt: tx.now }), ['pack'], { ref: tx.rawTarget ?? null, result: { seeded: true } })
  },
}

export const AGENTS_REFERENCE_SPECS: ReferenceSpecMap = {
  'agents.provision_personal_agent': async tx => {
    if (tx.payload.ownerId !== tx.actor) throw new CommandRejection('FORBIDDEN', 'a personal agent can only be provisioned for yourself')
    const id = (tx.payload.id as string | undefined) ?? deterministicId(tx.ctx.workspaceId, 'agent', tx.payload.ownerId)
    const current = await tx.get('agent', id)
    if (current) return out('agent', current, [], { ref: null, result: { existed: true } })
    return out('agent', await tx.insert('agent', id, { ownerId: tx.payload.ownerId, ...(tx.payload.name ? { name: tx.payload.name } : {}), status: 'active' }), ['status'], { ref: null, result: { existed: false } })
  },
  'agents.invoke': async tx => {
    const agent = await tx.require('agent', tx.payload.agentId)
    if (agent.data.status === 'paused') throw new CommandRejection('UNAVAILABLE', 'agent is paused')
    const id = tx.createId()
    return out('agent-invocation', await tx.insert('agent-invocation', id, { ...payloadFields()(tx), status: 'queued', invokedBy: tx.actor }), ['status'], { ref: tx.rawTarget ?? null })
  },
  'agents.decide_approval': async tx => {
    const current = await tx.get('agent-approval', tx.payload.approvalId)
    if (current?.data.decision) throw new CommandRejection('VALIDATION', 'approval already decided')
    if (typeof current?.data.expiresAt === 'string' && Date.parse(current.data.expiresAt) <= Date.parse(tx.now)) throw new CommandRejection('VALIDATION', 'approval expired')
    const record = await tx.upsert('agent-approval', tx.payload.approvalId, { decision: tx.payload.decision, decidedBy: tx.actor, decidedAt: tx.now, ...(tx.payload.note ? { note: tx.payload.note } : {}) })
    return out('agent-approval', record, ['decision'], { ref: null })
  },
  'agents.pause': async tx => out('agent', await tx.update('agent', await ownAgent(tx), { status: tx.payload.paused === false ? 'active' : 'paused' }), ['status'], { ref: null }),
}

// ── workplace ────────────────────────────────────────────────────────────

export const WORKPLACE_REFERENCE_SPECS: ReferenceSpecMap = {
  /** The destination chat is the envelope target, so the executor authorizes posting there. */
  'mail.share_to_chat': async tx => {
    const chatId = tx.target('channel')
    if (tx.payload.chatId !== undefined && tx.payload.chatId !== chatId) throw new CommandRejection('FORBIDDEN', 'chatId must match the target chat')
    const chat = await tx.require('channel', chatId)
    const message = await appendMessage(tx, chat, { doc: tx.payload.comment ?? '', unfurls: [{ ref: { kind: 'mail-thread', id: tx.payload.threadId } }] })
    return out('channel-message', message, ['content'], { result: { seq: message.data.seq } })
  },
  'mail.create_task_from_thread': {
    event: 'task.task_adding',
    op: async tx => {
      const origin: EntityRef = { kind: 'mail-thread', id: tx.payload.threadId }
      const id = tx.createId()
      validateLink({ kind: 'task', id }, origin, 'derived-from')
      await tx.assertAbsent('task', id)
      const record = await tx.insert('task', id, { ...(await taskDefaults(tx)), title: tx.payload.title ?? refString(origin), ...(tx.payload.listId ? { listId: tx.payload.listId } : {}), ...(tx.payload.assigneeIds ? { assigneeIds: tx.payload.assigneeIds } : {}), origin: { kind: origin.kind, id: origin.id } })
      await addLink(tx, { kind: 'task', id }, origin, 'derived-from', { role: 'origin' })
      return out('task', record, ['title'])
    },
  },
  'project_templates.create_from_project': async tx => {
    const project = await tx.requireTarget('project')
    const id = tx.createId()
    const payload = { project: omit(project.data, ['createdAt', 'updatedAt', 'createdBy', 'lastCommandId', 'closedAt', 'pausedAt', 'successStatus']), includeTasks: tx.payload.includeTasks, includeMilestones: tx.payload.includeMilestones }
    return out('project-template', await tx.insert('project-template', id, { name: tx.payload.name, ...(project.data.spaceId ? { spaceId: project.data.spaceId } : {}), payload, sourceProjectId: project.id }), ['name'])
  },
  'project_templates.create_project': {
    event: 'projects.project_created',
    op: async tx => {
      const template = await tx.requireTarget('project-template')
      const id = tx.createId()
      const base = ((template.data.payload as RecordData | undefined)?.project ?? {}) as RecordData
      return out('project', await tx.insert('project', id, { ...base, status: 'active', name: tx.payload.name, championId: tx.actor, templateId: template.id, ...(tx.payload.spaceId ? { spaceId: tx.payload.spaceId } : {}), ...(tx.payload.startOn ? { startedAt: tx.payload.startOn } : {}) }), ['name'])
    },
  },
  'exports.markdown': async tx => {
    const subject = targetRef(tx)
    const id = tx.newId('export')
    return out('export', await tx.insert('export', id, { subjectRef: refString(subject), includeChildren: tx.payload.includeChildren, format: 'markdown', status: 'requested', requestedBy: tx.actor }), ['status'], { ref: subject })
  },
  /** Records the batch; nested commands are executed one by one by the client / W1-15 runner (never bypassing ACL). */
  'commands.batch': async tx => {
    const id = tx.newId('batch')
    const types = (tx.payload.commands as Array<{ type: string }>).map(command => command.type)
    return out('command-batch', await tx.insert('command-batch', id, { types, atomic: tx.payload.atomic, status: 'accepted' }), ['status'], { ref: tx.rawTarget ?? null })
  },
  'forms.configure_on_submit': setting('form-hook', tx => refString(tx.payload.formRef), tx => ({ formRef: refString(tx.payload.formRef), actions: tx.payload.actions })),
}
