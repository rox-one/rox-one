/**
 * TemporalOccurrence adapters (issue #339).
 * Activity is not an editable meeting. All-day uses a calendar date, not a TZ-shifted instant.
 */

import type { Rox2EntityRef, Rox2Permission } from '../rox2/platform-contract.ts'
import type { CalendarEvent } from './types.ts'
import type { TaskLike } from './types.ts'

export const TEMPORAL_OCCURRENCE_KINDS = [
  'calendar-event',
  'task-due',
  'session-activity',
  'note-activity',
  'run',
  'milestone',
] as const

export type TemporalOccurrenceKind = (typeof TEMPORAL_OCCURRENCE_KINDS)[number]
export type TemporalTiming = 'planned' | 'actual'

export type TemporalOccurrence = {
  sourceRef: Rox2EntityRef
  revision: string
  kind: TemporalOccurrenceKind
  startAt?: number
  endAt?: number
  allDayDate?: string
  timeZone: string
  timing: TemporalTiming
  recurrenceInstance?: string
  editable: boolean
  permission: Rox2Permission
}

export type SessionLikeOccurrence = {
  id: string
  workspaceId: string
  createdAt: number
  dueDate?: number | null
  revisionId?: string
}

function allDayDateFromInstant(ts: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(ts))
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value
  if (!year || !month || !day) throw new Error('Unable to format all-day date')
  return `${year}-${month}-${day}`
}

function occurrenceKey(item: TemporalOccurrence): string {
  const when = item.allDayDate ?? String(item.startAt ?? '')
  return `${item.kind}:${item.sourceRef.workspaceId}:${item.sourceRef.entityId}:${item.sourceRef.revisionId}:${when}:${item.recurrenceInstance ?? ''}`
}

export function fromCalendarEvent(
  event: CalendarEvent,
  workspaceId: string,
  permission: Rox2Permission = 'read',
): TemporalOccurrence {
  const sourceRef: Rox2EntityRef = {
    workspaceId,
    entityId: event.id,
    revisionId: event.etag ?? String(event.localRevision ?? 1),
  }
  const allDayDate = event.allDay ? allDayDateFromInstant(event.startAt) : undefined
  return {
    sourceRef,
    revision: sourceRef.revisionId,
    kind: 'calendar-event',
    startAt: event.allDay ? undefined : event.startAt,
    endAt: event.allDay ? undefined : event.endAt,
    allDayDate,
    timeZone: event.timeZone || 'UTC',
    timing: 'planned',
    editable: permission === 'write',
    permission,
  }
}

export function fromTaskDue(
  task: TaskLike,
  workspaceId: string,
  permission: Rox2Permission = 'read',
): TemporalOccurrence | null {
  if (task.dueAt == null) return null
  const sourceRef: Rox2EntityRef = { workspaceId, entityId: task.id, revisionId: String(task.dueAt) }
  return {
    sourceRef,
    revision: sourceRef.revisionId,
    kind: 'task-due',
    startAt: task.dueAt,
    timeZone: 'UTC',
    timing: 'planned',
    editable: false,
    permission,
  }
}

export function fromSessionActivity(
  session: SessionLikeOccurrence,
  permission: Rox2Permission = 'read',
): TemporalOccurrence {
  const sourceRef: Rox2EntityRef = {
    workspaceId: session.workspaceId,
    entityId: session.id,
    revisionId: session.revisionId ?? String(session.createdAt),
  }
  return {
    sourceRef,
    revision: sourceRef.revisionId,
    kind: 'session-activity',
    startAt: session.dueDate ?? session.createdAt,
    timeZone: 'UTC',
    timing: session.dueDate ? 'planned' : 'actual',
    editable: false,
    permission,
  }
}

export function dedupeOccurrences(items: readonly TemporalOccurrence[]): TemporalOccurrence[] {
  const seen = new Set<string>()
  const out: TemporalOccurrence[] = []
  for (const item of items) {
    const key = occurrenceKey(item)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

export function occurrencesInRange(
  items: readonly TemporalOccurrence[],
  from: number,
  to: number,
): TemporalOccurrence[] {
  return items.filter((item) => {
    if (item.allDayDate) {
      const start = Date.parse(`${item.allDayDate}T00:00:00.000Z`)
      const end = start + 24 * 60 * 60 * 1000
      return start < to && end > from
    }
    const start = item.startAt ?? Number.NEGATIVE_INFINITY
    const end = item.endAt ?? item.startAt ?? Number.POSITIVE_INFINITY
    return start < to && end > from
  })
}
