/**
 * TemporalOccurrence adapter (ROX-AUD-094 / #339).
 * Meetings, task due dates, and related activity share one occurrence type.
 * Activity is not rewritten into an editable meeting.
 */

import { formatRox2EntityId } from '../rox2/platform-contract.ts'
import { calendarEventIdentity, type CalendarEvent, type TaskLike } from './types.ts'

export const TEMPORAL_OCCURRENCE_KINDS = [
  'event',
  'task',
  'session',
  'note',
  'run',
  'milestone',
] as const

export type TemporalOccurrenceKind = (typeof TEMPORAL_OCCURRENCE_KINDS)[number]

export type TemporalOccurrence = {
  sourceRef: string
  revision?: string
  kind: TemporalOccurrenceKind
  startAt: number
  endAt: number
  allDayDate?: string
  timeZone: string
  timing: 'planned' | 'actual'
  recurrenceInstance?: string
  editable: boolean
  permission: 'read' | 'write'
}

export function civilDateInZone(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms))
}

export function occurrenceFromCalendarEvent(
  event: CalendarEvent,
  revision?: string,
): TemporalOccurrence | null {
  if (event.deleted) return null
  return {
    sourceRef: formatRox2EntityId('calendar-event', calendarEventIdentity(event)),
    revision: revision ?? event.etag,
    kind: 'event',
    startAt: event.startAt,
    endAt: event.endAt,
    allDayDate: event.allDay ? civilDateInZone(event.startAt, event.timeZone) : undefined,
    timeZone: event.timeZone,
    timing: 'planned',
    recurrenceInstance: event.recurrence,
    editable: true,
    permission: 'write',
  }
}

export function occurrenceFromTaskDue(
  task: TaskLike,
  timeZone: string,
): TemporalOccurrence | null {
  if (task.dueAt == null || task.completedAt != null) return null
  const startAt = task.dueAt
  const endAt = task.evening ? startAt + 3 * 60 * 60 * 1000 : startAt
  return {
    sourceRef: formatRox2EntityId('task', task.id),
    kind: 'task',
    startAt,
    endAt,
    timeZone,
    timing: 'planned',
    editable: true,
    permission: 'write',
  }
}

export function occurrenceKey(item: TemporalOccurrence): string {
  return `${item.sourceRef}::${item.recurrenceInstance ?? 'master'}`
}

export function dedupeOccurrences(items: readonly TemporalOccurrence[]): TemporalOccurrence[] {
  const seen = new Map<string, TemporalOccurrence>()
  for (const item of items) {
    const key = occurrenceKey(item)
    if (!seen.has(key)) seen.set(key, item)
  }
  return [...seen.values()]
}

export function occurrencesInRange(
  items: readonly TemporalOccurrence[],
  rangeStart: number,
  rangeEnd: number,
): TemporalOccurrence[] {
  return items.filter((item) => item.startAt < rangeEnd && item.endAt > rangeStart)
}
