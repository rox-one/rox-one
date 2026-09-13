/**
 * Calendar and Reminders connectors (Rox tracker Issue 18).
 * Events never become personal tasks.
 */

export type CalendarProvider = 'google' | 'outlook' | 'yandex' | 'mailru' | 'appleReminders'
export type AccountStatus = 'disconnected' | 'pending' | 'connected' | 'revoked'
export type SyncConflictKind = 'update' | 'delete' | 'timezone'
export type CalendarUiStatus = 'none' | 'pending' | 'connected' | 'conflict' | 'timezone'

export interface CalendarAccount {
  id: string
  provider: CalendarProvider
  displayName: string
  status: AccountStatus
  scopedCalendarIds: string[]
  timeZone: string
  /** Opaque vault pointer. Never a token, refresh secret, or password. */
  credentialRef: string
}

export interface CalendarEvent {
  /** Remote event id within one account+calendar. Not globally unique. */
  id: string
  accountId: string
  calendarId: string
  title: string
  startAt: number
  endAt: number
  allDay: boolean
  timeZone: string
  recurrence?: string
  deleted: boolean
  etag?: string
  /** Local unsynced edits. Remote-only etag changes are not conflicts. */
  localDirty?: boolean
  kind: 'event'
}

export interface CapabilityGap {
  provider: CalendarProvider
  supportsOAuth: boolean
  supportsReminders: boolean
  supportsAllDay: boolean
  supportsRecurrence: boolean
  notes: string
}

export interface ReminderProposal {
  id: string
  title: string
  dueAt: number
  sourceEventId?: string
  accepted: boolean
  dismissed: boolean
}

export interface SyncConflict {
  id: string
  kind: SyncConflictKind
  eventId: string
}

export interface SyncJournal {
  accountId: string
  cursor?: string
  lastSyncAt?: number
  lastSyncedRevision?: string
  conflicts: SyncConflict[]
}

export interface TaskLike {
  id: string
  title: string
  list?: string
  dueAt?: number
  evening?: boolean
  projectId?: string
  completedAt?: number
}

export type MergedTodayItem =
  | { kind: 'task'; id: string; title: string; at?: number; projectId?: string; task: TaskLike }
  | { kind: 'event'; id: string; title: string; at?: number; projectId?: undefined; event: CalendarEvent }

export interface CalendarBundle {
  version: number
  /** Persisted mint counter so fromJson does not collide with existing ids. */
  idSeq?: number
  accounts: CalendarAccount[]
  events: CalendarEvent[]
  journals: SyncJournal[]
  proposals: ReminderProposal[]
}

export const CALENDAR_BUNDLE_VERSION = 1

export function emptyCalendarBundle(): CalendarBundle {
  return { version: CALENDAR_BUNDLE_VERSION, accounts: [], events: [], journals: [], proposals: [] }
}

/** Account-scoped event identity. Remote ids collide across accounts. */
export function calendarEventIdentity(
  event: Pick<CalendarEvent, 'accountId' | 'calendarId' | 'id'>,
): string {
  return `${event.accountId}/${event.calendarId}/${event.id}`
}

export function sameCalendarEvent(
  a: Pick<CalendarEvent, 'accountId' | 'calendarId' | 'id'>,
  b: Pick<CalendarEvent, 'accountId' | 'calendarId' | 'id'>,
): boolean {
  return calendarEventIdentity(a) === calendarEventIdentity(b)
}
