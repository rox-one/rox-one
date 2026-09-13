import type { Meeting } from '@craft-agent/core/meetings'
import type { MeetingGrant } from '@craft-agent/shared/meeting-agents'
import { i18nKeyForImportError } from './import-rpc'
import type { MeetingListItem } from './start-rpc'
import { rowFromMeeting } from './start-rpc'

export type MeetingFinalizeApi = {
  finalizeMeeting(
    workspaceId: string,
    meetingId: string,
    actorId: string,
    grant: MeetingGrant | null,
  ): Promise<{ meeting: Meeting | null; error?: { code: string } }>
}

export function resolveMeetingFinalizeApi(injected?: MeetingFinalizeApi | null): MeetingFinalizeApi | null {
  if (injected?.finalizeMeeting) return injected
  if (typeof window === 'undefined') return null
  const api = window.electronAPI
  if (!api?.finalizeMeeting) return null
  return api as MeetingFinalizeApi
}

export function i18nKeyForFinalizeError(code: string | undefined): string {
  if (code === 'finalize-failed') return 'meetings.finalizeFailed'
  if (code === 'finalize-not-ready' || code === 'capture-in-progress') return 'meetings.finalizeNotReady'
  return i18nKeyForImportError(code)
}

export async function finalizeMeetingViaRpc(input: {
  api: MeetingFinalizeApi | null
  workspaceId: string | null
  meetingId: string | null
  actorId: string
  grant: MeetingGrant | null
}): Promise<{ ok: true; meeting: MeetingListItem } | { ok: false; code: string }> {
  if (!input.api) return { ok: false, code: 'rpc-unavailable' }
  if (!input.workspaceId) return { ok: false, code: 'workspace-required' }
  if (!input.meetingId) return { ok: false, code: 'meeting-required' }
  if (!input.grant) return { ok: false, code: 'grant-required' }
  const result = await input.api.finalizeMeeting(input.workspaceId, input.meetingId, input.actorId, input.grant)
  if (!result.meeting) {
    const code = result.error?.code ?? 'finalize-failed'
    if (code === 'foreign-binding' || code === 'journal-locked') return { ok: false, code: 'finalize-failed' }
    return { ok: false, code }
  }
  if (result.meeting.status !== 'completed') return { ok: false, code: 'finalize-failed' }
  if (result.meeting.sourceBinding?.provider !== 'native-journal') return { ok: false, code: 'finalize-failed' }
  if (result.meeting.sourceBinding.remoteType !== 'import-intent' && result.meeting.sourceBinding.remoteType !== 'capture-intent') {
    return { ok: false, code: 'finalize-failed' }
  }
  return { ok: true, meeting: rowFromMeeting(result.meeting) }
}
