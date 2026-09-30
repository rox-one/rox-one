import { describe, expect, it } from 'bun:test'
import { isLiveVerified } from '../../types.ts'
import {
  applyCalendarWrite,
  bindCall,
  fakeDialerEnabled,
  occurrenceKey,
  type CalendarOccurrence,
} from '../calendar-calls.ts'

const occ = (overrides: Partial<CalendarOccurrence> = {}): CalendarOccurrence => ({
  accountId: 'acct-1',
  calendarId: 'cal-1',
  eventId: 'evt-1',
  occurrenceId: 'occ-1',
  timeZone: 'UTC',
  ...overrides,
})

describe('calendar-calls (#382) fail-closed', () => {
  it('distinguishes account, calendar, event, and recurrence occurrence identities', () => {
    const rows = [
      occ({ accountId: 'a:b', calendarId: 'c', eventId: 'd', occurrenceId: 'e' }),
      occ({ accountId: 'a', calendarId: 'b:c', eventId: 'd', occurrenceId: 'e' }),
      occ({ accountId: 'a', calendarId: 'b', eventId: 'c:d', occurrenceId: 'e' }),
      occ({ accountId: 'a', calendarId: 'b', eventId: 'c', occurrenceId: 'd:e' }),
      occ({ accountId: 'a', calendarId: 'b', eventId: 'c', occurrenceId: 'e:f' }),
    ]
    expect(new Set(rows.map(occurrenceKey)).size).toBe(rows.length)
  })

  it('blocks unsupported writes, canceled occurrences, and synthetic dialing', () => {
    expect(applyCalendarWrite(occ({ exception: true })).status).toBe('blocked')
    expect(applyCalendarWrite(occ({ canceled: true })).status).toBe('blocked')
    expect(applyCalendarWrite(occ({ dateOnly: true, timeZone: 'Europe/Moscow' })).status).toBe('blocked')
    expect(fakeDialerEnabled()).toBe(false)
    expect(bindCall('mtg-1', 'call-1', new Map()).status).toBe('blocked')
  })

  it('never treats unavailable external binding as verified', () => {
    const result = bindCall('mtg-1', 'call-1', new Map())
    expect(result.status).toBe('blocked')
    expect(result.live).toBe(false)
    expect(isLiveVerified(result)).toBe(false)
  })
})
