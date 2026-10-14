import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Archive, CalendarCheck2, CalendarClock, CalendarDays, CircleAlert, Inbox, Mic, Plug, Radio, RefreshCw, type LucideIcon } from 'lucide-react'
import { CalendarStore } from '@rox/core/calendar'
import { useScreenSidebar, type ScreenSidebarConfig, type SidebarGroup } from '@/components/shell/screen-sidebar'
import { toScreenSidebarGroups } from '../screen-sidebar-adapter'
import type { SidebarTarget } from '../sidebar-section'
import { buildCalendarSidebarSections, type CalendarSidebarAccount, type CalendarSidebarMeeting, type MeetingBucketId } from './calendar-sidebar-sections'

const ICONS: Record<string, LucideIcon> = {
  radio: Radio, 'calendar-clock': CalendarClock, calendar: CalendarDays, plug: Plug,
  'bucket:all': Inbox, 'bucket:live': Radio, 'bucket:needsAction': CircleAlert, 'bucket:upcoming': CalendarCheck2, 'bucket:past': Archive,
}

/** Same localStorage store CalendarStatusStrip writes (`rox.calendar.v1`). */
const CALENDAR_STORE_KEY = 'rox.calendar.v1'
function readAccounts(): CalendarSidebarAccount[] {
  try {
    const raw = localStorage.getItem(CALENDAR_STORE_KEY)
    if (!raw) return []
    return CalendarStore.fromJson(raw).accounts().map((a) => ({ id: a.id, provider: a.provider, displayName: a.displayName, status: a.status }))
  } catch {
    return []
  }
}

/** Connected calendar accounts; re-read on focus and cross-window storage writes. */
function useCalendarAccounts(): CalendarSidebarAccount[] {
  const [accounts, setAccounts] = useState(readAccounts)
  useEffect(() => {
    const refresh = () => setAccounts((prev) => {
      const next = readAccounts()
      return JSON.stringify(next) === JSON.stringify(prev) ? prev : next
    })
    const onStorage = (e: StorageEvent) => { if (e.key === CALENDAR_STORE_KEY) refresh() }
    window.addEventListener('focus', refresh)
    window.addEventListener('storage', onStorage)
    return () => { window.removeEventListener('focus', refresh); window.removeEventListener('storage', onStorage) }
  }, [])
  return accounts
}

export interface CalendarScreenSidebarInput {
  screenId: 'calendar' | 'meetings'
  meetings: readonly CalendarSidebarMeeting[]
  counts: Readonly<Record<MeetingBucketId, number>>
  now: number
  bucket: MeetingBucketId
  selectedMeetingId: string | null
  onBucket(bucket: MeetingBucketId): void
  onMeeting(id: string): void
  onConnectCalendar(): void
  onRecord: (() => void) | null
  recording: boolean
  onRetry(): void
  loadState: 'loading' | 'ready' | 'error'
}

/** Publishes the Календарь second sidebar from MeetingsPage state. */
export function useCalendarScreenSidebar(input: CalendarScreenSidebarInput): void {
  const { t, i18n } = useTranslation()
  const accounts = useCalendarAccounts()
  const latest = useRef(input)
  latest.current = input
  const { screenId, meetings, counts, now, bucket, selectedMeetingId, recording, loadState } = input
  const canRecord = input.onRecord !== null
  // Minute resolution is enough for "today" and keeps the memo stable between ticks.
  const minute = Math.floor(now / 60_000)
  const timeFmt = useMemo(() => new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' }), [i18n.language])
  const sections = useMemo(
    () => buildCalendarSidebarSections({ meetings, counts, accounts, now: minute * 60_000, formatTime: (ts) => timeFmt.format(ts) }),
    [meetings, counts, accounts, minute, timeFmt],
  )
  const onTarget = useCallback((target: SidebarTarget) => {
    const cb = latest.current
    if (target.kind === 'filter') cb.onBucket(target.filterId as MeetingBucketId)
    else if (target.kind === 'view' && target.viewId.startsWith('meeting:')) cb.onMeeting(target.viewId.slice('meeting:'.length))
    else if (target.kind === 'source') cb.onConnectCalendar()
  }, [])
  const onRetry = useCallback(() => latest.current.onRetry(), [])
  const onRecord = useCallback(() => latest.current.onRecord?.(), [])
  const activeKey = selectedMeetingId ? `view:meeting:${selectedMeetingId}` : `filter:${bucket}`

  const config = useMemo<ScreenSidebarConfig>(() => {
    let groups: SidebarGroup[] = toScreenSidebarGroups(sections, { t, icons: ICONS, onTarget, activeKey })
    if (loadState === 'loading' && meetings.length === 0) groups = [{ id: 'today', title: t('screens.calendar.groups.today'), items: [], state: { kind: 'loading' } }, ...groups.filter((g) => g.id !== 'today')]
    if (loadState === 'error') groups = [{ id: 'today-error', title: t('screens.calendar.groups.today'), items: [], state: { kind: 'error', label: t('meetings.local.err.unavailable'), onRetry } }, ...groups.filter((g) => g.id !== 'today')]
    return {
      screenId,
      title: t('workbench.mode.calendar'),
      headerActions: [{ id: 'refresh', label: t('common.retry'), icon: RefreshCw, onSelect: onRetry }],
      ...(canRecord ? { primaryAction: { id: 'record', label: recording ? t('screens.calendar.recording') : t('meetings.screen.startRecording'), icon: Mic, disabled: recording, onSelect: onRecord } } : {}),
      groups,
    }
  }, [sections, t, onTarget, activeKey, loadState, meetings.length, onRetry, canRecord, recording, onRecord, screenId])

  useScreenSidebar(config)
}
