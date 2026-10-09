/**
 * W1-09 (#1506) — Activity read model over `domain_event` (DATA-MODEL §9.1).
 *
 * The read model is a bounded, newest-first projection of committed domain
 * events: ids only (type, actor, subject, refs, revision, when). Titles come
 * from the resolver at render time, so a feed item can be rendered for any
 * viewer without re-checking the payload — and an event payload that carries
 * restricted text never enters the read model.
 *
 * `reduceActivity` is pure: the caller decides where the state lives (renderer
 * atom, server projection) and how events arrive (local push, `?since=seq`
 * refetch).
 */

import type { EntityRef } from '../entities/refs.ts'
import type { DomainEvent, DomainEventType } from '../events/types.ts'
import { collectEntityRefs } from './triggers.ts'

/** Newest items kept in one read model. */
export const MAX_ACTIVITY_ITEMS = 500

export interface ActivityItem {
  /** `domain_event.event_id`. */
  id: string
  /** Store order within the workspace log (`domain_event.sequence`). */
  sequence?: number
  type: DomainEventType
  /** `<module>` prefix of the event type (DATA-MODEL §9.1). */
  module: string
  actorId?: string
  subject?: EntityRef
  /** Ids-only refs collected from the payload. */
  refs: readonly EntityRef[]
  revision: number
  at: string
}

export interface ActivityState {
  /** Newest first. */
  items: readonly ActivityItem[]
  /** Highest store sequence seen (0 when nothing was applied). */
  lastSequence: number
  /** Items dropped by the cap; the host offers "load more" when > 0. */
  dropped: number
}

export function createActivityState(): ActivityState {
  return { items: [], lastSequence: 0, dropped: 0 }
}

/** `<module>.<action>` → `<module>`; a bare type is its own module. */
export function moduleOfEventType(type: string): string {
  const dot = type.indexOf('.')
  return dot === -1 ? type : type.slice(0, dot)
}

/** Ids-only projection of one event. */
export function activityItemFromEvent(event: DomainEvent): ActivityItem {
  const item: ActivityItem = {
    id: event.eventId,
    type: event.type,
    module: moduleOfEventType(event.type),
    refs: collectEntityRefs(event.payload),
    revision: event.aggregateRevision,
    at: event.createdAt,
  }
  if (event.sequence !== undefined) item.sequence = event.sequence
  if (event.actorId) item.actorId = event.actorId
  if (event.subject) item.subject = { ...event.subject }
  return item
}

/**
 * Apply events to the read model. Redelivered events (same `event_id`, e.g. a
 * relay retry or a replayed batch) are applied once; the newest
 * `MAX_ACTIVITY_ITEMS` survive.
 */
export function reduceActivity(state: ActivityState, events: readonly DomainEvent[]): ActivityState {
  if (events.length === 0) return state
  const seen = new Set(state.items.map(item => item.id))
  const fresh: ActivityItem[] = []
  let lastSequence = state.lastSequence
  for (const event of events) {
    if (!event.eventId || seen.has(event.eventId)) continue
    seen.add(event.eventId)
    if (event.sequence !== undefined && event.sequence > lastSequence) lastSequence = event.sequence
    fresh.push(activityItemFromEvent(event))
  }
  if (fresh.length === 0) return state
  const merged = [...fresh, ...state.items].sort(compareNewestFirst)
  const overflow = Math.max(0, merged.length - MAX_ACTIVITY_ITEMS)
  return {
    items: overflow > 0 ? merged.slice(0, MAX_ACTIVITY_ITEMS) : merged,
    lastSequence,
    dropped: state.dropped + overflow,
  }
}

function compareNewestFirst(a: ActivityItem, b: ActivityItem): number {
  if (a.sequence !== undefined && b.sequence !== undefined && a.sequence !== b.sequence) return b.sequence - a.sequence
  const at = Date.parse(b.at) - Date.parse(a.at)
  return at !== 0 ? at : a.id < b.id ? 1 : a.id > b.id ? -1 : 0
}

export interface ActivityDayGroup {
  /** `YYYY-MM-DD` in `timeZone` (default: the host's zone). */
  day: string
  items: readonly ActivityItem[]
}

/**
 * Day-grouped view for the Notifications list (UI-SPEC §12): newest day first,
 * items inside a day newest first, empty days omitted.
 */
export function activityByDay(items: readonly ActivityItem[], timeZone?: string): ActivityDayGroup[] {
  const groups: ActivityDayGroup[] = []
  const byDay = new Map<string, ActivityItem[]>()
  for (const item of items) {
    const day = activityDayKey(item.at, timeZone)
    let bucket = byDay.get(day)
    if (!bucket) {
      bucket = []
      byDay.set(day, bucket)
    }
    bucket.push(item)
  }
  for (const [day, bucket] of [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))) {
    groups.push({ day, items: bucket.sort(compareNewestFirst) })
  }
  return groups
}

/** `YYYY-MM-DD` for an ISO instant in `timeZone` (invalid input → the raw value's date part). */
export function activityDayKey(iso: string, timeZone?: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return iso.slice(0, 10)
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(at)
  } catch {
    return at.toISOString().slice(0, 10)
  }
}