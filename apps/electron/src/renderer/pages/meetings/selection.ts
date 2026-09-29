import type { MeetingListItem } from './start-rpc'

export interface MeetingSelectionApi {
  getMeeting(workspaceId: string, meetingId: string): Promise<unknown>
}

export function resolveMeetingSelectionApi(injected?: Partial<MeetingSelectionApi> | null): MeetingSelectionApi | null {
  if (injected?.getMeeting) return injected as MeetingSelectionApi
  if (typeof window === 'undefined' || !window.electronAPI?.getMeeting) return null
  return window.electronAPI
}

/** A detail link can target a meeting outside the catalog's first page or search result. */
export async function loadMeetingSelection({ api, workspaceId, meetingId }: {
  api: MeetingSelectionApi | null
  workspaceId: string | null
  meetingId: string
}): Promise<MeetingListItem | null> {
  if (!api || !workspaceId) return null
  const result = await api.getMeeting(workspaceId, meetingId)
  if (!result || typeof result !== 'object') return null
  const meeting = result as Record<string, unknown>
  if (meeting.meetingId !== meetingId || meeting.workspaceId !== workspaceId ||
      typeof meeting.title !== 'string' || typeof meeting.status !== 'string') return null
  return { id: meetingId, title: meeting.title, status: meeting.status }
}
