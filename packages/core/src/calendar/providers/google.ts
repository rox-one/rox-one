/**
 * Google Calendar provider adapter (Calendar API v3 REST).
 *
 * Implements the existing `CalendarAdapter` seam for provider `google` using
 * `GET /calendar/v3/calendars/{calendarId}/events` with `singleEvents=true`.
 * The adapter owns only read normalization; token acquisition/refresh is
 * injected as a callback so the credential store stays outside `@rox/core`.
 */

import { capabilityFor } from '../capabilities.ts'
import { CalendarProviderUnavailableError, type CalendarAdapter, type CalendarListPage } from '../adapters.ts'
import type { CalendarEvent, CalendarProvider, CapabilityGap } from '../types.ts'

export const GOOGLE_CALENDAR_REST_API_BASE = 'https://www.googleapis.com/calendar/v3'

const MS_DAY = 24 * 60 * 60 * 1000

/** Sync window used by `calendar:googleSync`: [-30d, +90d] around "now". */
export const GOOGLE_CALENDAR_SYNC_WINDOW = {
  pastMs: 30 * MS_DAY,
  futureMs: 90 * MS_DAY,
} as const

export function googleCalendarSyncWindow(now = Date.now()): { timeMin: number; timeMax: number } {
  return { timeMin: now - GOOGLE_CALENDAR_SYNC_WINDOW.pastMs, timeMax: now + GOOGLE_CALENDAR_SYNC_WINDOW.futureMs }
}

/**
 * Raised when Google rejects the access token or the refresh callback fails.
 * Distinct from `CalendarProviderUnavailableError` (no connection at all):
 * the caller must re-run the OAuth connect flow.
 */
export class CalendarAuthExpiredError extends Error {
  readonly code = 'CALENDAR_AUTH_EXPIRED' as const
  readonly provider: CalendarProvider
  constructor(provider: CalendarProvider = 'google', message = 'Google Calendar authorization expired') {
    super(message)
    this.name = 'CalendarAuthExpiredError'
    this.provider = provider
  }
}

/** A raw Google Calendar API v3 event resource (subset we read). */
export interface GoogleCalendarEventResource {
  id?: string
  etag?: string
  status?: string
  summary?: string
  updated?: string
  recurringEventId?: string
  recurrence?: string[]
  start?: { date?: string; dateTime?: string; timeZone?: string }
  end?: { date?: string; dateTime?: string; timeZone?: string }
}

export interface GoogleCalendarPageResponse {
  items?: GoogleCalendarEventResource[]
  nextPageToken?: string
  nextSyncToken?: string
}

export interface GoogleCalendarEventMapContext {
  accountId: string
  calendarId: string
  /** Calendar default zone, used when the resource omits `timeZone`. */
  defaultTimeZone: string
}

// Google all-day dates are civil dates without a zone. Anchor at UTC midnight
// so the value is deterministic across machines; `allDay` carries the intent.
const parseGoogleDate = (date: string): number => {
  const parsed = Date.parse(date.length === 10 ? `${date}T00:00:00Z` : date)
  if (!Number.isFinite(parsed)) throw new Error(`Invalid Google date: ${date}`)
  return parsed
}

/**
 * Normalize one Google event resource into the repo `CalendarEvent` shape.
 * Cancelled resources become tombstones (`deleted: true`) so the store's
 * existing conflict machinery can record delete conflicts.
 */
export function mapGoogleCalendarEvent(
  raw: GoogleCalendarEventResource,
  context: GoogleCalendarEventMapContext,
): CalendarEvent | null {
  if (!raw.id) return null
  const start = raw.start ?? {}
  const end = raw.end ?? {}
  const allDay = Boolean(start.date) && !start.dateTime

  const startAt = start.dateTime ? parseGoogleDate(start.dateTime) : start.date ? parseGoogleDate(start.date) : null
  if (startAt === null) return null

  let endAt = end.dateTime ? parseGoogleDate(end.dateTime) : end.date ? parseGoogleDate(end.date) : null
  if (endAt === null || endAt <= startAt) endAt = startAt + (allDay ? MS_DAY : 0)

  const timeZone = start.timeZone ?? context.defaultTimeZone
  return {
    id: raw.id,
    accountId: context.accountId,
    calendarId: context.calendarId,
    title: raw.summary?.trim() || '(без названия)',
    startAt,
    endAt,
    allDay,
    timeZone,
    recurrence: raw.recurrence?.[0],
    occurrenceId: raw.recurringEventId ? raw.id : undefined,
    deleted: raw.status === 'cancelled',
    etag: raw.etag,
    kind: 'event',
  }
}

