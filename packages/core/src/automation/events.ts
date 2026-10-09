/**
 * W1-12 (#1509) — Event payload contracts for the rules (TECH-SPEC §14.3, §15.1;
 * DATA-MODEL §9.1).
 *
 * The rule engine reads payloads defensively (`unknown` in, typed out through
 * the readers below), because a producer in another module owns the write side
 * and the event string is the contract. Producers: the calendar module
 * (`calendar.event_created`, `calendar.external_event_seen`), the occurrence
 * scheduler (`calendar.occurrence_upcoming`), the identity module
 * (`identity.account_created`), contacts/ONB (`people.member_added`,
 * `people.invitations_sent`).
 */

import { isEntityKind } from '../entities/kinds.ts'
import type { EntityRef } from '../entities/refs.ts'
import type { DomainEvent } from '../events/types.ts'

/** Snapshot of one calendar event inside a rule trigger payload (DATA-MODEL §5.10). */
export interface CalendarEventSnapshot {
  ref: EntityRef
  calendarId: string
  title: string
  startAt: string
  endAt: string
  allDay: boolean
  timeZone?: string
  rrule?: string
  status?: 'confirmed' | 'tentative' | 'cancelled'
  /** Event organiser (principal). Absent on provider events without one. */
  organizerId?: string
  /** Rox principals invited. */
  attendeeIds?: string[]
  /** Attendees whose RSVP is `declined` (principal ids, or emails for external invitees). */
  declinedByIds?: string[]
  /** `free` events do not reserve time (DATA-MODEL §5.10 `transparency`). */
  transparency?: 'busy' | 'free'
  /** Free-text keywords; R1 skips `#no-notes`. */
  keywords?: string[]
}

/** `calendar.event_created`: a workspace-native event was created. */
export interface CalendarEventCreatedPayload {
  event: CalendarEventSnapshot
}

/** `calendar.external_event_seen`: first sync of a provider event (key = the provider uid). */
export interface CalendarExternalEventSeenPayload {
  event: CalendarEventSnapshot
  provider: string
  providerUid: string
}

/** `calendar.occurrence_upcoming`: the scheduler fires this 24 h before an occurrence. */
export interface CalendarOccurrenceUpcomingPayload {
  event: CalendarEventSnapshot
  occurrenceStart: string
  occurrenceEnd: string
  /** How far ahead of the occurrence the scheduler fires (default 24 h). */
  leadMs?: number
}

/** `identity.account_created`: first verified sign-in, or local profile creation. */
export interface IdentityAccountCreatedPayload {
  principalId: string
  email?: string
  displayName?: string
  locale?: string
  source?: 'oidc' | 'password' | 'magic-link' | 'local-profile'
  verified?: boolean
}

/** `people.member_added`: `workspace_member.status → active` (incl. placeholder activation). */
export interface PeopleMemberAddedPayload {
  principalId: string
  workspaceId?: string
  status?: 'active' | 'invited'
  generalChatId?: string
  invitedBy?: string
}

/** `people.invitations_sent`: `workspaces.create` with emails, or the Invite dialog. */
export interface PeopleInvitationsSentPayload {
  invitations: Array<{ email: string; role?: string; targets?: EntityRef[]; principalId?: string }>
  invitedBy?: string
  message?: string
}

/** How a calendar event reached the rule engine. */
export type CalendarTriggerKind = 'created' | 'external' | 'occurrence'

export interface CalendarTrigger {
  kind: CalendarTriggerKind
  event: CalendarEventSnapshot
  /** Recurring occurrence start (ISO); absent → the event's own start. */
  occurrenceStart?: string
  /** Provider uid of an external event (the R1 key uses it instead of the event id). */
  providerUid?: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function asStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every(entry => typeof entry === 'string') ? (value as string[]) : undefined
}

function asRef(value: unknown): EntityRef | null {
  const record = asRecord(value)
  const kind = asString(record?.kind)
  const id = asString(record?.id)
  if (!kind || !id || !isEntityKind(kind)) return null
  const fragment = asString(record?.fragment)
  return fragment ? { kind, id, fragment } : { kind, id }
}

