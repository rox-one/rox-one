import { appleRemindersAvailable, capabilityFor } from './capabilities.ts'
import type { CalendarEvent, CalendarProvider, CapabilityGap } from './types.ts'

export interface CalendarListPage {
  events: CalendarEvent[]
  cursor?: string
}

export interface CalendarAdapter {
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

/** Test-only adapter. Production factories must not return this class. */
export class FixtureCalendarAdapter implements CalendarAdapter {
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

export function createFixtureAdapter(
  provider: CalendarProvider,
  seeds: FixtureEventSeed[] = [],
  available = true,
): FixtureCalendarAdapter {
  return new FixtureCalendarAdapter(provider, seeds, available)
}

/**
 * Honest production adapter: credentials/env are not live evidence.
 * listEvents never invents events.
 */
export class UnavailableCalendarAdapter implements CalendarAdapter {
  readonly capabilities: CapabilityGap
  constructor(readonly provider: CalendarProvider) {
    this.capabilities = capabilityFor(provider)
  }

  available(): boolean {
    return false
  }

  async listEvents(_accountId: string, _cursor?: string): Promise<CalendarListPage> {
    throw new Error(`Calendar provider ${this.provider} is not connected`)
  }
}

const LIVE_ENV: Record<Exclude<CalendarProvider, 'appleReminders'>, string> = {
  google: 'ROX_CALENDAR_GOOGLE_LIVE',
  outlook: 'ROX_CALENDAR_OUTLOOK_LIVE',
  yandex: 'ROX_CALENDAR_YANDEX_LIVE',
  mailru: 'ROX_CALENDAR_MAILRU_LIVE',
}

export function liveCredentialsPresent(provider: CalendarProvider): boolean {
  if (provider === 'appleReminders') {
    return appleRemindersAvailable(process.platform, Boolean(process.env.ROX_APPLE_REMINDERS_HELPER))
  }
  return Boolean(process.env[LIVE_ENV[provider]])
}

/**
 * Production factory. Never returns FixtureCalendarAdapter, even when live
 * env vars are set. Env alone is not a verified account.
 */
export function createProviderAdapter(provider: CalendarProvider): CalendarAdapter {
  return new UnavailableCalendarAdapter(provider)
}
