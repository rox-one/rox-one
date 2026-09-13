/**
 * Fail-closed append of journal events onto an existing meeting snapshot.
 * Does not invent a meeting when the snapshot is missing.
 */
import type { MeetingJournalEvent } from '@craft-agent/core/meetings'
import { MeetingJournal } from './journal.ts'

export type JournalAppendFailCode =
  | 'config-dir-required'
  | 'meeting-not-found'
  | 'workspace-mismatch'
  | 'journal-locked'
  | 'upsert-failed'

export type AppendJournalEventsResult =
  | { ok: true; revision: number }
  | { ok: false; code: JournalAppendFailCode }

export function appendMeetingJournalEvents(input: {
  persistRootDir: string | null | undefined
  workspaceId: string
  meetingId: string
  commandId: string
  events: MeetingJournalEvent[]
}): AppendJournalEventsResult {
  if (!input.persistRootDir) return { ok: false, code: 'config-dir-required' }
  if (!input.workspaceId) return { ok: false, code: 'workspace-mismatch' }
  const journal = new MeetingJournal(input.persistRootDir)
  try {
    let snapshot
    try {
      snapshot = journal.read(input.meetingId)
    } catch {
      return { ok: false, code: 'meeting-not-found' }
    }
    if (snapshot.meeting.workspaceId === 'unknown') {
      return { ok: false, code: 'meeting-not-found' }
    }
    if (snapshot.meeting.workspaceId !== input.workspaceId) {
      return { ok: false, code: 'workspace-mismatch' }
    }
    const result = journal.commit({
      workspaceId: input.workspaceId,
      meetingId: input.meetingId,
      expectedRevision: snapshot.meeting.revision,
      commandId: input.commandId,
      events: input.events,
      outboxEntries: [],
    })
    return { ok: true, revision: result.revision }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('already has a writer') || msg.includes('stale CAS')) {
      return { ok: false, code: 'journal-locked' }
    }
    return { ok: false, code: 'upsert-failed' }
  } finally {
    journal.releaseWriter()
  }
}
