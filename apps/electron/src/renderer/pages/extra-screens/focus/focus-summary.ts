/**
 * Writes the «Итоги дня» section into today's daily note (upsert between
 * markers, the rest of the note is untouched). Used by the Focus screen
 * button and by the background end-of-day writer.
 */
import { listPersonalTasks } from '@/lib/extra-screens/personal-task-bridge'
import { normalizeMeetingList } from '@/lib/extra-screens/use-rox-sources'
import { focusMinutesOn, loadFocusState, localDay, saveFocusState } from '@/lib/focus-session'
import { buildDaySummary, completedToday, startOfDay, upsertSummarySection } from './focus-model'

export async function collectDaySummary(workspaceId: string, now: number, language: 'ru' | 'en', inboxLeft: number | null): Promise<{ text: string; hasActivity: boolean }> {
  const state = loadFocusState()
  const focus = focusMinutesOn(state, localDay(now), now)
  const done = completedToday(listPersonalTasks(), now).map((t) => t.title)
  let meetings: string[] = []
  try {
    const api = window.electronAPI
    if (typeof api?.listMeetings === 'function') {
      const dayStart = startOfDay(now)
      meetings = normalizeMeetingList(await api.listMeetings(workspaceId))
        .filter((m) => m.at != null && m.at >= dayStart && m.at < dayStart + 86400000)
        .map((m) => m.title)
    }
  } catch {
    meetings = []
  }
  const deferred = state.queue.filter((q) => localDay(q.at) === localDay(now)).reduce((sum, q) => sum + q.count, 0)
  const text = buildDaySummary({ now, focus, done, meetings, deferred, inboxLeft, language })
  return { text, hasActivity: focus.minutes > 0 || done.length > 0 || meetings.length > 0 }
}

export async function writeDaySummary(workspaceId: string, summary: string, now: number): Promise<{ noteId: string }> {
  const api = window.electronAPI
  const note = await api.getDailyNote(workspaceId)
  await api.saveNote(workspaceId, note.id, upsertSummarySection(note.content ?? '', summary))
  saveFocusState({ ...loadFocusState(), summaryWrittenFor: localDay(now) })
  return { noteId: note.id }
}