/** Typed calendar snapshot out of an untrusted event payload; `null` when malformed. */
export function calendarTriggerOf(event: DomainEvent<unknown>): CalendarTrigger | null {
  const payload = asRecord(event.payload)
  const raw = asRecord(payload?.event)
  if (!raw) return null
  const ref = asRef(raw.ref)
  const startAt = asString(raw.startAt)
  const endAt = asString(raw.endAt)
  if (!ref || !startAt || !endAt) return null
  const status = asString(raw.status)
  const transparency = asString(raw.transparency)
  const eventSnapshot: CalendarEventSnapshot = {
    ref,
    calendarId: asString(raw.calendarId) ?? '',
    title: asString(raw.title) ?? '',
    startAt,
    endAt,
    allDay: raw.allDay === true,
    ...(asString(raw.timeZone) ? { timeZone: asString(raw.timeZone)! } : {}),
    ...(asString(raw.rrule) ? { rrule: asString(raw.rrule)! } : {}),
    ...(status === 'confirmed' || status === 'tentative' || status === 'cancelled' ? { status } : {}),
    ...(asString(raw.organizerId) ? { organizerId: asString(raw.organizerId)! } : {}),
    ...(asStringArray(raw.attendeeIds) ? { attendeeIds: asStringArray(raw.attendeeIds)! } : {}),
    ...(asStringArray(raw.declinedByIds) ? { declinedByIds: asStringArray(raw.declinedByIds)! } : {}),
    ...(transparency === 'busy' || transparency === 'free' ? { transparency } : {}),
    ...(asStringArray(raw.keywords) ? { keywords: asStringArray(raw.keywords)! } : {}),
  }
  if (event.type === 'calendar.occurrence_upcoming') {
    const occurrenceStart = asString(payload?.occurrenceStart)
    return { kind: 'occurrence', event: eventSnapshot, ...(occurrenceStart ? { occurrenceStart } : {}) }
  }
  if (event.type === 'calendar.external_event_seen') {
    const providerUid = asString(payload?.providerUid)
    return { kind: 'external', event: eventSnapshot, ...(providerUid ? { providerUid } : {}) }
  }
  return { kind: 'created', event: eventSnapshot }
}

/** Typed `identity.account_created` payload; `null` when the principal is missing. */
export function accountCreatedOf(event: DomainEvent<unknown>): IdentityAccountCreatedPayload | null {
  const payload = asRecord(event.payload)
  const principalId = asString(payload?.principalId)
  if (!principalId) return null
  const source = asString(payload?.source)
  return {
    principalId,
    ...(asString(payload?.email) ? { email: asString(payload?.email)! } : {}),
    ...(asString(payload?.displayName) ? { displayName: asString(payload?.displayName)! } : {}),
    ...(asString(payload?.locale) ? { locale: asString(payload?.locale)! } : {}),
    ...(source === 'oidc' || source === 'password' || source === 'magic-link' || source === 'local-profile' ? { source } : {}),
    ...(payload?.verified === true ? { verified: true } : {}),
  }
}

/** Typed `people.member_added` payload; `null` when no principal can be identified. */
export function memberAddedOf(event: DomainEvent<unknown>): PeopleMemberAddedPayload | null {
  const payload = asRecord(event.payload)
  // The W1-06 reference handlers emit `{reference, command, collection, id}` for
  // every command; the principal is then the person record's id (or the subject).
  const principalId = asString(payload?.principalId)
    ?? (asString(payload?.collection) === 'person' ? asString(payload?.id) : undefined)
    ?? (event.subject?.kind === 'person' ? event.subject.id : undefined)
  if (!principalId) return null
  const status = asString(payload?.status)
  return {
    principalId,
    ...(asString(payload?.workspaceId) ? { workspaceId: asString(payload?.workspaceId)! } : {}),
    ...(status === 'active' || status === 'invited' ? { status } : {}),
    ...(asString(payload?.generalChatId) ? { generalChatId: asString(payload?.generalChatId)! } : {}),
    ...(asString(payload?.invitedBy) ? { invitedBy: asString(payload?.invitedBy)! } : {}),
  }
}

/** Typed `people.invitations_sent` payload; `[]` when malformed. */
export function invitationsSentOf(event: DomainEvent<unknown>): PeopleInvitationsSentPayload {
  const payload = asRecord(event.payload)
  const raw = Array.isArray(payload?.invitations) ? payload!.invitations as unknown[] : []
  const invitations: PeopleInvitationsSentPayload['invitations'] = []
  for (const entry of raw) {
    const record = asRecord(entry)
    const email = asString(record?.email)
    if (!email) continue
    const targets = Array.isArray(record?.targets) ? record!.targets.map(asRef).filter((ref): ref is EntityRef => ref !== null) : []
    invitations.push({
      email,
      ...(asString(record?.role) ? { role: asString(record?.role)! } : {}),
      ...(targets.length > 0 ? { targets } : {}),
      ...(asString(record?.principalId) ? { principalId: asString(record?.principalId)! } : {}),
    })
  }
  return {
    invitations,
    ...(asString(payload?.invitedBy) ? { invitedBy: asString(payload?.invitedBy)! } : {}),
    ...(asString(payload?.message) ? { message: asString(payload?.message)! } : {}),
  }
}