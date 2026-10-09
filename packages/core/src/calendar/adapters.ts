import { appleCalendarAvailable, appleRemindersAvailable, capabilityFor } from './capabilities.ts'
import {
  AppleCalendarAdapter,
  appleCalendarLiveEnabled,
  getAppleCalendarHelper,
} from './apple-calendar-adapter.ts'
import { getGoogleCalendarTokenAccessor, googleCalendarLiveEnabled, GoogleCalendarAdapter } from './google-calendar-adapter.ts'
import type { CalendarEvent, CalendarProvider, CapabilityGap } from './types.ts'

export interface CalendarListPage {
  events: CalendarEvent[]
  cursor?: string
}

export interface CalendarAdapter {
  readonly mode: 'fixture' | 'unavailable' | 'live'
  provider: CalendarProvider
  capabilities: CapabilityGap
  available(): boolean
  listEvents(accountId: string, cursor?: string): Promise<CalendarListPage>
}

export interface FixtureEventSeed {
  id: string
  title: string
  startAt: number
  endAt: number
  allDay?: boolean
  timeZone?: string
  calendarId?: string
  recurrence?: string
  deleted?: boolean
  etag?: string
}

export class CalendarProviderUnavailableError extends Error {
  readonly code = 'CALENDAR_PROVIDER_UNAVAILABLE' as const
  readonly provider: CalendarProvider
  constructor(provider: CalendarProvider) {
    super(`Calendar provider "${provider}" is not connected`)
    this.name = 'CalendarProviderUnavailableError'
    this.provider = provider
  }
}

export class FixtureCalendarAdapter implements CalendarAdapter {
  readonly mode = 'fixture' as const
  readonly capabilities: CapabilityGap
  constructor(
    readonly provider: CalendarProvider,
    private readonly seeds: FixtureEventSeed[] = [],
    private readonly availableFlag = true,
  ) {
    this.capabilities = capabilityFor(provider)
  }

  available(): boolean {
    return this.availableFlag
  }

  async listEvents(accountId: string, _cursor?: string): Promise<CalendarListPage> {
    const events: CalendarEvent[] = this.seeds.map((seed) => ({
      id: seed.id,
      accountId,
      calendarId: seed.calendarId ?? 'primary',
      title: seed.title,
      startAt: seed.startAt,
      endAt: seed.endAt,
      allDay: seed.allDay ?? false,
      timeZone: seed.timeZone ?? 'UTC',
      recurrence: seed.recurrence,
      deleted: seed.deleted ?? false,
      etag: seed.etag ?? `etag-${seed.id}`,
      kind: 'event',
    }))
    return { events, cursor: `sync-${events.map((event) => event.etag).join('|')}` }
  }
}

/** Honest production stand-in until a verified provider adapter exists. Never lists fixture events. */
export class UnavailableCalendarAdapter implements CalendarAdapter {
  readonly mode = 'unavailable' as const
  readonly capabilities: CapabilityGap
  constructor(
    readonly provider: CalendarProvider,
    /** Ignored. listEvents always throws, so this adapter is never available. */
    _availableFlag = false,
  ) {
    this.capabilities = capabilityFor(provider)
  }

  available(): boolean {
    return false
  }

  async listEvents(_accountId: string, _cursor?: string): Promise<CalendarListPage> {
    throw new CalendarProviderUnavailableError(this.provider)
  }
}

export function isFixtureCalendarAdapter(adapter: CalendarAdapter): boolean {
  return adapter.mode === 'fixture'
}

/** Test-only. Never call from production connect/sync factories. */
export function createFixtureAdapter(provider: CalendarProvider, seeds: FixtureEventSeed[] = []): FixtureCalendarAdapter {
  if (provider === 'appleReminders') {
    const helper = Boolean(process.env.ROX_APPLE_REMINDERS_HELPER)
    return new FixtureCalendarAdapter(provider, seeds, appleRemindersAvailable(process.platform, helper))
  }
  return new FixtureCalendarAdapter(provider, seeds, true)
}

