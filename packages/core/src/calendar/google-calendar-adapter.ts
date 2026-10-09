/**
 * Live Google Calendar adapter (Calendar API v3, events.list).
 *
 * Token storage and refresh live in @rox/shared (google-oauth.ts + the credential
 * store). @rox/core does not depend on @rox/shared, so the host injects the OAuth
 * token accessor through `registerGoogleCalendarTokenAccessor` and this module stays
 * free of provider credential storage.
 *
 * Fail-closed: the adapter is only constructed by `createProductionAdapter` when the
 * GOOGLE_CALENDAR_LIVE=1 gate is set AND the accessor reports stored credentials.
 * Otherwise the calendar seam keeps returning the honest Unavailable adapter.
 */

import type { CalendarAdapter, CalendarListPage } from './adapters.ts'
import { capabilityFor } from './capabilities.ts'
import type { CalendarEvent, CalendarProvider } from './types.ts'

/** Opt-in gate for the live Google Calendar adapter. Absent = always unavailable. */
export const GOOGLE_CALENDAR_LIVE_ENV = 'GOOGLE_CALENDAR_LIVE'
export const GOOGLE_CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3'
/** Google Calendar events.list maximum page size. */
export const GOOGLE_CALENDAR_PAGE_SIZE = 250
/** Hard bound on pageToken follow-up requests per listEvents call. */
export const GOOGLE_CALENDAR_MAX_PAGES = 10

export function googleCalendarLiveEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[GOOGLE_CALENDAR_LIVE_ENV] === '1'
}

/** Stored OAuth credential set for one Google account. Never logged or serialized by this module. */
export interface GoogleCalendarCredentials {
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  /** OAuth client used for the token; required by the Google refresh endpoint. */
  clientId?: string
  clientSecret?: string
}

/**
 * Injected view of the existing OAuth credential store.
 *
 * `hasCredentials` must be synchronous so `CalendarAdapter.available()` stays synchronous.
 * `refreshCredentials` is expected to delegate to the existing Google token refresh path.
 */
export interface GoogleCalendarTokenAccessor {
  hasCredentials(accountId?: string): boolean
  loadCredentials(accountId?: string): Promise<GoogleCalendarCredentials | null>
  saveCredentials(credentials: GoogleCalendarCredentials, accountId?: string): Promise<void> | void
  refreshCredentials(credentials: GoogleCalendarCredentials, accountId?: string): Promise<GoogleCalendarCredentials>
}

let tokenAccessor: GoogleCalendarTokenAccessor | null = null

/** Wire (or clear) the host credential store. Passing null disables the live adapter. */
export function registerGoogleCalendarTokenAccessor(accessor: GoogleCalendarTokenAccessor | null): void {
  tokenAccessor = accessor
}

export function getGoogleCalendarTokenAccessor(): GoogleCalendarTokenAccessor | null {
  return tokenAccessor
}

export class GoogleCalendarUnavailableError extends Error {
  readonly code = 'GOOGLE_CALENDAR_UNAVAILABLE' as const
  constructor(message = 'Google Calendar is not connected') {
    super(message)
    this.name = 'GoogleCalendarUnavailableError'
  }
}

export class GoogleCalendarAuthExpiredError extends Error {
  readonly code = 'GOOGLE_CALENDAR_AUTH_EXPIRED' as const
  constructor(message = 'Google Calendar authorization expired and could not be refreshed') {
    super(message)
    this.name = 'GoogleCalendarAuthExpiredError'
  }
}

export class GoogleCalendarHttpError extends Error {
  readonly code = 'GOOGLE_CALENDAR_HTTP' as const
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'GoogleCalendarHttpError'
  }
}

/** Event listing window. Values are epoch ms, Date, or RFC3339 strings. */
export interface CalendarRange {
  timeMin: number | string | Date
  timeMax: number | string | Date
}

export type GoogleCalendarFetch = (input: string | URL, init?: RequestInit) => Promise<Response>

