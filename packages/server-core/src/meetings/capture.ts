/**
 * Native capture intent. Persists sourceBinding + status in the journal.
 * Not a live SFU/Conation room and not OS microphone capture.
 */
import type { Meeting } from '@craft-agent/core/meetings'
import { authorizeMeetingAction, type MeetingGrant } from '@craft-agent/shared/meeting-agents'
import { MeetingJournal } from './journal.ts'

export const NATIVE_CAPTURE_PROVIDER = 'native-journal'
export const NATIVE_CAPTURE_REMOTE_TYPE = 'capture-intent'

export type CaptureIntentAction = 'start' | 'pause' | 'stop'

export type CaptureNativeResult =
  | { ok: true; meeting: Meeting }
  | { ok: false; code: string }

const TARGET_STATUS: Record<CaptureIntentAction, Meeting['status']> = {
  start: 'capturing',
  pause: 'paused',
  stop: 'completed',
}

export function nativeCaptureBinding(meetingId: string, actorId: string): NonNullable<Meeting['sourceBinding']> {
  return {
    provider: NATIVE_CAPTURE_PROVIDER,
    accountId: actorId,
    remoteType: NATIVE_CAPTURE_REMOTE_TYPE,
    remoteId: meetingId,
  }
}

function isNativeIntent(meeting: Meeting): boolean {
  const binding = meeting.sourceBinding
  if (!binding) return true
  return binding.provider === NATIVE_CAPTURE_PROVIDER && binding.remoteType === NATIVE_CAPTURE_REMOTE_TYPE
}

function hasNativeBinding(meeting: Meeting): boolean {
  return meeting.sourceBinding?.provider === NATIVE_CAPTURE_PROVIDER
    && meeting.sourceBinding.remoteType === NATIVE_CAPTURE_REMOTE_TYPE
}

function alreadyAtTarget(meeting: Meeting, action: CaptureIntentAction): boolean {
  return meeting.status === TARGET_STATUS[action] && hasNativeBinding(meeting)
}

function allowedFrom(status: Meeting['status'], action: CaptureIntentAction): boolean {
  if (action === 'start') {
    return status === 'planned' || status === 'paused' || status === 'permission_required'
      || status === 'completed' || status === 'cancelled'
  }
  if (action === 'pause') return status === 'capturing'
  return status === 'capturing' || status === 'paused'
}

export function applyNativeCaptureIntent(input: {
  persistRootDir: string
  workspaceId: string
  actorId: string
  grant: MeetingGrant | null
  meetingId: string
  action: CaptureIntentAction
}): CaptureNativeResult {
  if (!input.grant) return { ok: false, code: 'grant-required' }
  if (!input.persistRootDir) return { ok: false, code: 'config-dir-required' }
  if (!input.workspaceId) return { ok: false, code: 'workspace-required' }
  if (!input.meetingId) return { ok: false, code: 'meeting-required' }
  const auth = authorizeMeetingAction(input.grant, {
    actorId: input.actorId,
    workspaceId: input.workspaceId,
    deviceId: input.grant.deviceId,
    capability: 'mic',
    operation: 'capture',
    targetId: input.meetingId,
  })
  if (!auth.ok) return { ok: false, code: auth.code }
  const journal = new MeetingJournal(input.persistRootDir)
  try {
    let snapshot
    try {
      snapshot = journal.read(input.meetingId)
    } catch {
      return { ok: false, code: 'meeting-not-found' }
    }
    const meeting = snapshot.meeting
    if (meeting.workspaceId !== input.workspaceId) return { ok: false, code: 'workspace-mismatch' }
    if (!isNativeIntent(meeting)) return { ok: false, code: 'foreign-binding' }
    if (alreadyAtTarget(meeting, input.action)) return { ok: true, meeting }
    if (!allowedFrom(meeting.status, input.action)) return { ok: false, code: 'capture-not-started' }
    const sourceBinding = nativeCaptureBinding(input.meetingId, input.actorId)
    journal.commit({
      workspaceId: input.workspaceId,
      meetingId: input.meetingId,
      expectedRevision: meeting.revision,
      commandId: `capture-${input.action}-${input.meetingId}-${meeting.revision}`,
      events: [
        { type: 'meeting.binding', sourceBinding },
        { type: 'meeting.status', status: TARGET_STATUS[input.action] },
      ],
      outboxEntries: [],
    })
    return { ok: true, meeting: journal.read(input.meetingId).meeting }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'capture-failed'
    if (message.includes('already has a writer')) return { ok: false, code: 'journal-locked' }
    return { ok: false, code: 'capture-failed' }
  } finally {
    journal.releaseWriter()
  }
}
