/**
 * Native meeting catalog. Persist through the journal, not a live SFU/Conation room.
 * Fail-closed without grant or persist root. Start stays `planned`.
 */
import { randomUUID } from 'node:crypto'
import { emptyMeeting, type Meeting } from '@craft-agent/core/meetings'
import { authorizeMeetingAction, type MeetingGrant } from '@craft-agent/shared/meeting-agents'
import { MeetingJournal } from './journal.ts'

export type StartNativeMeetingResult =
  | { ok: true; meeting: Meeting }
  | { ok: false; code: string }

export function listNativeMeetings(persistRootDir: string): Meeting[] {
  return new MeetingJournal(persistRootDir).list().filter((item) => item.workspaceId !== 'unknown')
}

export function startNativeMeeting(input: {
  persistRootDir: string
  workspaceId: string
  actorId: string
  grant: MeetingGrant | null
  title: string
  now?: number
  meetingId?: string
}): StartNativeMeetingResult {
  if (!input.grant) return { ok: false, code: 'grant-required' }
  if (!input.persistRootDir) return { ok: false, code: 'config-dir-required' }
  if (!input.workspaceId) return { ok: false, code: 'workspace-required' }
  const auth = authorizeMeetingAction(input.grant, {
    actorId: input.actorId,
    workspaceId: input.workspaceId,
    deviceId: input.grant.deviceId,
    capability: 'send',
    operation: 'start',
  })
  if (!auth.ok) return { ok: false, code: auth.code }
  const meetingId = input.meetingId && input.meetingId.length > 0 ? input.meetingId : `meeting-${randomUUID()}`
  const now = input.now ?? Date.now()
  const meeting = emptyMeeting({
    workspaceId: input.workspaceId,
    meetingId,
    title: input.title,
    now,
  })
  const journal = new MeetingJournal(input.persistRootDir)
  try {
    journal.commit({
      workspaceId: input.workspaceId,
      meetingId,
      expectedRevision: 0,
      commandId: `start-${meetingId}`,
      events: [{ type: 'meeting.created', meeting }],
      outboxEntries: [],
    })
    return { ok: true, meeting: journal.read(meetingId).meeting }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'start-failed'
    if (message.includes('already has a writer')) return { ok: false, code: 'journal-locked' }
    return { ok: false, code: 'start-failed' }
  } finally {
    journal.releaseWriter()
  }
}
