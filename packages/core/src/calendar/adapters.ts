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

export function createProviderAdapter(provider: CalendarProvider, seeds: FixtureEventSeed[] = []): CalendarAdapter {
  if (provider === 'appleReminders') {
    const helper = Boolean(process.env.ROX_APPLE_REMINDERS_HELPER)
    return new FixtureCalendarAdapter(provider, seeds, appleRemindersAvailable(process.platform, helper))
  }
  return new FixtureCalendarAdapter(provider, seeds, true)
}

const LIVE_ENV: Record<Exclude<CalendarProvider, 'appleReminders'>, string> = {
  google: 'ROX_CALENDAR_GOOGLE_LIVE',
  outlook: 'ROX_CALENDAR_OUTLOOK_LIVE',
  yandex: 'ROX_CALENDAR_YANDEX_LIVE',
  mailru: 'ROX_CALENDAR_MAILRU_LIVE',
}

export function liveCredentialsPresent(provider: CalendarProvider): boolean {
  if (provider === 'appleReminders') return appleRemindersAvailable(process.platform, Boolean(process.env.ROX_APPLE_REMINDERS_HELPER))
  return Boolean(process.env[LIVE_ENV[provider]])
}

/** Optional connectors are wired only when live credentials / helper exist. Never pretend. */
export function isCalendarConnectorWired(provider: CalendarProvider): boolean {
  return liveCredentialsPresent(provider)
}
