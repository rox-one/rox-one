/**
 * W1-14 (#1511) — Shared calendars and the free-busy redaction rule
 * (TECH-SPEC §11.9, DATA-MODEL §5.17, UI-SPEC §18.10).
 *
 * Calendars share through the one ACL engine; `calendar_member` carries the
 * role plus the per-subscriber presentation (`color`, `visible`, `notify`).
 * The `free_busy` role is a *calendar* role, and its promise is narrow:
 * a subscriber sees **busy blocks only** — `{start, end, busy: true}` with no
 * title, no description and no attendees — both from the query layer
 * (`calendar.free_busy`) and from the `calendar:{id}` topic filter.
 */

import type { AclStoredRole } from '../acl/roles.ts'
import type { RealtimeEventFrame } from '../events/topics.ts'

export const CALENDAR_MEMBER_ROLES = ['owner', 'editor', 'viewer', 'free_busy'] as const
export type CalendarMemberRole = (typeof CALENDAR_MEMBER_ROLES)[number]

export const CALENDAR_MEMBER_SUBJECT_TYPES = ['principal', 'space', 'channel', 'workspace'] as const
export type CalendarMemberSubjectType = (typeof CALENDAR_MEMBER_SUBJECT_TYPES)[number]

/**
 * Rank of a calendar role. `free_busy` ranks below `viewer` on purpose: it is
 * a *narrower* grant, not a weaker full one — the difference is what the role
 * may see, not how much of it.
 */
export const CALENDAR_ROLE_RANK: Readonly<Record<CalendarMemberRole, number>> = {
  owner: 100,
  editor: 70,
  viewer: 10,
  free_busy: 0,
}

/** `calendar_member` row (`17-collab.sql`). */
export interface CalendarMember {
  calendarId: string
  subjectType: CalendarMemberSubjectType
  subjectId: string
  role: CalendarMemberRole
  color?: string
  visible: boolean
  notify: boolean
  createdAt: string
}

export function isCalendarMemberRole(value: unknown): value is CalendarMemberRole {
  return typeof value === 'string' && (CALENDAR_MEMBER_ROLES as readonly string[]).includes(value)
}

/**
 * The effective role of a principal over a calendar: the strongest grant it
 * received directly or through a subject it belongs to (§11.5 inheritance).
 * A `free_busy` grant never wins over a real role.
 */
export function effectiveCalendarRole(grants: readonly CalendarMemberRole[]): CalendarMemberRole | null {
  let best: CalendarMemberRole | null = null
  for (const grant of grants) {
    if (!isCalendarMemberRole(grant)) continue
    if (best === null || CALENDAR_ROLE_RANK[grant] > CALENDAR_ROLE_RANK[best]) best = grant
  }
  return best
}

/** The ACL role a calendar grant is stored and evaluated as. */
export function aclRoleForCalendarMember(role: CalendarMemberRole): AclStoredRole {
  switch (role) {
    case 'owner':
      return 'owner'
    case 'editor':
      return 'editor'
    case 'viewer':
      return 'viewer'
    case 'free_busy':
      return 'free_busy'
  }
}

/** A redacted event: start, end and nothing else. */
export interface BusyBlock {
  start: string
  end: string
  busy: true
}

/**
 * What a free-busy subscriber must never see on an event. Kept as one list so
 * the query layer and the topic filter redact the same fields.
 */
export const FREE_BUSY_HIDDEN_FIELDS = [
  'title',
  'description',
  'location',
  'attendeeIds',
  'attendees',
  'organizerId',
  'organiserId',
  'notes',
  'attachments',
  'recap',
  'conference',
] as const

/** The event fields the redaction reads (`calendar_event`, `21-calendar.sql`). */
export interface CalendarEventTiming {
  startAt: string
  endAt: string
  allDay?: boolean
  /** `opaque` (default) blocks time; `transparent` / `free` does not. */
  transparency?: 'opaque' | 'transparent' | 'busy' | 'free'
  /** The viewer's own RSVP, when the event has them. */
  response?: 'accepted' | 'declined' | 'tentative' | 'needs_action'
}

/** Whether an event occupies the principal's time at all. */
export function eventBlocksTime(event: CalendarEventTiming): boolean {
  if (event.transparency === 'transparent' || event.transparency === 'free') return false
  return event.response !== 'declined'
}

/**
 * The event as a free-busy subscriber sees it: `{start, end, busy: true}`, or
 * `null` when the event does not occupy the calendar at all.
 */
