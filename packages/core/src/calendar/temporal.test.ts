import { describe, expect, test } from 'bun:test'
import {
  dedupeOccurrences,
  fromCalendarEvent,
  fromSessionActivity,
  fromTaskDue,
  occurrencesInRange,
} from './temporal.ts'
import type { CalendarEvent, TaskLike } from './types.ts'

describe('TemporalOccurrence (issue 339)', () => {
  test('all-day dates do not timezone-shift the calendar day', () => {
    const event: CalendarEvent = {
      id: 'e1',
      accountId: 'acct',
      calendarId: 'primary',
      title: 'Holiday',
      startAt: Date.parse('2026-09-13T00:00:00.000Z'),
      endAt: Date.parse('2026-09-14T00:00:00.000Z'),
      allDay: true,
      timeZone: 'America/Los_Angeles',
      deleted: false,
      kind: 'event',
      etag: 'r1',
    }
    const occurrence = fromCalendarEvent(event, 'ws')
    expect(occurrence.allDayDate).toBe('2026-09-13')
    expect(occurrence.startAt).toBeUndefined()
    expect(occurrence.editable).toBe(false)
  })

  test('dedupes identical sources and keeps a range index', () => {
    const task: TaskLike = { id: 't1', title: 'Due', dueAt: 1_700_000_000_000 }
    const first = fromTaskDue(task, 'ws')!
    const second = fromTaskDue(task, 'ws')!
    const session = fromSessionActivity({ id: 's1', workspaceId: 'ws', createdAt: 1_700_000_100_000 })
    const items = dedupeOccurrences([first, second, session])
    expect(items).toHaveLength(2)
    expect(occurrencesInRange(items, 1_700_000_000_000 - 1, 1_700_000_000_000 + 1)).toHaveLength(1)
  })

  test('session activity is not an editable meeting', () => {
    const occurrence = fromSessionActivity({ id: 's1', workspaceId: 'ws', createdAt: 50 })
    expect(occurrence.kind).toBe('session-activity')
    expect(occurrence.editable).toBe(false)
    expect(occurrence.timing).toBe('actual')
  })
})
