import type { CalendarProvider, CapabilityGap } from './types.ts'

export const CALENDAR_CAPABILITIES: Record<CalendarProvider, CapabilityGap> = {
  google: {
    provider: 'google',
    supportsOAuth: true,
    supportsReminders: false,
    supportsAllDay: true,
    supportsRecurrence: true,
    notes: 'Google Calendar events only. Google Tasks and pop-up reminders are out of scope for this adapter.',
  },
  outlook: {
    provider: 'outlook',
    supportsOAuth: true,
    supportsReminders: false,
    supportsAllDay: true,
    supportsRecurrence: true,
    notes: 'Microsoft Graph calendars. Outlook/To Do reminders are a separate connector and are not auto-imported as tasks.',
  },
  yandex: {
    provider: 'yandex',
    supportsOAuth: true,
    supportsReminders: false,
    supportsAllDay: true,
    supportsRecurrence: false,
    notes: 'Yandex Calendar CalDAV/OAuth. Complex recurrence and shared-inbox ACLs are not mirrored.',
  },
  mailru: {
    provider: 'mailru',
    supportsOAuth: true,
    supportsReminders: false,
    supportsAllDay: true,
    supportsRecurrence: false,
    notes: 'Mail.ru calendar via polling only. No push channel; deletions may lag until the next incremental cursor.',
  },
  appleReminders: {
    provider: 'appleReminders',
    supportsOAuth: false,
    supportsReminders: true,
    supportsAllDay: true,
    supportsRecurrence: true,
    notes: 'Privileged macOS EventKit helper only (darwin). No OAuth; unavailable on other platforms.',
  },
}

export function capabilityFor(provider: CalendarProvider): CapabilityGap {
  return CALENDAR_CAPABILITIES[provider]
}

export function appleRemindersAvailable(platform = process.platform, helperPresent = false): boolean {
  return platform === 'darwin' && helperPresent
}
