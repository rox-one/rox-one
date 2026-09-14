import type { Meeting } from '@craft-agent/core/meetings'
import type { MeetingGrant } from '@craft-agent/shared/meeting-agents'
import { i18nKeyForProposalError } from './proposal-rpc'
import type { MeetingListItem } from './start-rpc'
import { rowFromMeeting } from './start-rpc'

export type CaptureIntentAction = 'start' | 'pause' | 'stop'

export type MeetingCaptureApi = {
  startCapture(
    workspaceId: string,
    meetingId: string,
    actorId: string,
    grant: MeetingGrant | null,
  ): Promise<{ meeting: Meeting | null; error?: { code: string } }>
  pauseCapture(
    workspaceId: string,
    meetingId: string,
    actorId: string,
    grant: MeetingGrant | null,
  ): Promise<{ meeting: Meeting | null; error?: { code: string } }>
  stopCapture(
    workspaceId: string,
    meetingId: string,
    actorId: string,
    grant: MeetingGrant | null,
  ): Promise<{ meeting: Meeting | null; error?: { code: string } }>
}

export function buildMeetingCaptureGrant(input: {
  workspaceId: string
  actorId: string
  deviceId?: string
}): MeetingGrant {
  return {
    id: `grant-capture-${input.workspaceId}`,
    actorId: input.actorId,
    workspaceId: input.workspaceId,
    deviceId: input.deviceId ?? 'desktop',
    capabilities: ['send', 'mic'],
  }
}

export function resolveMeetingCaptureApi(injected?: MeetingCaptureApi | null): MeetingCaptureApi | null {
  if (
    typeof injected?.startCapture === 'function'
    && typeof injected.pauseCapture === 'function'
    && typeof injected.stopCapture === 'function'
  ) return injected
  if (typeof window === 'undefined') return null
  const api = window.electronAPI
  if (!api?.startCapture || !api?.pauseCapture || !api?.stopCapture) return null
  return api as MeetingCaptureApi
}

export function i18nKeyForCaptureError(code: string | undefined): string {
  if (code === 'capability-denied') return 'meetings.capabilityDenied'
  if (code === 'capture-failed' || code === 'journal-locked' || code === 'foreign-binding') return 'meetings.captureFailed'
  if (code === 'capture-not-started') return 'meetings.captureNotStarted'
  if (code === 'meeting-not-found') return 'meetings.meetingNotFound'
  if (code === 'start-failed') return 'meetings.startFailed'
  return i18nKeyForProposalError(code)
}

function captureMethod(api: MeetingCaptureApi, action: CaptureIntentAction): MeetingCaptureApi['startCapture'] {
  switch (action) {
    case 'start':
      return api.startCapture
    case 'pause':
      return api.pauseCapture
    case 'stop':
      return api.stopCapture
    default: {
      const exhaustive: never = action
      throw new Error(`unsupported capture action ${exhaustive}`)
    }
  }
}

function expectedStatus(action: CaptureIntentAction): Meeting['status'] {
  switch (action) {
    case 'start':
      return 'capturing'
    case 'pause':
      return 'paused'
    case 'stop':
      return 'completed'
    default: {
      const exhaustive: never = action
      throw new Error(`unsupported capture action ${exhaustive}`)
    }
  }
}

export async function applyCaptureIntentViaRpc(input: {
  api: MeetingCaptureApi | null
  workspaceId: string | null
  meetingId: string | null
  actorId: string
  grant: MeetingGrant | null
  action: CaptureIntentAction
}): Promise<{ ok: true; meeting: MeetingListItem } | { ok: false; code: string }> {
  if (!input.api) return { ok: false, code: 'rpc-unavailable' }
  if (!input.workspaceId) return { ok: false, code: 'workspace-required' }
  if (!input.meetingId) return { ok: false, code: 'meeting-required' }
  if (!input.grant) return { ok: false, code: 'grant-required' }
  const method = captureMethod(input.api, input.action)
  const result = await method(input.workspaceId, input.meetingId, input.actorId, input.grant)
  if (!result.meeting) return { ok: false, code: result.error?.code ?? 'capture-failed' }
  if (result.meeting.status !== expectedStatus(input.action)) return { ok: false, code: 'capture-failed' }
  if (result.meeting.sourceBinding?.provider !== 'native-journal') return { ok: false, code: 'capture-failed' }
  if (result.meeting.sourceBinding?.remoteType !== 'capture-intent') return { ok: false, code: 'capture-failed' }
  return { ok: true, meeting: rowFromMeeting(result.meeting) }
}
