import { describe, expect, test } from 'bun:test'
import { formatRox2EntityId } from '../../rox2/platform-contract.ts'
import {
  civilDateInZone,
  dedupeOccurrences,
  occurrenceFromCalendarEvent,
  occurrenceFromTaskDue,
  occurrencesInRange,
} from '../occurrences.ts'
import type { CalendarEvent } from '../types.ts'

const utcMorning = Date.parse('2026-09-12T00:00:00.000Z')

function event(partial: Partial<CalendarEvent> & Pick<CalendarEvent, 'id' | 'accountId'>): CalendarEvent {
  return {
    calendarId: 'cal-1',
    title: 'Standup',
    startAt: utcMorning,
    endAt: utcMorning + 60 * 60 * 1000,
    allDay: false,
    timeZone: 'UTC',
    deleted: false,
    kind: 'event',
    ...partial,
  }
}

describe('TemporalOccurrence', () => {
  test('calendar events and tasks map without becoming each other', () => {
    const work = occurrenceFromCalendarEvent(event({ id: 'e1', accountId: 'work' }), 'etag-1')
    const home = occurrenceFromCalendarEvent(event({ id: 'e1', accountId: 'home' }), 'etag-1')
    expect(work?.sourceRef).toBe(formatRox2EntityId('calendar-event', 'work/cal-1/e1'))
    expect(home?.sourceRef).not.toBe(work?.sourceRef)
    expect(work?.kind).toBe('event')
    const task = occurrenceFromTaskDue({ id: 't1', title: 'Ship', dueAt: utcMorning }, 'UTC')
    expect(task?.kind).toBe('task')
    expect(task?.sourceRef).toBe('task:t1')
  })

  test('all-day civil date stays on the event timezone day', () => {
    const lateUtc = Date.parse('2026-09-12T22:00:00.000Z')
    const item = occurrenceFromCalendarEvent(
      event({ id: 'all', accountId: 'work', startAt: lateUtc, endAt: lateUtc + 86400000, allDay: true, timeZone: 'Pacific/Auckland' }),
    )
    expect(item?.allDayDate).toBe(civilDateInZone(lateUtc, 'Pacific/Auckland'))
    expect(item?.allDayDate).not.toBe('2026-09-12')
  })

  test('dedupes the same source and filters a range', () => {
    const a = occurrenceFromCalendarEvent(event({ id: 'e1', accountId: 'work' }))!
    const copy = occurrenceFromCalendarEvent(event({ id: 'e1', accountId: 'work', title: 'Copy' }))!
    const other = occurrenceFromCalendarEvent(
      event({ id: 'e2', accountId: 'work', startAt: utcMorning + 2 * 86400000, endAt: utcMorning + 2 * 86400000 + 3600000 }),
    )!
    const unique = dedupeOccurrences([a, copy, other])
    expect(unique).toHaveLength(2)
    expect(occurrencesInRange(unique, utcMorning, utcMorning + 86400000).map((item) => item.sourceRef)).toEqual([
      a.sourceRef,
    ])
  })

  test('deleted events and completed tasks are not occurrences', () => {
    expect(occurrenceFromCalendarEvent(event({ id: 'e1', accountId: 'work', deleted: true }))).toBeNull()
    expect(occurrenceFromTaskDue({ id: 't1', title: 'Done', dueAt: utcMorning, completedAt: utcMorning }, 'UTC')).toBeNull()
  })
})