export function redactForFreeBusy(event: CalendarEventTiming): BusyBlock | null {
  if (!eventBlocksTime(event)) return null
  return { start: event.startAt, end: event.endAt, busy: true }
}

/** Milliseconds of one minute; range clipping works in epoch ms. */
const MINUTE_MS = 60_000

export interface TimeRange {
  start: string
  end: string
}

/**
 * The busy blocks of `events` clipped to `range` (`calendar.free_busy`). Blocks
 * entirely outside the range are dropped; an event the range cuts is trimmed
 * to the range so two calendars can be compared slot by slot.
 */
export function freeBusyBlocks(events: readonly CalendarEventTiming[], range: TimeRange): BusyBlock[] {
  const rangeStart = Date.parse(range.start)
  const rangeEnd = Date.parse(range.end)
  const blocks: BusyBlock[] = []
  for (const event of events) {
    const block = redactForFreeBusy(event)
    if (!block) continue
    const start = Math.max(Date.parse(block.start), rangeStart)
    const end = Math.min(Date.parse(block.end), rangeEnd)
    if (end <= start) continue
    blocks.push({ start: new Date(start).toISOString(), end: new Date(end).toISOString(), busy: true })
  }
  return blocks.sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || Date.parse(a.end) - Date.parse(b.end))
}

/** `calendar.free_busy {principals[], range}` (TECH-SPEC §11.9). */
export interface FreeBusyPayload {
  /** Principals to aggregate over; the caller's own calendars are always included. */
  principals: string[]
  range: TimeRange
  /** Slot granularity of the suggestion chips, in minutes (default 30). */
  slotMinutes?: number
}

export interface FreeBusyResult {
  /** Busy blocks per principal, merged across every calendar they may see. */
  principals: Record<string, BusyBlock[]>
  /** Providers that could not be queried (CalDAV / Google bridge); their blocks are missing. */
  unavailable: string[]
}

/** Merge the busy blocks of several calendars of one principal into one timeline. */
export function mergeBusyBlocks(blocks: readonly BusyBlock[]): BusyBlock[] {
  const sorted = [...blocks].sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || Date.parse(a.end) - Date.parse(b.end))
  const merged: BusyBlock[] = []
  for (const block of sorted) {
    const last = merged[merged.length - 1]
    if (last && Date.parse(block.start) <= Date.parse(last.end)) {
      if (Date.parse(block.end) > Date.parse(last.end)) last.end = block.end
      continue
    }
    merged.push({ ...block })
  }
  return merged
}

/** Free slots inside `range` at `slotMinutes` granularity, for "Find a time". */
export function freeSlots(busy: readonly BusyBlock[], range: TimeRange, slotMinutes = 30): TimeRange[] {
  const step = Math.max(1, slotMinutes) * MINUTE_MS
  const start = Date.parse(range.start)
  const end = Date.parse(range.end)
  const merged = mergeBusyBlocks(busy)
  const slots: TimeRange[] = []
  for (let cursor = start; cursor + step <= end; cursor += step) {
    const slotEnd = cursor + step
    const blocked = merged.some(block => Date.parse(block.start) < slotEnd && Date.parse(block.end) > cursor)
    if (!blocked) slots.push({ start: new Date(cursor).toISOString(), end: new Date(slotEnd).toISOString() })
  }
  return slots
}

/**
 * The `calendar:{id}` topic filter (§11.9): a `free_busy` subscriber receives
 * event frames with every field but the timing replaced by the busy block.
 */
export function redactCalendarFrame(frame: RealtimeEventFrame, role: CalendarMemberRole | null): RealtimeEventFrame {
  if (role !== 'free_busy') return frame
  if (frame.type !== 'event.created' && frame.type !== 'event.updated' && frame.type !== 'event.deleted') return frame
  const payload = asJsonRecord(frame.payload)
  return { ...frame, payload: 'event' in payload ? { ...payload, event: redactEventFields(asJsonRecord(payload.event)) } : redactEventFields(payload) }
}

/** Realtime payloads are JSON objects by construction; typed reads go through the schema above them. */
function asJsonRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/** The kept part of an event frame: timing + `busy: true`, nothing else. */
export function redactEventFields(event: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { startAt: event.startAt, endAt: event.endAt, busy: true }
  if (event.allDay !== undefined) out.allDay = event.allDay
  for (const [field, value] of Object.entries(event)) {
    if ((FREE_BUSY_HIDDEN_FIELDS as readonly string[]).includes(field)) continue
    if (field === 'startAt' || field === 'endAt' || field === 'busy') continue
    out[field] = value
  }
  return out
}