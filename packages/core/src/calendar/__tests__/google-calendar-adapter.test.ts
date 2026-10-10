import { afterEach, describe, expect, it } from 'bun:test'
import {
  GOOGLE_CALENDAR_LIVE_ENV,
  GoogleCalendarAdapter,
  GoogleCalendarAuthExpiredError,
  GoogleCalendarHttpError,
  GoogleCalendarUnavailableError,
  registerGoogleCalendarTokenAccessor,
  type GoogleCalendarCredentials,
  type GoogleCalendarTokenAccessor,
} from '../google-calendar-adapter.ts'
import { createProductionAdapter, isCalendarConnectorWired, UnavailableCalendarAdapter } from '../adapters.ts'

const RANGE = { timeMin: Date.parse('2026-09-01T00:00:00.000Z'), timeMax: Date.parse('2026-09-30T00:00:00.000Z') }

class FakeGoogleTokenAccessor implements GoogleCalendarTokenAccessor {
  readonly saved: GoogleCalendarCredentials[] = []
  refreshCalls = 0
  constructor(private readonly overrides: Partial<GoogleCalendarTokenAccessor> = {}) {}

  hasCredentials(): boolean {
    return this.overrides.hasCredentials?.() ?? true
  }

  async loadCredentials(): Promise<GoogleCalendarCredentials | null> {
    if (this.overrides.loadCredentials) return this.overrides.loadCredentials()
    return { accessToken: 'access-1', refreshToken: 'refresh-1', clientId: 'cid', clientSecret: 'secret' }
  }

  saveCredentials(credentials: GoogleCalendarCredentials): void {
    this.saved.push(credentials)
  }

  async refreshCredentials(credentials: GoogleCalendarCredentials): Promise<GoogleCalendarCredentials> {
    this.refreshCalls += 1
    if (this.overrides.refreshCredentials) return this.overrides.refreshCredentials(credentials)
    return { accessToken: 'access-2', refreshToken: 'refresh-1' }
  }
}