/**
 * Production factory. Never returns a fixture adapter.
 *
 * Google is the only remote provider with a verified adapter, and it is fail-closed: it is
 * returned only when the GOOGLE_CALENDAR_LIVE=1 gate is set AND the host-registered
 * OAuth token accessor reports stored credentials. Every other case stays Unavailable.
 *
 * Apple Calendar is equally fail-closed: it is returned only when APPLE_CALENDAR_LIVE=1
 * is set AND a registered helper binding reports the macOS EventKit binary is present.
 */
export function createProductionAdapter(provider: CalendarProvider): CalendarAdapter {
  if (provider === 'google' && googleCalendarLiveEnabled()) {
    const accessor = getGoogleCalendarTokenAccessor()
    if (accessor?.hasCredentials()) {
      return new GoogleCalendarAdapter({ credentials: accessor })
    }
  }
  if (provider === 'appleCalendar' && appleCalendarLiveEnabled()) {
    const helper = getAppleCalendarHelper()
    if (helper && helper.hasHelper()) {
      return new AppleCalendarAdapter({
        runHelper: (args) => helper.run(args),
        helperPresent: () => helper.hasHelper(),
      })
    }
  }
  return new UnavailableCalendarAdapter(provider)
}

/** Production alias. Does not accept fixture seeds. */
export function createProviderAdapter(provider: CalendarProvider): CalendarAdapter {
  return createProductionAdapter(provider)
}

const LIVE_ENV: Record<Exclude<CalendarProvider, 'appleReminders' | 'appleCalendar'>, string> = {
  google: 'ROX_CALENDAR_GOOGLE_LIVE',
  outlook: 'ROX_CALENDAR_OUTLOOK_LIVE',
  yandex: 'ROX_CALENDAR_YANDEX_LIVE',
  mailru: 'ROX_CALENDAR_MAILRU_LIVE',
}

export function liveCredentialsPresent(provider: CalendarProvider): boolean {
  if (provider === 'appleReminders') {
    return appleRemindersAvailable(process.platform, Boolean(process.env.ROX_APPLE_REMINDERS_HELPER))
  }
  if (provider === 'appleCalendar') {
    return appleCalendarAvailable(process.platform, getAppleCalendarHelper()?.hasHelper() ?? false)
  }
  return Boolean(process.env[LIVE_ENV[provider]])
}

/** Optional connectors are wired only with a verified production adapter. Helper/env is not connected. */
export function isCalendarConnectorWired(provider: CalendarProvider): boolean {
  const adapter = createProductionAdapter(provider)
  return adapter.available() && adapter.mode !== 'fixture'
}

// Live Google Calendar adapter surface, exposed here so `@rox/core/calendar` consumers
// (host credential wiring, tests) reach it without a deep import.
export {
  GOOGLE_CALENDAR_LIVE_ENV,
  GoogleCalendarAdapter,
  GoogleCalendarAuthExpiredError,
  GoogleCalendarHttpError,
  GoogleCalendarUnavailableError,
  getGoogleCalendarTokenAccessor,
  googleCalendarLiveEnabled,
  registerGoogleCalendarTokenAccessor,
} from './google-calendar-adapter.ts'
export type {
  CalendarRange,
  GoogleCalendarAdapterOptions,
  GoogleCalendarCredentials,
  GoogleCalendarFetch,
  GoogleCalendarTokenAccessor,
} from './google-calendar-adapter.ts'

// Live Apple Calendar (EventKit) adapter surface, exposed here so `@rox/core/calendar`
// consumers (host helper wiring, tests) reach it without a deep import.
export {
  APPLE_CALENDAR_LIVE_ENV,
  AppleCalendarAdapter,
  AppleCalendarAuthDeniedError,
  AppleCalendarHelperError,
  AppleCalendarUnavailableError,
  appleCalendarLiveEnabled,
  getAppleCalendarHelper,
  registerAppleCalendarHelper,
} from './apple-calendar-adapter.ts'
export type {
  AppleCalendarAdapterOptions,
  AppleCalendarAuthStatus,
  AppleCalendarHelperBinding,
  AppleCalendarHelperEvent,
  AppleCalendarHelperResult,
  AppleCalendarRange,
  AppleCalendarRunHelper,
} from './apple-calendar-adapter.ts'
