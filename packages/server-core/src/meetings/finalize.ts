/**
 * Native finalize intent. Marks the journal completed without ASR text.
 * Not live Conation/SFU and not OS speech recognition.
 */
import type { Meeting } from '@craft-agent/core/meetings'
import { authorizeMeetingAction, type MeetingGrant } from '@craft-agent/shared/meeting-agents'
import { MeetingJournal } from './journal.ts'

const NATIVE_PROVIDER = 'native-journal'
const NATIVE_REMOTE_TYPES = new Set(['import-intent', 'capture-intent'])

export type FinalizeNativeResult =
  | { ok: true; meeting: Meeting }
  | { ok: false; code: string }

function isNativeBinding(meeting: Meeting): boolean {
  const binding = meeting.sourceBinding
  if (!binding) return false
  return binding.provider === NATIVE_PROVIDER && NATIVE_REMOTE_TYPES.has(binding.remoteType)
}

export function applyNativeFinalizeIntent(input: {
  persistRootDir: string
  workspaceId: string
  actorId: string
  grant: MeetingGrant | null
  meetingId: string
}): FinalizeNativeResult {
  if (!input.grant) return { ok: false, code: 'grant-required' }
  if (!input.persistRootDir) return { ok: false, code: 'config-dir-required' }
  if (!input.workspaceId) return { ok: false, code: 'workspace-required' }
  if (!input.meetingId) return { ok: false, code: 'meeting-required' }
  const auth = authorizeMeetingAction(input.grant, {
    actorId: input.actorId,
    workspaceId: input.workspaceId,
    deviceId: input.grant.deviceId,
    capability: 'archive',
    operation: 'finalize',
    targetId: input.meetingId,
  })
  if (!auth.ok) {
    return { ok: false, code: auth.code === 'capability-denied' ? 'archive-denied' : auth.code }
  }
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
    if (meeting.status === 'completed' && isNativeBinding(meeting)) return { ok: true, meeting }
    if (!isNativeBinding(meeting)) {
      return { ok: false, code: meeting.sourceBinding ? 'foreign-binding' : 'finalize-not-ready' }
    }
    if (meeting.status === 'capturing') return { ok: false, code: 'capture-in-progress' }
    if (meeting.status !== 'finalizing' && meeting.status !== 'paused') {
      return { ok: false, code: 'finalize-not-ready' }
    }
    journal.commit({
      workspaceId: input.workspaceId,
      meetingId: input.meetingId,
      expectedRevision: meeting.revision,
      commandId: `finalize-${input.meetingId}-${meeting.revision}`,
      events: [{ type: 'meeting.status', status: 'completed' }],
      outboxEntries: [],
    })
    return { ok: true, meeting: journal.read(input.meetingId).meeting }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'finalize-failed'
    if (message.includes('already has a writer')) return { ok: false, code: 'journal-locked' }
    return { ok: false, code: 'finalize-failed' }
  } finally {
    journal.releaseWriter()
  }
}
