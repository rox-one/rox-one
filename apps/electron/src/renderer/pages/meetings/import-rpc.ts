import type { Meeting } from '@craft-agent/core/meetings'
import type { MeetingGrant } from '@craft-agent/shared/meeting-agents'
import { i18nKeyForCaptureError } from './capture-rpc'
import type { MeetingListItem } from './start-rpc'
import { rowFromMeeting } from './start-rpc'

export type ImportMediaSpec = {
  contentHash: string
  byteLength: number
  mimeType?: string
}

export type MeetingImportApi = {
  importMedia(
    workspaceId: string,
    meetingId: string,
    actorId: string,
    grant: MeetingGrant | null,
    spec: ImportMediaSpec,
  ): Promise<{ meeting: Meeting | null; error?: { code: string } }>
}

export function buildMeetingImportGrant(input: {
  workspaceId: string
  actorId: string
  deviceId?: string
}): MeetingGrant {
  return {
    id: `grant-import-${input.workspaceId}`,
    actorId: input.actorId,
    workspaceId: input.workspaceId,
    deviceId: input.deviceId ?? 'desktop',
    capabilities: ['send', 'archive'],
  }
}

export function resolveMeetingImportApi(injected?: MeetingImportApi | null): MeetingImportApi | null {
  if (injected?.importMedia) return injected
  if (typeof window === 'undefined') return null
  const api = window.electronAPI
  if (!api?.importMedia) return null
  return api as MeetingImportApi
}

export function i18nKeyForImportError(code: string | undefined): string {
  if (code === 'archive-denied') return 'meetings.archiveDenied'
  if (code === 'import-empty') return 'meetings.importEmpty'
  if (code === 'import-bad-format' || code === 'import-bad-hash') return 'meetings.importBadFormat'
  if (code === 'import-failed' || code === 'import-too-large' || code === 'foreign-binding' || code === 'journal-locked') {
    return 'meetings.importFailed'
  }
  const capture = i18nKeyForCaptureError(code)
  return capture === 'meetings.approveFailed' ? 'meetings.importFailed' : capture
}

export async function specFromBytes(bytes: Uint8Array, mimeType?: string): Promise<ImportMediaSpec> {
  // Web Crypto needs an ArrayBuffer-backed view. Preserve the selected range
  // without copying ordinary file bytes; snapshot shared memory before hashing.
  const source = bytes.buffer instanceof ArrayBuffer
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : new Uint8Array(bytes)
  const digest = await crypto.subtle.digest('SHA-256', source)
  const contentHash = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
  return { contentHash, byteLength: bytes.byteLength, mimeType }
}

export async function importMediaViaRpc(input: {
  api: MeetingImportApi | null
  workspaceId: string | null
  meetingId: string | null
  actorId: string
  grant: MeetingGrant | null
  spec: ImportMediaSpec | null
}): Promise<{ ok: true; meeting: MeetingListItem } | { ok: false; code: string }> {
  if (!input.api) return { ok: false, code: 'rpc-unavailable' }
  if (!input.workspaceId) return { ok: false, code: 'workspace-required' }
  if (!input.meetingId) return { ok: false, code: 'meeting-required' }
  if (!input.grant) return { ok: false, code: 'grant-required' }
  if (!input.spec) return { ok: false, code: 'import-empty' }
  const result = await input.api.importMedia(
    input.workspaceId,
    input.meetingId,
    input.actorId,
    input.grant,
    input.spec,
  )
  if (!result.meeting) return { ok: false, code: result.error?.code ?? 'import-failed' }
  if (result.meeting.status !== 'finalizing') return { ok: false, code: 'import-failed' }
  if (result.meeting.sourceBinding?.provider !== 'native-journal') return { ok: false, code: 'import-failed' }
  if (result.meeting.sourceBinding?.remoteType !== 'import-intent') return { ok: false, code: 'import-failed' }
  return { ok: true, meeting: rowFromMeeting(result.meeting) }
}
