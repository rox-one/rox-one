/**
 * RMA-I026 / #382 — Calendar/Reminders/Calls/Chats via Conation.
 * Live writes stay BLOCKED. No fake dialer. remoteId is namespaced by account.
 */

import { confirmWrite } from './capabilities.ts'
import { blocked, denied, type MeetingOpResult } from '../types.ts'

export type CalendarOccurrence = {
  readonly accountId: string
  readonly calendarId: string
  readonly eventId: string
  readonly occurrenceId: string
  readonly dateOnly?: boolean
  readonly timeZone: string
  readonly canceled?: boolean
  readonly exception?: boolean
}

export function occurrenceKey(row: CalendarOccurrence): string {
  return `${row.accountId}:${row.calendarId}:${row.eventId}:${row.occurrenceId}`
}

export function applyCalendarWrite(row: CalendarOccurrence): MeetingOpResult {
  const write = confirmWrite({
    moduleId: 'GraphqlSoupCalendarEvent',
    operation: 'edit',
    authPresent: true,
  })
  if (row.canceled) return blocked('calendar-canceled-not-live')
  if (!write.allowed) return blocked('calendar-conation-unconfirmed')
  return denied('not-live')
}

export function bindCall(meetingId: string, remoteCallId: string, seen: Map<string, string>): MeetingOpResult {
  const write = confirmWrite({
    moduleId: 'GraphqlSoupCall',
    operation: 'create',
    authPresent: true,
  })
  if (!write.allowed) return blocked('call-bind-not-live')
  if (seen.has(remoteCallId) && seen.get(remoteCallId) !== meetingId) {
    return { status: 'duplicate', reason: 'call-dedupe', live: false, evidenceLevel: 'U1' }
  }
  return blocked('call-bind-not-live')
}

export function fakeDialerEnabled(): false {
  return false
}