function accessor(overrides: Partial<GoogleCalendarTokenAccessor> = {}): FakeGoogleTokenAccessor {
  return new FakeGoogleTokenAccessor(overrides)
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const originalGate = process.env[GOOGLE_CALENDAR_LIVE_ENV]

afterEach(() => {
  if (originalGate === undefined) delete process.env[GOOGLE_CALENDAR_LIVE_ENV]
  else process.env[GOOGLE_CALENDAR_LIVE_ENV] = originalGate
  registerGoogleCalendarTokenAccessor(null)
})

describe('GoogleCalendarAdapter', () => {
  it('maps Google events to CalendarEvent and requests the expected query', async () => {
    const urls: string[] = []
    const adapter = new GoogleCalendarAdapter({
      credentials: accessor(),
      range: RANGE,
      fetchImpl: async (input) => {
        urls.push(String(input))
        return jsonResponse({
          items: [
            {
              id: 'timed-1',
              etag: '"e1"',
              status: 'confirmed',
              summary: 'Standup',
              start: { dateTime: '2026-09-02T09:00:00Z', timeZone: 'Europe/Moscow' },
              end: { dateTime: '2026-09-02T09:30:00Z', timeZone: 'Europe/Moscow' },
            },
            {
              id: 'allday-1',
              etag: '"e2"',
              summary: 'Holiday',
              start: { date: '2026-09-03' },
              end: { date: '2026-09-04' },
            },
            {
              id: 'series_20260904T090000Z',
              summary: 'Weekly sync',
              recurringEventId: 'series',
              recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=FR'],
              start: { dateTime: '2026-09-04T09:00:00Z' },
              end: { dateTime: '2026-09-04T10:00:00Z' },
            },
            {
              id: 'cancelled-1',
              status: 'cancelled',
              summary: 'Dropped',
              start: { dateTime: '2026-09-05T09:00:00Z' },
              end: { dateTime: '2026-09-05T10:00:00Z' },
            },
          ],
        })
      },
    })

    expect(adapter.mode).toBe('live')
    expect(adapter.available()).toBe(true)

    const page = await adapter.listEvents('acct-1')
    expect(urls).toHaveLength(1)
    const url = new URL(urls[0]!)
    expect(url.pathname).toBe('/calendar/v3/calendars/primary/events')
    expect(url.searchParams.get('singleEvents')).toBe('true')
    expect(url.searchParams.get('orderBy')).toBe('startTime')
    expect(url.searchParams.get('maxResults')).toBe('250')
    expect(url.searchParams.get('timeMin')).toBe(new Date(RANGE.timeMin).toISOString())
    expect(url.searchParams.get('timeMax')).toBe(new Date(RANGE.timeMax).toISOString())
    expect(url.searchParams.get('pageToken')).toBeNull()

    const timed = page.events[0]!
    expect(timed).toMatchObject({
      id: 'timed-1',
      accountId: 'acct-1',
      calendarId: 'primary',
      title: 'Standup',
      allDay: false,
      timeZone: 'Europe/Moscow',
      etag: '"e1"',
      deleted: false,
      kind: 'event',
    })
    expect(timed.startAt).toBe(Date.parse('2026-09-02T09:00:00Z'))
    expect(timed.endAt).toBe(Date.parse('2026-09-02T09:30:00Z'))

    const allDay = page.events[1]!
    expect(allDay.allDay).toBe(true)
    expect(allDay.startAt).toBe(Date.parse('2026-09-03T00:00:00.000Z'))
    expect(allDay.timeZone).toBe('UTC')

    const series = page.events[2]!
    expect(series.recurrence).toBe('RRULE:FREQ=WEEKLY;BYDAY=FR')
    expect(series.occurrenceId).toBe('series_20260904T090000Z')

    expect(page.events[3]!.deleted).toBe(true)
  })

  it('surfaces the Meet URI from hangoutLink and conferenceData video entry points', async () => {
    const adapter = new GoogleCalendarAdapter({
      credentials: accessor(),
      range: RANGE,
      fetchImpl: async () => jsonResponse({
        items: [
          {
            id: 'meet-link',
            summary: 'With hangoutLink',
            hangoutLink: 'https://meet.google.com/aaa-bbbb-ccc',
            start: { dateTime: '2026-09-02T09:00:00Z' },
            end: { dateTime: '2026-09-02T09:30:00Z' },
          },
          {
            id: 'meet-entrypoint',
            summary: 'With conferenceData entry point',
            conferenceData: {
              entryPoints: [
                { entryPointType: 'phone', uri: 'tel:+1-555-0100' },
                { entryPointType: 'video', uri: 'https://meet.google.com/ddd-eeee-fff' },
              ],
            },
            start: { dateTime: '2026-09-02T10:00:00Z' },
            end: { dateTime: '2026-09-02T10:30:00Z' },
          },
          {
            id: 'no-conference',
            summary: 'No conference',
            start: { dateTime: '2026-09-02T11:00:00Z' },
            end: { dateTime: '2026-09-02T11:30:00Z' },
          },
        ],
      }),
    })

    const page = await adapter.listEvents('acct-1')
    expect(page.events[0]!.meetUri).toBe('https://meet.google.com/aaa-bbbb-ccc')
    expect(page.events[1]!.meetUri).toBe('https://meet.google.com/ddd-eeee-fff')
    expect(page.events[2]!.meetUri).toBeUndefined()
  })

  it('follows nextPageToken and returns a resume cursor while bounded by maxPages', async () => {
    const calls: string[] = []
    const adapter = new GoogleCalendarAdapter({
      credentials: accessor(),
      range: RANGE,
      maxPages: 2,
      fetchImpl: async (input) => {
        calls.push(new URL(String(input)).searchParams.get('pageToken') ?? 'first')
        return jsonResponse({
          items: [{ id: `e${calls.length}`, summary: `Event ${calls.length}`, start: { dateTime: '2026-09-02T09:00:00Z' }, end: { dateTime: '2026-09-02T10:00:00Z' } }],
          nextPageToken: `tok-${calls.length + 1}`,
        })
      },
    })

    const page = await adapter.listEvents('acct-1')
    expect(calls).toEqual(['first', 'tok-2'])
    expect(page.events.map((event) => event.id)).toEqual(['e1', 'e2'])
    // Bounded run hands back the next page token instead of looping forever.
    expect(page.cursor).toBe('tok-3')
  })

  it('drains the final page and resumes from a supplied cursor', async () => {
    const urls: string[] = []
    let page = 0
    const adapter = new GoogleCalendarAdapter({
      credentials: accessor(),
      range: RANGE,
      fetchImpl: async (input) => {
        urls.push(String(input))
        page += 1
        return page === 1
          ? jsonResponse({ items: [{ id: 'e1', summary: 'One', start: { dateTime: '2026-09-02T09:00:00Z' }, end: { dateTime: '2026-09-02T10:00:00Z' } }], nextPageToken: 'tok-2' })
          : jsonResponse({ items: [{ id: 'e2', summary: 'Two', start: { dateTime: '2026-09-03T09:00:00Z' }, end: { dateTime: '2026-09-03T10:00:00Z' } }], nextSyncToken: 'sync-9' })
      },
    })

    const first = await adapter.listEvents('acct-1', 'cursor-7')
    expect(new URL(urls[0]!).searchParams.get('pageToken')).toBe('cursor-7')
    expect(new URL(urls[1]!).searchParams.get('pageToken')).toBe('tok-2')
    expect(first.events.map((event) => event.id)).toEqual(['e1', 'e2'])
    expect(first.cursor).toBe('sync-9')
  })

  it('refreshes once on 401 and persists the rotated token', async () => {
    const credentials = accessor()
    let calls = 0
    const adapter = new GoogleCalendarAdapter({
      credentials,
      range: RANGE,
      fetchImpl: async () => {
        calls += 1
        if (calls === 1) return new Response('unauthorized', { status: 401 })
        return jsonResponse({ items: [{ id: 'e1', summary: 'After refresh', start: { dateTime: '2026-09-02T09:00:00Z' }, end: { dateTime: '2026-09-02T10:00:00Z' } }] })
      },
    })

    const page = await adapter.listEvents('acct-1')
    expect(calls).toBe(2)
    expect(credentials.refreshCalls).toBe(1)
    expect(credentials.saved).toEqual([{ accessToken: 'access-2', refreshToken: 'refresh-1' }])
    expect(page.events[0]!.title).toBe('After refresh')
  })

  it('reports auth-expired when the 401 cannot be refreshed', async () => {
    const credentials = accessor({
      refreshCredentials: async () => {
        throw new Error('invalid_grant')
      },
    })
    const adapter = new GoogleCalendarAdapter({
      credentials,
      range: RANGE,
      fetchImpl: async () => new Response('unauthorized', { status: 401 }),
    })

    await expect(adapter.listEvents('acct-1')).rejects.toBeInstanceOf(GoogleCalendarAuthExpiredError)
  })

  it('reports auth-expired when the refreshed token is still rejected', async () => {
    const credentials = accessor()
    const adapter = new GoogleCalendarAdapter({
      credentials,
      range: RANGE,
      fetchImpl: async () => new Response('unauthorized', { status: 401 }),
    })

    await expect(adapter.listEvents('acct-1')).rejects.toBeInstanceOf(GoogleCalendarAuthExpiredError)
    expect(credentials.refreshCalls).toBe(1)
  })

  it('throws unavailable without stored credentials and never calls the API', async () => {
    let called = false
    const adapter = new GoogleCalendarAdapter({
      credentials: accessor({ hasCredentials: () => false }),
      range: RANGE,
      fetchImpl: async () => {
        called = true
        return jsonResponse({ items: [] })
      },
    })

    expect(adapter.available()).toBe(false)
    await expect(adapter.listEvents('acct-1')).rejects.toBeInstanceOf(GoogleCalendarUnavailableError)
    expect(called).toBe(false)
  })

  it('surfaces non-auth HTTP failures with the status code', async () => {
    const adapter = new GoogleCalendarAdapter({
      credentials: accessor(),
      range: RANGE,
      fetchImpl: async () => new Response('boom', { status: 503 }),
    })

    await expect(adapter.listEvents('acct-1')).rejects.toMatchObject({ code: 'GOOGLE_CALENDAR_HTTP', status: 503 })
    await expect(adapter.listEvents('acct-1')).rejects.toBeInstanceOf(GoogleCalendarHttpError)
  })
})

describe('google calendar production gate', () => {
  it('stays unavailable without the env gate even when credentials exist', () => {
    registerGoogleCalendarTokenAccessor(accessor())
    delete process.env[GOOGLE_CALENDAR_LIVE_ENV]

    const adapter = createProductionAdapter('google')
    expect(adapter).toBeInstanceOf(UnavailableCalendarAdapter)
    expect(adapter.available()).toBe(false)
    expect(isCalendarConnectorWired('google')).toBe(false)
  })

  it('stays unavailable with the gate but without credentials', () => {
    process.env[GOOGLE_CALENDAR_LIVE_ENV] = '1'
    registerGoogleCalendarTokenAccessor(accessor({ hasCredentials: () => false }))

    const adapter = createProductionAdapter('google')
    expect(adapter).toBeInstanceOf(UnavailableCalendarAdapter)
    expect(isCalendarConnectorWired('google')).toBe(false)
  })

  it('stays unavailable with the gate but no registered accessor', () => {
    process.env[GOOGLE_CALENDAR_LIVE_ENV] = '1'
    registerGoogleCalendarTokenAccessor(null)

    const adapter = createProductionAdapter('google')
    expect(adapter).toBeInstanceOf(UnavailableCalendarAdapter)
    expect(isCalendarConnectorWired('google')).toBe(false)
  })

  it('returns the live adapter only with the gate and stored credentials', () => {
    process.env[GOOGLE_CALENDAR_LIVE_ENV] = '1'
    registerGoogleCalendarTokenAccessor(accessor())

    const adapter = createProductionAdapter('google')
    expect(adapter).toBeInstanceOf(GoogleCalendarAdapter)
    expect(adapter.mode).toBe('live')
    expect(adapter.available()).toBe(true)
    expect(isCalendarConnectorWired('google')).toBe(true)
  })

  it('never returns a live adapter for other providers', () => {
    process.env[GOOGLE_CALENDAR_LIVE_ENV] = '1'
    registerGoogleCalendarTokenAccessor(accessor())

    for (const provider of ['outlook', 'yandex', 'mailru', 'appleReminders'] as const) {
      expect(createProductionAdapter(provider)).toBeInstanceOf(UnavailableCalendarAdapter)
      expect(isCalendarConnectorWired(provider)).toBe(false)
    }
  })
})