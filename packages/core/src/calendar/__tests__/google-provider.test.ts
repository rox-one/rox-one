import { describe, expect, it } from 'bun:test'
import { CalendarAuthExpiredError, GOOGLE_CALENDAR_SYNC_WINDOW, GoogleCalendarRestAdapter, googleCalendarSyncWindow, mapGoogleCalendarEvent } from '../providers/google.ts'
import { CalendarProviderUnavailableError } from '../adapters.ts'

const context = { accountId: 'acct-1', calendarId: 'primary', defaultTimeZone: 'Europe/Moscow' }
const day = 24 * 60 * 60 * 1000

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** Test seam: records request URLs and serves canned responses (structural stand-in for fetch). */
function recordingFetch(handler: (url: string) => Response | Promise<Response>): { impl: typeof fetch; calls: string[] } {
  const calls: string[] = []
  const impl = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input)
    calls.push(url)
    return handler(url)
  }) as unknown as typeof fetch
  return { impl, calls }
}

describe('mapGoogleCalendarEvent', () => {
  it('maps an all-day event to a UTC-anchored full day', () => {
    const event = mapGoogleCalendarEvent({
      id: 'all-day',
      etag: '"e1"',
      summary: 'Company holiday',
      start: { date: '2026-09-12' },
      end: { date: '2026-09-13' },
    }, context)

    expect(event).not.toBeNull()
    expect(event!.allDay).toBe(true)
    expect(event!.startAt).toBe(Date.parse('2026-09-12T00:00:00Z'))
    expect(event!.endAt).toBe(Date.parse('2026-09-13T00:00:00Z'))
    expect(event!.timeZone).toBe('Europe/Moscow')
    expect(event!.title).toBe('Company holiday')
    expect(event!.deleted).toBe(false)
    expect(event!.kind).toBe('event')
  })

  it('maps a timed event with its own time zone', () => {
    const event = mapGoogleCalendarEvent({
      id: 'timed',
      summary: 'Standup',
      start: { dateTime: '2026-09-12T09:00:00+03:00', timeZone: 'Europe/Moscow' },
      end: { dateTime: '2026-09-12T09:30:00+03:00', timeZone: 'Europe/Moscow' },
    }, context)

    expect(event!.allDay).toBe(false)
    expect(event!.startAt).toBe(Date.parse('2026-09-12T09:00:00+03:00'))
    expect(event!.endAt).toBe(Date.parse('2026-09-12T09:30:00+03:00'))
    expect(event!.timeZone).toBe('Europe/Moscow')
  })

  it('keeps the provider recurrence rule and instance key for recurring events', () => {
    const master = mapGoogleCalendarEvent({
      id: 'series',
      summary: 'Weekly sync',
      start: { dateTime: '2026-09-12T09:00:00Z', timeZone: 'UTC' },
      end: { dateTime: '2026-09-12T10:00:00Z', timeZone: 'UTC' },
      recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=FR'],
    }, context)
    expect(master!.recurrence).toBe('RRULE:FREQ=WEEKLY;BYDAY=FR')
    expect(master!.occurrenceId).toBeUndefined()

    const instance = mapGoogleCalendarEvent({
      id: 'series_20260912',
      recurringEventId: 'series',
      summary: 'Weekly sync',
      start: { dateTime: '2026-09-19T09:00:00Z', timeZone: 'UTC' },
      end: { dateTime: '2026-09-19T10:00:00Z', timeZone: 'UTC' },
    }, context)
    expect(instance!.occurrenceId).toBe('series_20260912')
    expect(instance!.id).toBe('series_20260912')
  })

  it('maps a cancelled event to a tombstone and skips resources without a start', () => {
    const cancelled = mapGoogleCalendarEvent({
      id: 'gone',
      status: 'cancelled',
      start: { dateTime: '2026-09-12T09:00:00Z' },
      end: { dateTime: '2026-09-12T09:30:00Z' },
    }, context)
    expect(cancelled!.deleted).toBe(true)

    expect(mapGoogleCalendarEvent({ id: 'no-start' }, context)).toBeNull()
    expect(mapGoogleCalendarEvent({ start: { dateTime: '2026-09-12T09:00:00Z' } }, context)).toBeNull()
  })
})

