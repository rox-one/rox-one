/**
 * W1-09 (#1506) — Where the fan-out gets its audience.
 *
 * STUB(#1503): the wave-2 GOAL / PRJ / TSK reference handlers are the real
 * source (goal champion / reviewer columns, `subscription` rows,
 * `work_item_member`). Until they land, the audience is read from the domain
 * event payload's ids-only fields, which the W1-06 reference handlers carry.
 * Replacing this with an entity-store reader is a one-line change in
 * `createNotifyService`.
 *
 * Only ids are read: a payload title or body can never become an audience.
 */

import type { DomainEvent } from '@rox/core/events'
import type { AudienceContext } from '@rox/core/notify'

export interface AudienceReader {
  read(event: DomainEvent): Promise<AudienceContext>
}

/** Scalar payload fields (one principal id). */
const SCALAR_FIELDS = ['championId', 'reviewerId', 'ownerId', 'inviteeId'] as const
/** List payload fields (many principal ids). */
const LIST_FIELDS = ['assigneeIds', 'mentionedIds', 'subscriberIds', 'allSubscriberIds', 'threadParticipantIds', 'attendeeIds', 'memberIds', 'participantIds', 'targetIds', 'mutedIds'] as const

function principalIds(value: unknown): string[] | undefined {
  if (typeof value !== 'string') {
    if (!Array.isArray(value)) return undefined
    const ids = value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    return ids.length > 0 ? ids : undefined
  }
  return value.length > 0 ? [value] : undefined
}

function assignScalar(context: AudienceContext, field: (typeof SCALAR_FIELDS)[number], value: string): void {
  switch (field) {
    case 'championId': context.champion = value; break
    case 'reviewerId': context.reviewer = value; break
    case 'ownerId': context.owner = value; break
    case 'inviteeId': context.invitee = value; break
  }
}

function assignList(context: AudienceContext, field: (typeof LIST_FIELDS)[number], value: string[]): void {
  switch (field) {
    case 'assigneeIds': context.assignees = value; break
    case 'mentionedIds': context.mentioned = value; break
    case 'subscriberIds': context.subscribers = value; break
    case 'allSubscriberIds': context.allSubscribers = value; break
    case 'threadParticipantIds': context.threadParticipants = value; break
    case 'attendeeIds': context.attendees = value; break
    case 'memberIds': context.members = value; break
    case 'participantIds': context.participants = value; break
    case 'targetIds': context.targets = value; break
    case 'mutedIds': context.muted = value; break
  }
}

/**
 * The `AudienceContext` an event payload carries (STUB(#1503)).
 *
 * `check_in.notify`: `everyone` includes the subscriber set, `selected` and
 * `none` do not (DATA-MODEL §9.2 — the reviewer still hears about a published
 * check-in; `none` is handled by the trigger guard instead).
 */
export function audienceFromPayload(event: DomainEvent): AudienceContext {
  const context: AudienceContext = {}
  if (event.actorId) context.actorId = event.actorId
  const payload = event.payload
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return context
  const source = payload as Record<string, unknown>
  for (const field of SCALAR_FIELDS) {
    const value = source[field]
    if (typeof value === 'string' && value.length > 0) assignScalar(context, field, value)
  }
  for (const field of LIST_FIELDS) {
    const ids = principalIds(source[field])
    if (ids) assignList(context, field, ids)
  }
  if (source.notify !== 'everyone') delete context.allSubscribers
  return context
}

export function createPayloadAudienceReader(): AudienceReader {
  return { async read(event) { return audienceFromPayload(event) } }
}