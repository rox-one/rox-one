import type { Meeting } from '@craft-agent/core/meetings'
import type { MeetingGrant } from '@craft-agent/shared/meeting-agents'
import { i18nKeyForFinalizeError } from './finalize-rpc'
import type { MeetingListItem } from './start-rpc'
import { rowFromMeeting } from './start-rpc'

export type ManualNoteSpec = { noteId: string; text: string }
export type SegmentCorrectionSpec = { segmentId: string; replacement: string }

export type MeetingManualApi = {
  addManualNote(
    workspaceId: string,
    meetingId: string,
    actorId: string,
    grant: MeetingGrant | null,
    spec: ManualNoteSpec,
  ): Promise<{ meeting: Meeting | null; error?: { code: string } }>
  correctSegment(
    workspaceId: string,
    meetingId: string,
    actorId: string,
    grant: MeetingGrant | null,
    spec: SegmentCorrectionSpec,
  ): Promise<{ meeting: Meeting | null; error?: { code: string } }>
}

export function resolveMeetingManualApi(injected?: MeetingManualApi | null): MeetingManualApi | null {
  if (typeof injected?.addManualNote === 'function' && typeof injected.correctSegment === 'function') return injected
  if (typeof window === 'undefined') return null
  const api = window.electronAPI
  if (!api?.addManualNote || !api?.correctSegment) return null
  return api as MeetingManualApi
}

export function i18nKeyForManualError(code: string | undefined): string {
  if (code === 'note-empty') return 'meetings.noteEmpty'
  if (code === 'correction-empty') return 'meetings.correctionEmpty'
  if (code === 'note-not-ready') return 'meetings.manualNoteNotReady'
  if (code === 'correct-not-ready') return 'meetings.correctNotReady'
  if (code === 'note-failed') return 'meetings.manualNoteFailed'
  if (code === 'correct-failed') return 'meetings.correctFailed'
  return i18nKeyForFinalizeError(code)
}

function nativeJournalOrFail(
  meeting: Meeting | null,
  errorCode: string | undefined,
  failCode: string,
): { ok: true; meeting: MeetingListItem } | { ok: false; code: string } {
  if (!meeting) {
    const code = errorCode ?? failCode
    if (code === 'foreign-binding' || code === 'journal-locked') return { ok: false, code: failCode }
    return { ok: false, code }
  }
  if (meeting.sourceBinding?.provider !== 'native-journal') return { ok: false, code: failCode }
  if (meeting.sourceBinding.remoteType !== 'import-intent' && meeting.sourceBinding.remoteType !== 'capture-intent') {
    return { ok: false, code: failCode }
  }
  return { ok: true, meeting: rowFromMeeting(meeting) }
}

export async function addManualNoteViaRpc(input: {
  api: MeetingManualApi | null
  workspaceId: string | null
  meetingId: string | null
  actorId: string
  grant: MeetingGrant | null
  spec: ManualNoteSpec | null
}): Promise<{ ok: true; meeting: MeetingListItem } | { ok: false; code: string }> {
  if (!input.api) return { ok: false, code: 'rpc-unavailable' }
  if (!input.workspaceId) return { ok: false, code: 'workspace-required' }
  if (!input.meetingId) return { ok: false, code: 'meeting-required' }
  if (!input.grant) return { ok: false, code: 'grant-required' }
  if (!input.spec || !input.spec.text.trim()) return { ok: false, code: 'note-empty' }
  const result = await input.api.addManualNote(input.workspaceId, input.meetingId, input.actorId, input.grant, input.spec)
  return nativeJournalOrFail(result.meeting, result.error?.code, 'note-failed')
}

export async function correctSegmentViaRpc(input: {
  api: MeetingManualApi | null
  workspaceId: string | null
  meetingId: string | null
  actorId: string
  grant: MeetingGrant | null
  spec: SegmentCorrectionSpec | null
}): Promise<{ ok: true; meeting: MeetingListItem } | { ok: false; code: string }> {
  if (!input.api) return { ok: false, code: 'rpc-unavailable' }
  if (!input.workspaceId) return { ok: false, code: 'workspace-required' }
  if (!input.meetingId) return { ok: false, code: 'meeting-required' }
  if (!input.grant) return { ok: false, code: 'grant-required' }
  if (!input.spec || !input.spec.replacement.trim()) return { ok: false, code: 'correction-empty' }
  const result = await input.api.correctSegment(input.workspaceId, input.meetingId, input.actorId, input.grant, input.spec)
  return nativeJournalOrFail(result.meeting, result.error?.code, 'correct-failed')
}