/** Async access-token source. Throws `CalendarAuthExpiredError` when refresh fails. */
export type GoogleCalendarAccessToken = () => Promise<string>

export interface GoogleCalendarRestAdapterOptions {
  /** Returns a currently valid access token; refreshes when needed. */
  accessToken: GoogleCalendarAccessToken
  /** Injectable fetch for tests. Defaults to the global fetch. */
  fetchImpl?: typeof fetch
  calendarId?: string
  /** Calendar default zone used when events omit `timeZone`. */
  timeZone?: string
  timeMin?: number
  timeMax?: number
  maxResults?: number
  apiBase?: string
}

interface GoogleErrorBody {
  error?: { code?: number; message?: string; status?: string }
}

/**
 * Live Google Calendar adapter. Read-only (`listEvents`); never returns fixture data.
 * `available()` is honest about token presence — constructs as available only when
 * a token source was supplied.
 */
export class GoogleCalendarRestAdapter implements CalendarAdapter {
  readonly mode = 'live' as const
  readonly provider: CalendarProvider = 'google'
  readonly capabilities: CapabilityGap
  private readonly calendarId: string
  private readonly timeZone: string
  private readonly apiBase: string
  private readonly fetchImpl: typeof fetch

  constructor(private readonly options: GoogleCalendarRestAdapterOptions) {
    this.capabilities = capabilityFor('google')
    this.calendarId = options.calendarId ?? 'primary'
    this.timeZone = options.timeZone ?? 'UTC'
    this.apiBase = options.apiBase ?? GOOGLE_CALENDAR_REST_API_BASE
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
  }

  available(): boolean {
    return typeof this.options.accessToken === 'function'
  }

  async listEvents(accountId: string): Promise<CalendarListPage> {
    const token = await this.resolveToken()
    const defaults = googleCalendarSyncWindow()
    const timeMin = this.options.timeMin ?? defaults.timeMin
    const timeMax = this.options.timeMax ?? defaults.timeMax
    const events: CalendarEvent[] = []
    let pageToken: string | undefined
    let syncToken: string | undefined
    let guard = 0

    do {
      const url = new URL(
        `${this.apiBase}/calendars/${encodeURIComponent(this.calendarId)}/events`,
      )
      url.searchParams.set('timeMin', new Date(timeMin).toISOString())
      url.searchParams.set('timeMax', new Date(timeMax).toISOString())
      url.searchParams.set('singleEvents', 'true')
      url.searchParams.set('orderBy', 'startTime')
      url.searchParams.set('maxResults', String(this.options.maxResults ?? 250))
      if (pageToken) url.searchParams.set('pageToken', pageToken)

      const response = await this.fetchImpl(url.toString(), {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      })

      if (response.status === 401 || response.status === 403) {
        throw new CalendarAuthExpiredError('google', 'Google Calendar rejected the access token')
      }
      if (!response.ok) {
        const body = await response.json().catch(() => null) as GoogleErrorBody | null
        throw new Error(
          `Google Calendar listEvents failed (${response.status}): ${body?.error?.message ?? response.statusText}`,
        )
      }

      const body = (await response.json()) as GoogleCalendarPageResponse
      for (const raw of body.items ?? []) {
        const mapped = mapGoogleCalendarEvent(raw, {
          accountId,
          calendarId: this.calendarId,
          defaultTimeZone: this.timeZone,
        })
        if (mapped) events.push(mapped)
      }
      pageToken = body.nextPageToken
      if (body.nextSyncToken) syncToken = body.nextSyncToken
      guard += 1
    } while (pageToken && guard < 50)

    const cursor = syncToken ?? `google:${timeMin}-${timeMax}`
    return { events, cursor }
  }

  private async resolveToken(): Promise<string> {
    let token: string | null
    try {
      token = await this.options.accessToken()
    } catch (error) {
      if (error instanceof CalendarAuthExpiredError) throw error
      throw new CalendarAuthExpiredError(
        'google',
        error instanceof Error ? error.message : 'Google Calendar token refresh failed',
      )
    }
    if (!token) {
      throw new CalendarProviderUnavailableError('google')
    }
    return token
  }
}