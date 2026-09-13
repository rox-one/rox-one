/**
 * Append-only proposal.upsert into the meeting journal.
 * Store (proposals.json) stays the source of proposal rows; this keeps the
 * journal event stream consistent. Does not invent a meeting snapshot.
 */
import type { MeetingProposal } from '@craft-agent/core/meetings'
import {
  appendMeetingJournalEvents,
  type AppendJournalEventsResult,
  type JournalAppendFailCode,
} from './journal-append.ts'

export type ProposalJournalFailCode = JournalAppendFailCode
export type AppendProposalJournalResult = AppendJournalEventsResult

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
  return appendMeetingJournalEvents({
    persistRootDir: input.persistRootDir,
    workspaceId: input.workspaceId,
    meetingId: input.proposal.meetingId,
    commandId: proposalJournalCommandId(input.proposal),
    events: [{ type: 'proposal.upsert', proposal: cloneProposal(input.proposal) }],
  })
}