describe('GoogleCalendarRestAdapter', () => {
  it('lists the sync window with singleEvents and maps event resources', async () => {
    const { impl, calls } = recordingFetch(() => jsonResponse({
      items: [
        { id: 'e1', summary: 'A', start: { dateTime: '2026-09-12T09:00:00Z' }, end: { dateTime: '2026-09-12T10:00:00Z' } },
        { id: 'e2', status: 'cancelled', start: { date: '2026-09-13' }, end: { date: '2026-09-14' } },
      ],
    }))

    const adapter = new GoogleCalendarRestAdapter({
      accessToken: async () => 'token-1',
      fetchImpl: impl,
      timeMin: Date.parse('2026-08-12T00:00:00Z'),
      timeMax: Date.parse('2027-01-12T00:00:00Z'),
    })

    expect(adapter.available()).toBe(true)
    expect(adapter.mode).toBe('live')
    expect(adapter.provider).toBe('google')

    const page = await adapter.listEvents('acct-1')
    expect(page.events.map((event) => event.id)).toEqual(['e1', 'e2'])
    expect(page.events[1]!.deleted).toBe(true)
    expect(page.events.every((event) => event.accountId === 'acct-1')).toBe(true)

    const url = new URL(calls[0]!)
    expect(url.pathname).toBe('/calendar/v3/calendars/primary/events')
    expect(url.searchParams.get('singleEvents')).toBe('true')
    expect(url.searchParams.get('timeMin')).toBe('2026-08-12T00:00:00.000Z')
    expect(url.searchParams.get('timeMax')).toBe('2027-01-12T00:00:00.000Z')
    expect(page.cursor).toContain('google:')
  })

  it('follows pagination and prefers a nextSyncToken cursor', async () => {
    let call = 0
    const { impl, calls } = recordingFetch(() => {
      call += 1
      return call === 1
        ? jsonResponse({ items: [{ id: 'p1', start: { date: '2026-09-12' }, end: { date: '2026-09-13' } }], nextPageToken: 'PAGE2' })
        : jsonResponse({ items: [{ id: 'p2', start: { date: '2026-09-20' }, end: { date: '2026-09-21' } }], nextSyncToken: 'SYNC-9' })
    })

    const adapter = new GoogleCalendarRestAdapter({ accessToken: async () => 'token', fetchImpl: impl })
    const page = await adapter.listEvents('acct-1')

    expect(page.events.map((event) => event.id)).toEqual(['p1', 'p2'])
    expect(page.cursor).toBe('SYNC-9')
    expect(new URL(calls[1]!).searchParams.get('pageToken')).toBe('PAGE2')
  })

  it('raises an auth-expired error for a 401/403 provider response', async () => {
    const { impl } = recordingFetch(() => jsonResponse({ error: { code: 401, message: 'Invalid Credentials' } }, 401))
    const adapter = new GoogleCalendarRestAdapter({ accessToken: async () => 'stale', fetchImpl: impl })
    await expect(adapter.listEvents('acct-1')).rejects.toBeInstanceOf(CalendarAuthExpiredError)
  })

  it('maps a refresh failure to an auth-expired error', async () => {
    const adapter = new GoogleCalendarRestAdapter({
      accessToken: async () => { throw new Error('Failed to refresh Google token') },
    })
    await expect(adapter.listEvents('acct-1')).rejects.toBeInstanceOf(CalendarAuthExpiredError)
  })

  it('stays unavailable when no access token can be produced', async () => {
    const adapter = new GoogleCalendarRestAdapter({ accessToken: async () => '' })
    await expect(adapter.listEvents('acct-1')).rejects.toBeInstanceOf(CalendarProviderUnavailableError)
  })

  it('defaults the sync window to [-30d, +90d]', () => {
    const now = Date.parse('2026-09-12T09:00:00Z')
    const window = googleCalendarSyncWindow(now)
    expect(window.timeMin).toBe(now - 30 * day)
    expect(window.timeMax).toBe(now + 90 * day)
    expect(GOOGLE_CALENDAR_SYNC_WINDOW.pastMs).toBe(30 * day)
    expect(GOOGLE_CALENDAR_SYNC_WINDOW.futureMs).toBe(90 * day)
  })
})