import { describe, expect, test } from 'bun:test'
import { formatRox2EntityId } from '../../rox2/platform-contract.ts'
import {
  civilDateInZone,
  dedupeOccurrences,
  occurrenceFromCalendarEvent,
  occurrenceFromTaskDue,
  occurrenceKey,
  occurrencesInRange,
} from '../occurrences.ts'
import type { TemporalOccurrence } from '../occurrences.ts'
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
    expect(work?.sourceRef).toBe(formatRox2EntityId('calendar-event', JSON.stringify(['work', 'cal-1', 'e1'])))
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

  test('keeps repeated fall-back instants distinct and preserves their event zone', () => {
    const firstFold = Date.parse('2026-11-01T05:30:00.000Z')
    const secondFold = Date.parse('2026-11-01T06:30:00.000Z')
    const first = occurrenceFromCalendarEvent(event({
      id: 'fold-1',
      accountId: 'work',
      startAt: firstFold,
      endAt: firstFold + 30 * 60 * 1000,
      timeZone: 'America/New_York',
    }))!
    const second = occurrenceFromCalendarEvent(event({
      id: 'fold-2',
      accountId: 'work',
      startAt: secondFold,
      endAt: secondFold + 30 * 60 * 1000,
      timeZone: 'America/New_York',
    }))!

    expect(first.startAt).toBe(firstFold)
    expect(second.startAt).toBe(secondFold)
    expect(first.timeZone).toBe('America/New_York')
    expect(second.timeZone).toBe('America/New_York')
    expect(first.startAt).not.toBe(second.startAt)
  })

  test('keeps recurrence instances distinct without treating the rule as an instance key', () => {
    const base = event({
      id: 'series-1',
      accountId: 'work',
      recurrence: 'RRULE:FREQ=DAILY',
    })
    const first = occurrenceFromCalendarEvent({ ...base, occurrenceId: '2026-09-12T09:00:00Z' })!
    const second = occurrenceFromCalendarEvent({ ...base, occurrenceId: '2026-09-13T09:00:00Z' })!

    expect(first.recurrenceInstance).toBe('2026-09-12T09:00:00Z')
    expect(second.recurrenceInstance).toBe('2026-09-13T09:00:00Z')
    expect(dedupeOccurrences([first, second])).toHaveLength(2)
  })
  test('tuple and occurrence keys do not collide on embedded separators', () => {
    const left = occurrenceFromCalendarEvent(event({
      id: 'c',
      accountId: 'a/b',
      calendarId: 'c',
    }))!
    const right = occurrenceFromCalendarEvent(event({
      id: 'b/c',
      accountId: 'a',
      calendarId: 'b',
    }))!
    const occurrence = (sourceRef: string, recurrenceInstance: string): TemporalOccurrence => ({
      sourceRef,
      recurrenceInstance,
      kind: 'event',
      startAt: utcMorning,
      endAt: utcMorning + 60 * 60 * 1000,
      timeZone: 'UTC',
      timing: 'planned',
      editable: true,
      permission: 'write',
    })

    expect(left.sourceRef).not.toBe(right.sourceRef)
    expect(occurrenceKey(occurrence('x::y', 'z'))).not.toBe(occurrenceKey(occurrence('x', 'y::z')))
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
