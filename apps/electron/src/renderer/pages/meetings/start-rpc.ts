import type { Meeting } from '@craft-agent/core/meetings'
import type { MeetingGrant } from '@craft-agent/shared/meeting-agents'
import { i18nKeyForProposalError } from './proposal-rpc'

export type MeetingListItem = {
  id: string
  title: string
  status: string
}

export type MeetingCatalogApi = {
  createMeeting(
    workspaceId: string,
    title: string,
    actorId: string,
    grant: MeetingGrant | null,
  ): Promise<{ meeting: Meeting | null; error?: { code: string } }>
  listMeetings(
    workspaceId: string,
    cursor?: string,
    limit?: number,
  ): Promise<{ page: Meeting[]; continueCursor: string | null; denied?: boolean }>
}

export type MeetingSearchApi = {
  searchMeetings(
    workspaceId: string,
    query: string,
  ): Promise<{
    page: Meeting[]
    continueCursor: string | null
    denied?: boolean
    error?: { code: string }
  }>
}

export function resolveMeetingCatalogApi(injected?: MeetingCatalogApi | null): MeetingCatalogApi | null {
  if (injected?.createMeeting && injected.listMeetings) return injected
  if (typeof window === 'undefined') return null
  const api = window.electronAPI
  if (!api?.createMeeting || !api?.listMeetings) return null
  return api as MeetingCatalogApi
}

export function resolveMeetingSearchApi(
  injected?: (Partial<MeetingCatalogApi> & Partial<MeetingSearchApi>) | MeetingSearchApi | null,
): MeetingSearchApi | null {
  if (injected?.searchMeetings) return injected as MeetingSearchApi
  if (typeof window === 'undefined') return null
  const api = window.electronAPI
  if (!api?.searchMeetings) return null
  return api
}

export function rowFromMeeting(meeting: Meeting): MeetingListItem {
  return {
    id: meeting.meetingId,
    title: meeting.title,
    status: meeting.status,
  }
}

export async function startNativeMeetingViaRpc(input: {
  api: MeetingCatalogApi | null
  workspaceId: string | null
  actorId: string
  grant: MeetingGrant | null
  title: string
}): Promise<{ ok: true; meeting: MeetingListItem } | { ok: false; code: string }> {
  if (!input.api) return { ok: false, code: 'rpc-unavailable' }
  if (!input.workspaceId) return { ok: false, code: 'workspace-required' }
  if (!input.grant) return { ok: false, code: 'grant-required' }
  const result = await input.api.createMeeting(input.workspaceId, input.title, input.actorId, input.grant)
  if (!result.meeting) return { ok: false, code: result.error?.code ?? 'start-failed' }
  if (result.meeting.status !== 'planned') return { ok: false, code: 'start-failed' }
  return { ok: true, meeting: rowFromMeeting(result.meeting) }
}

export async function listNativeMeetingsViaRpc(input: {
  api: MeetingCatalogApi | null
  workspaceId: string | null
}): Promise<{ ok: true; meetings: MeetingListItem[] } | { ok: false; code: string }> {
  if (!input.api) return { ok: false, code: 'rpc-unavailable' }
  if (!input.workspaceId) return { ok: false, code: 'workspace-required' }
  const result = await input.api.listMeetings(input.workspaceId)
  return { ok: true, meetings: (result.page ?? []).map(rowFromMeeting) }
}

export async function searchNativeMeetingsViaRpc(input: {
  api: MeetingSearchApi | null
  workspaceId: string | null
  query: string
}): Promise<{ ok: true; meetings: MeetingListItem[] } | { ok: false; code: string }> {
  if (!input.api) return { ok: false, code: 'rpc-unavailable' }
  if (!input.workspaceId) return { ok: false, code: 'workspace-required' }
  const result = await input.api.searchMeetings(input.workspaceId, input.query)
  if (result.error?.code) return { ok: false, code: result.error.code }
  if (result.denied) return { ok: false, code: 'workspace-required' }
  return { ok: true, meetings: (result.page ?? []).map(rowFromMeeting) }
}

export function i18nKeyForSearchError(code: string | undefined): string {
  if (code === 'search-failed') return 'meetings.searchFailed'
  return i18nKeyForStartError(code)
}

export function i18nKeyForStartError(code: string | undefined): string {
  if (code === 'start-failed' || code === 'journal-locked') return 'meetings.startFailed'
  return i18nKeyForProposalError(code)
}
