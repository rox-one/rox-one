/**
 * Календарь surface page (W3.2, Согласованность-20261009).
 *
 * Встречи (recording, transcript, scheduling) are the calendar surface's
 * content after the merge; `MeetingsPage` already renders the three-panel
 * mode screen, so the page is a thin adapter that maps the legacy
 * `meetings/meeting/{id}` deep link onto its `selectedId`. Without a meeting
 * id the page owns its selection locally (the mode-screen behavior).
 */
import type { SurfacePageProps } from '@/platform/SurfaceHost'
import MeetingsPage from './MeetingsPage'

export function CalendarSurfacePage({ meetingId }: SurfacePageProps) {
  return <MeetingsPage selectedId={meetingId} />
}

export default CalendarSurfacePage