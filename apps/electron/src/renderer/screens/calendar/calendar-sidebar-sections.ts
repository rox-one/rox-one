import type { SidebarSection, SidebarSectionItem } from '../sidebar-section'
import { nonEmptySections } from '../sidebar-section'

export type MeetingBucketId = 'all' | 'today' | 'upcoming' | 'past' | 'live' | 'needsAction'
/** «Записи встреч» filters; «Сегодня» lists today's meetings directly. */
export const RECORDING_BUCKETS: readonly MeetingBucketId[] = ['all', 'live', 'needsAction', 'upcoming', 'past']

export interface CalendarSidebarMeeting {
  id: string
  title: string
  /** startedAt ?? scheduledAt ?? createdAt */
  at: number
  live: boolean
}

export interface CalendarSidebarAccount {
  id: string
  provider: string
  displayName: string
  status: string
}

export interface CalendarSidebarInput {
  meetings: readonly CalendarSidebarMeeting[]
  counts: Readonly<Record<MeetingBucketId, number>>
  accounts: readonly CalendarSidebarAccount[]
  /** Account ids hidden from the views (toggle state). */
  hiddenAccounts?: ReadonlySet<string>
  now: number
  /** Formats a timestamp as a short local time (caller's locale). */
  formatTime(ts: number): string
}

function dayBounds(now: number): [number, number] {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  const start = d.getTime()
  d.setDate(d.getDate() + 1)
  return [start, d.getTime()]
}

/**
 * Календарь (with merged Встречи) second sidebar: Сегодня (today's meetings,
 * chronological, live first) → Записи встреч (bucket filters with counts) →
 * Мои календари (connected accounts as visibility toggles + a connect row).
 */
export function buildCalendarSidebarSections(input: CalendarSidebarInput): SidebarSection[] {
  const [start, end] = dayBounds(input.now)
  const today: SidebarSectionItem[] = input.meetings
    .filter((m) => m.live || (m.at >= start && m.at < end))
    .sort((a, b) => Number(b.live) - Number(a.live) || a.at - b.at || a.id.localeCompare(b.id))
    .map((m) => ({
      id: `meeting:${m.id}`,
      ...(m.title.trim() ? { label: m.title.trim() } : { labelKey: 'screens.calendar.untitled' }),
      icon: m.live ? 'radio' : 'calendar-clock',
      secondary: input.formatTime(m.at),
      ...(m.live ? { badge: 'running' as const } : {}),
      target: { kind: 'view', viewId: `meeting:${m.id}` },
    }))
  const recordings: SidebarSectionItem[] = RECORDING_BUCKETS.map((b) => ({
    id: `bucket:${b}`,
    labelKey: b === 'needsAction' ? 'meetings.local.needsAction' : `meetings.screen.${b}`,
    icon: `bucket:${b}`,
    count: input.counts[b] || undefined,
    ...(b === 'needsAction' && input.counts.needsAction > 0 ? { badge: 'attention' as const } : {}),
    target: { kind: 'filter', filterId: b },
  }))
  const calendars: SidebarSectionItem[] = [
    ...input.accounts.map((a) => ({
      id: `account:${a.id}`,
      label: a.displayName || a.provider,
      icon: 'calendar',
      ...(input.hiddenAccounts?.has(a.id) ? { secondaryKey: 'screens.calendar.hidden' } : { secondary: a.provider }),
      ...(a.status !== 'connected' ? { badge: 'status' as const } : {}),
      target: { kind: 'source' as const, sourceId: a.id },
    })),
    { id: 'connect', labelKey: input.accounts.length ? 'screens.calendar.addCalendar' : 'meetings.screen.calendarsNone', icon: 'plug', target: { kind: 'source', sourceId: '' } },
  ]
  return nonEmptySections([
    { id: 'today', titleKey: 'screens.calendar.groups.today', items: today, limit: 6, collapsible: true },
    { id: 'recordings', titleKey: 'screens.calendar.groups.recordings', items: recordings, collapsible: true },
    { id: 'calendars', titleKey: 'screens.calendar.groups.calendars', items: calendars, limit: 6, collapsible: true },
  ])
}