export interface GoogleCalendarAdapterOptions {
  credentials: GoogleCalendarTokenAccessor
  /** Override for tests / other runtimes. Defaults to global fetch. */
  fetchImpl?: GoogleCalendarFetch
  /** Calendar id to list. Defaults to the user's primary calendar. */
  calendarId?: string
  /** Fixed window; when omitted a rolling default around `now()` is used. */
  range?: CalendarRange
  maxPages?: number
  maxResults?: number
  now?: () => number
  /** Fallback IANA zone when the event carries none. Defaults to UTC. */
  defaultTimeZone?: string
}

interface GoogleEventDateTime {
  date?: string
  dateTime?: string
  timeZone?: string
}

interface GoogleEventResource {
  id?: string
  etag?: string
  status?: string
  summary?: string
  start?: GoogleEventDateTime
  end?: GoogleEventDateTime
  recurrence?: string[]
  recurringEventId?: string
  /** Google Meet join link for the event, when one exists. */
  hangoutLink?: string
  /** Conference data; the video entry point is the Meet URI when present. */
  conferenceData?: {
    entryPoints?: Array<{ entryPointType?: string; uri?: string }>
    video?: { uri?: string }
  }
}

interface GoogleEventsListResponse {
  items?: GoogleEventResource[]
  nextPageToken?: string
  nextSyncToken?: string
}

const DAY_MS = 86_400_000

