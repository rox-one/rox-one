/**
 * Calendar-driven meeting auto-recording.
 *
 * A renderer-side tick (5–10 s) reads the persisted local CalendarStore and,
 * five seconds before an event starts, begins a meeting recording once per
 * occurrence. Recording never starts twice for the same occurrence, never
 * starts a second parallel recording, and stops N minutes after the event
 * ends. Only the renderer calendar (`rox.calendar.v1`) is consulted — no
 * remote calendar, no uploads.
 */
import { useEffect } from 'react'
import i18n from 'i18next'
import { toast } from 'sonner'
import { CalendarStore, calendarEventIdentity, type CalendarEvent } from '@rox/core/calendar'
import { navigate, routes } from '@/lib/navigate'
import { isRecorderBusy, startRecording, stopRecording, subscribeRecorder } from './recorder'

/** Persisted local calendar bundle written by CalendarStatusStrip. */
const CALENDAR_KEY = 'rox.calendar.v1'
/** Autostart preference; absent means enabled. */
const PREF_KEY = 'rox.meetings.autostartEnabled.v1'
/** Occurrences already triggered this device, so reloads never double-start. */
const STARTED_KEY = 'rox.meetings.autostartStarted.v1'

/** 5–10 s window; chosen so the 5 s lead is never missed. */
const AUTOSTART_TICK_MS = 7_000
/** Start this long before the event's startAt. */
const START_LEAD_MS = 5_000
/** Keep recording this long past endAt before stopping. */
const STOP_AFTER_END_MS = 5 * 60_000
/** Forget "already started" markers after this long. */
const STARTED_TTL_MS = 24 * 60 * 60_000

export function isMeetingsAutostartEnabled(): boolean {
  try {
    const raw = localStorage.getItem(PREF_KEY)
    return raw === null ? true : raw !== 'false'
  } catch {
    return true
  }
}

export function setMeetingsAutostartEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, enabled ? 'true' : 'false')
  } catch {
    // storage unavailable — keep the in-memory default
  }
}

/**
 * Stable key for one occurrence: the provider instance id when present,
 * otherwise the account/calendar/event identity plus the start time.
 */
export function calendarOccurrenceKey(event: CalendarEvent): string {
  return event.occurrenceId ?? `${calendarEventIdentity(event)}@${event.startAt}`
}

/** The single event that should start now, or null. Pure and testable. */
export function nextDueCalendarEvent(
  events: readonly CalendarEvent[],
  now: number,
  started: ReadonlySet<string> = new Set(),
): CalendarEvent | null {
  for (const event of events) {
    if (event.deleted || event.allDay) continue
    if (typeof event.startAt !== 'number' || typeof event.endAt !== 'number') continue
    if (now < event.startAt - START_LEAD_MS) continue
    if (now > event.endAt) continue
    if (started.has(calendarOccurrenceKey(event))) continue
    return event
  }
  return null
}

function readCalendarEvents(): CalendarEvent[] {
  try {
    const raw = localStorage.getItem(CALENDAR_KEY)
    if (!raw) return []
    return CalendarStore.fromJson(raw).events()
  } catch {
    return []
  }
}

function loadStartedKeys(now: number): Map<string, number> {
  const fresh = new Map<string, number>()
  try {
    const raw = localStorage.getItem(STARTED_KEY)
    if (!raw) return fresh
    const parsed = JSON.parse(raw) as Record<string, number>
    for (const [key, at] of Object.entries(parsed)) {
      if (typeof at === 'number' && now - at < STARTED_TTL_MS) fresh.set(key, at)
    }
  } catch {
    return fresh
  }
  return fresh
}

function markStarted(key: string, now: number): void {
  const started = loadStartedKeys(now)
  started.set(key, now)
  try {
    localStorage.setItem(STARTED_KEY, JSON.stringify(Object.fromEntries(started)))
  } catch {
    // storage unavailable — the occurrence guard is best-effort this session
  }
}

/** endAt of the occurrence this renderer auto-started and still owns, or null. */
let activeOccurrenceEndAt: number | null = null
let inflight = false

// The user may stop or the recorder may end on its own; drop our claim then.
if (typeof window !== 'undefined') {
  subscribeRecorder(() => {
    if (activeOccurrenceEndAt !== null && !isRecorderBusy()) activeOccurrenceEndAt = null
  })
}

function showAutostartToast(event: CalendarEvent, meetingId: string | null): void {
  toast(i18n.t('meetings.autostart.started'), {
    description: event.title,
    duration: 30_000,
    action: {
      label: i18n.t('meetings.autostart.open'),
      onClick: () => navigate(routes.view.meetings(meetingId ?? undefined)),
    },
    cancel: {
      label: i18n.t('meetings.autostart.stop'),
      onClick: () => { void stopRecording() },
    },
  })
}

/** One scheduler pass. Exported for tests; safe to call at any time. */
export async function runCalendarAutostartTick(now = Date.now()): Promise<void> {
  if (!isMeetingsAutostartEnabled()) return

  // Stop the autostarted recording once the event is over by more than N min.
  if (activeOccurrenceEndAt !== null && isRecorderBusy() && now > activeOccurrenceEndAt + STOP_AFTER_END_MS) {
    activeOccurrenceEndAt = null
    await stopRecording().catch(() => {})
    return
  }

  if (inflight || isRecorderBusy()) return
  const started = loadStartedKeys(now)
  const due = nextDueCalendarEvent(readCalendarEvents(), now, new Set(started.keys()))
  if (!due) return

  // Mark before awaiting so overlapping ticks cannot start the same occurrence.
  markStarted(calendarOccurrenceKey(due), now)
  inflight = true
  try {
    const result = await startRecording({
      title: due.title,
      workspaceId: null,
      source: 'calendar',
      calendarEventId: due.occurrenceId ?? calendarEventIdentity(due),
    })
    if (result.ok) {
      activeOccurrenceEndAt = due.endAt
      showAutostartToast(due, result.meeting.id)
    }
  } finally {
    inflight = false
  }
}

/** App-wide tick host; mount once (extra-screens background). */
export function useCalendarMeetingAutostart(): void {
  useEffect(() => {
    const run = () => { void runCalendarAutostartTick().catch(() => {}) }
    run()
    const timer = window.setInterval(run, AUTOSTART_TICK_MS)
    return () => window.clearInterval(timer)
  }, [])
}