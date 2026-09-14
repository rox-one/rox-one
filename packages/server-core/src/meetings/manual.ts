/**
 * Native manual note / correction intents. Journal-only, not ASR.
 * Not live Conation/SFU and not OS speech recognition.
 */
import { createHash } from 'node:crypto'
import type { Meeting } from '@craft-agent/core/meetings'
import { authorizeMeetingAction, type MeetingGrant } from '@craft-agent/shared/meeting-agents'
import { MeetingJournal } from './journal.ts'

const NATIVE_PROVIDER = 'native-journal'
const NATIVE_REMOTE_TYPES = new Set(['import-intent', 'capture-intent'])
const ID_RE = /^[a-zA-Z0-9._-]{1,64}$/
const TEXT_MAX = 4096

export type ManualNoteSpec = { noteId: string; text: string }
export type SegmentCorrectionSpec = { segmentId: string; replacement: string }

export type ManualNativeResult =
  | { ok: true; meeting: Meeting }
  | { ok: false; code: string }

function isNativeBinding(meeting: Meeting): boolean {
  const binding = meeting.sourceBinding
  if (!binding) return false
  return binding.provider === NATIVE_PROVIDER && NATIVE_REMOTE_TYPES.has(binding.remoteType)
}

function trimText(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function specIdError(id: string | undefined): string | null {
  if (!id || !ID_RE.test(id)) return 'id-invalid'
  return null
}

function guardWrite(input: {
  persistRootDir: string
  workspaceId: string
  actorId: string
  grant: MeetingGrant | null
  meetingId: string
  operation: string
  notReadyCode: string
}): { ok: false; code: string } | { ok: true; meeting: Meeting; journal: MeetingJournal } {
  if (!input.grant) return { ok: false, code: 'grant-required' }
  if (!input.persistRootDir) return { ok: false, code: 'config-dir-required' }
  if (!input.workspaceId) return { ok: false, code: 'workspace-required' }
  if (!input.meetingId) return { ok: false, code: 'meeting-required' }
  const auth = authorizeMeetingAction(input.grant, {
    actorId: input.actorId,
    workspaceId: input.workspaceId,
    deviceId: input.grant.deviceId,
    capability: 'archive',
    operation: input.operation,
    targetId: input.meetingId,
  })
  if (!auth.ok) {
    return { ok: false, code: auth.code === 'capability-denied' ? 'archive-denied' : auth.code }
  }
  const journal = new MeetingJournal(input.persistRootDir)
  try {
    const snapshot = journal.read(input.meetingId)
    const meeting = snapshot.meeting
    if (meeting.workspaceId !== input.workspaceId) return { ok: false, code: 'workspace-mismatch' }
    if (!isNativeBinding(meeting)) {
      return { ok: false, code: meeting.sourceBinding ? 'foreign-binding' : input.notReadyCode }
    }
    return { ok: true, meeting, journal }
  } catch {
    journal.releaseWriter()
    return { ok: false, code: 'meeting-not-found' }
  }
}

function commitIntent(input: {
  journal: MeetingJournal
  workspaceId: string
  meetingId: string
  meeting: Meeting
  commandId: string
  events: Parameters<MeetingJournal['commit']>[0]['events']
  failCode: string
}): ManualNativeResult {
  try {
    input.journal.commit({
      workspaceId: input.workspaceId,
      meetingId: input.meetingId,
      expectedRevision: input.meeting.revision,
      commandId: input.commandId,
      events: input.events,
      outboxEntries: [],
    })
    return { ok: true, meeting: input.journal.read(input.meetingId).meeting }
  } catch (error) {
    const message = error instanceof Error ? error.message : input.failCode
    if (message.includes('already has a writer')) return { ok: false, code: 'journal-locked' }
    if (message.includes('stale CAS')) return { ok: false, code: input.failCode }
    return { ok: false, code: input.failCode }
  } finally {
    input.journal.releaseWriter()
  }
}

export function applyNativeManualNote(input: {
  persistRootDir: string
  workspaceId: string
  actorId: string
  grant: MeetingGrant | null
  meetingId: string
  spec: ManualNoteSpec
}): ManualNativeResult {
  const text = trimText(input.spec?.text)
  if (!text) return { ok: false, code: 'note-empty' }
  if (text.length > TEXT_MAX) return { ok: false, code: 'note-empty' }
  const idError = specIdError(input.spec?.noteId)
  if (idError) return { ok: false, code: 'note-empty' }
  const guarded = guardWrite({ ...input, operation: 'note', notReadyCode: 'note-not-ready' })
  if (!guarded.ok) return guarded
  return commitIntent({
    journal: guarded.journal,
    workspaceId: input.workspaceId,
    meetingId: input.meetingId,
    meeting: guarded.meeting,
    commandId: `note-${input.meetingId}-${input.spec.noteId}`,
    events: [{ type: 'manual.note', noteId: input.spec.noteId, text }],
    failCode: 'note-failed',
  })
}

export function applyNativeSegmentCorrection(input: {
  persistRootDir: string
  workspaceId: string
  actorId: string
  grant: MeetingGrant | null
  meetingId: string
  spec: SegmentCorrectionSpec
}): ManualNativeResult {
  const replacement = trimText(input.spec?.replacement)
  if (!replacement) return { ok: false, code: 'correction-empty' }
  if (replacement.length > TEXT_MAX) return { ok: false, code: 'correction-empty' }
  const idError = specIdError(input.spec?.segmentId)
  if (idError) return { ok: false, code: 'correction-empty' }
  const guarded = guardWrite({ ...input, operation: 'correct', notReadyCode: 'correct-not-ready' })
  if (!guarded.ok) return guarded
  const digest = createHash('sha256').update(replacement).digest('hex').slice(0, 8)
  return commitIntent({
    journal: guarded.journal,
    workspaceId: input.workspaceId,
    meetingId: input.meetingId,
    meeting: guarded.meeting,
    commandId: `correct-${input.meetingId}-${input.spec.segmentId}-${digest}`,
    events: [{ type: 'segment.correct', segmentId: input.spec.segmentId, replacement }],
    failCode: 'correct-failed',
  })
}