function parseEventTime(value: GoogleEventDateTime | undefined, allDay: boolean): number {
  if (!value) return 0
  if (!allDay && value.dateTime) {
    const parsed = Date.parse(value.dateTime)
    return Number.isFinite(parsed) ? parsed : 0
  }
  if (value.date) {
    const parsed = Date.parse(`${value.date}T00:00:00.000Z`)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

/**
 * Live adapter over Google Calendar API v3 `events.list`.
 *
 * `listEvents(accountId, cursor)` uses the configured/default range; `cursor` is a
 * Google pageToken so a bounded run resumes on the next call. `listEventsInRange`
 * exposes an explicit window for callers that know the sync period.
 */
export class GoogleCalendarAdapter implements CalendarAdapter {
  readonly mode = 'live' as const
  readonly provider: CalendarProvider = 'google'
  readonly capabilities = capabilityFor('google')
  private readonly credentials: GoogleCalendarTokenAccessor
  private readonly fetchImpl: GoogleCalendarFetch
  private readonly calendarId: string
  private readonly configuredRange?: CalendarRange
  private readonly maxPages: number
  private readonly maxResults: number
  private readonly now: () => number
  private readonly defaultTimeZone: string

  constructor(options: GoogleCalendarAdapterOptions) {
    this.credentials = options.credentials
    this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init))
    this.calendarId = options.calendarId ?? 'primary'
    this.configuredRange = options.range
    this.maxPages = options.maxPages ?? GOOGLE_CALENDAR_MAX_PAGES
    this.maxResults = options.maxResults ?? GOOGLE_CALENDAR_PAGE_SIZE
    this.now = options.now ?? Date.now
    this.defaultTimeZone = options.defaultTimeZone ?? 'UTC'
  }

  available(): boolean {
    return this.credentials.hasCredentials()
  }

  async listEvents(accountId: string, cursor?: string): Promise<CalendarListPage> {
    return this.listEventsInRange(accountId, this.currentRange(), cursor)
  }

  async listEventsInRange(accountId: string, range: CalendarRange, cursor?: string): Promise<CalendarListPage> {
    if (!this.credentials.hasCredentials(accountId)) {
      throw new GoogleCalendarUnavailableError()
    }
    let credentials = await this.credentials.loadCredentials(accountId)
    if (!credentials?.accessToken) {
      throw new GoogleCalendarUnavailableError()
    }

    const events: CalendarEvent[] = []
    let pageToken = cursor
    let nextCursor: string | undefined
    let pages = 0

    for (;;) {
      const page = await this.requestPage(accountId, credentials, range, pageToken)
      credentials = page.credentials
      for (const item of page.body.items ?? []) {
        events.push(this.mapEvent(item, accountId))
      }
      pages += 1
      const followUp = page.body.nextPageToken
      if (!followUp) {
        nextCursor = page.body.nextSyncToken
        break
      }
      if (pages >= this.maxPages) {
        // Bounded: hand the caller the pageToken so the next sync resumes here.
        nextCursor = followUp
        break
      }
      pageToken = followUp
    }

    return { events, cursor: nextCursor }
  }

  private currentRange(): CalendarRange {
    if (this.configuredRange) return this.configuredRange
    const now = this.now()
    return { timeMin: now - 30 * DAY_MS, timeMax: now + 90 * DAY_MS }
  }

  private buildUrl(range: CalendarRange, pageToken?: string): string {
    const url = new URL(`${GOOGLE_CALENDAR_API_BASE}/calendars/${encodeURIComponent(this.calendarId)}/events`)
    url.searchParams.set('singleEvents', 'true')
    url.searchParams.set('orderBy', 'startTime')
    url.searchParams.set('maxResults', String(this.maxResults))
    url.searchParams.set('timeMin', typeof range.timeMin === 'string' ? range.timeMin : new Date(range.timeMin).toISOString())
    url.searchParams.set('timeMax', typeof range.timeMax === 'string' ? range.timeMax : new Date(range.timeMax).toISOString())
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    return url.toString()
  }

  /** One events.list page; refreshes once and retries on 401. */
  private async requestPage(
    accountId: string,
    credentials: GoogleCalendarCredentials,
    range: CalendarRange,
    pageToken?: string,
  ): Promise<{ body: GoogleEventsListResponse; credentials: GoogleCalendarCredentials }> {
    let current = credentials
    for (let attempt = 0; ; attempt += 1) {
      const response = await this.fetchImpl(this.buildUrl(range, pageToken), {
        method: 'GET',
        headers: { Authorization: `Bearer ${current.accessToken}`, Accept: 'application/json' },
      })
      if (response.status === 401) {
        if (attempt > 0) throw new GoogleCalendarAuthExpiredError()
        current = await this.refresh(accountId, current)
        continue
      }
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new GoogleCalendarHttpError(response.status, `Google Calendar request failed (${response.status})${detail ? `: ${detail}` : ''}`)
      }
      const body = (await response.json()) as GoogleEventsListResponse
      return { body, credentials: current }
    }
  }

  private async refresh(accountId: string, credentials: GoogleCalendarCredentials): Promise<GoogleCalendarCredentials> {
    try {
      const next = await this.credentials.refreshCredentials(credentials, accountId)
      if (!next?.accessToken) throw new Error('refresh returned no access token')
      await this.credentials.saveCredentials(next, accountId)
      return next
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new GoogleCalendarAuthExpiredError(`Google Calendar token refresh failed: ${detail}`)
    }
  }

  private mapEvent(item: GoogleEventResource, accountId: string): CalendarEvent {
    const allDay = Boolean(item.start?.date) && !item.start?.dateTime
    const recurrence = item.recurrence && item.recurrence.length > 0 ? item.recurrence.join('\n') : undefined
    const videoEntry = item.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === 'video')
    const meetUri = item.hangoutLink ?? videoEntry?.uri ?? item.conferenceData?.video?.uri ?? undefined
    return {
      id: item.id ?? '',
      accountId,
      calendarId: this.calendarId,
      title: item.summary ?? '',
      startAt: parseEventTime(item.start, allDay),
      endAt: parseEventTime(item.end, allDay),
      allDay,
      timeZone: item.start?.timeZone ?? item.end?.timeZone ?? this.defaultTimeZone,
      recurrence,
      occurrenceId: item.recurringEventId ? item.id : undefined,
      meetUri,
      deleted: item.status === 'cancelled',
      etag: item.etag,
      kind: 'event',
    }
  }
}