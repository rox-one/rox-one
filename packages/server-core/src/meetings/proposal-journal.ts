/**
 * Append-only proposal.upsert into the meeting journal.
 * Store (proposals.json) stays the source of proposal rows; this keeps the
 * journal event stream consistent. Does not invent a meeting snapshot.
 */
import type { MeetingProposal } from '@craft-agent/core/meetings'
import { MeetingJournal } from './journal.ts'

export type ProposalJournalFailCode =
  | 'config-dir-required'
  | 'meeting-not-found'
  | 'workspace-mismatch'
  | 'journal-locked'
  | 'upsert-failed'

export type AppendProposalJournalResult =
  | { ok: true; revision: number }
  | { ok: false; code: ProposalJournalFailCode }

export function proposalJournalCommandId(proposal: Pick<MeetingProposal, 'id' | 'status'>): string {
  return `proposal-${proposal.id}-${proposal.status}`
}

function cloneProposal(proposal: MeetingProposal): MeetingProposal {
  return JSON.parse(JSON.stringify(proposal)) as MeetingProposal
}

export function appendProposalJournalEvent(input: {
  persistRootDir: string | null | undefined
  workspaceId: string
  proposal: MeetingProposal
}): AppendProposalJournalResult {
  if (!input.persistRootDir) return { ok: false, code: 'config-dir-required' }
  if (!input.workspaceId) return { ok: false, code: 'workspace-mismatch' }
  const journal = new MeetingJournal(input.persistRootDir)
  try {
    let snapshot
    try {
      snapshot = journal.read(input.proposal.meetingId)
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
      meetingId: input.proposal.meetingId,
      expectedRevision: snapshot.meeting.revision,
      commandId: proposalJournalCommandId(input.proposal),
      events: [{ type: 'proposal.upsert', proposal: cloneProposal(input.proposal) }],
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
