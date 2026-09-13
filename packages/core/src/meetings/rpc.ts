/**
 * Meeting RPC command shapes. Transport strings live in shared protocol.
 */

import type { Meeting, MeetingProposal, OperationResultV2, TranscriptSegment } from './model.ts'

export const MEETING_RPC_METHODS = [
  'meetings:list',
  'meetings:get',
  'meetings:search',
  'meetings:create',
  'meetings:createProposal',
  'meetings:correctSegment',
  'meetings:addManualNote',
  'meetings:approveProposal',
  'meetings:rejectProposal',
  'meetings:mailPrepare',
  'meetings:mailSend',
  'meetings:crmPropose',
  'meetings:calendarBind',
  'meetings:roomJoin',
  'meetings:mailThreads',
  'meetings:startCapture',
  'meetings:pauseCapture',
  'meetings:stopCapture',
  'meetings:importMedia',
] as const

export type MeetingRpcMethod = (typeof MEETING_RPC_METHODS)[number]

export type MeetingCommitCommand = {
  workspaceId: string
  meetingId: string
  expectedRevision: number
  commandId: string
  events: readonly MeetingJournalEvent[]
  outboxEntries: readonly MeetingOutboxEntry[]
}

export type MeetingJournalEvent =
  | { type: 'meeting.created'; meeting: Meeting }
  | { type: 'meeting.status'; status: Meeting['status'] }
  | { type: 'meeting.binding'; sourceBinding: NonNullable<Meeting['sourceBinding']> }
  | { type: 'segment.upsert'; segment: TranscriptSegment }
  | { type: 'proposal.upsert'; proposal: MeetingProposal }
  | { type: 'manual.note'; noteId: string; text: string }
  | { type: 'operation.result'; result: OperationResultV2 }

export type MeetingOutboxEntry = {
  operationId: string
  proposalId: string
  idempotencyKey: string
  payloadHash: string
  createdAt: number
}

export type MeetingCommitResult = {
  revision: number
  duplicate: boolean
}
