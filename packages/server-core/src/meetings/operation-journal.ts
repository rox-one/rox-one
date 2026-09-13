/**
 * Append-only operation.result into the meeting journal when a native
 * apply/approve produced an OperationResultV2. Does not invent ASR or a
 * meeting snapshot. commandId includes verification so a failed apply then a
 * later verified apply is not swallowed as a duplicate.
 */
import type { OperationResultV2 } from '@craft-agent/core/meetings'
import {
  appendMeetingJournalEvents,
  type AppendJournalEventsResult,
  type JournalAppendFailCode,
} from './journal-append.ts'

export type OperationJournalFailCode = JournalAppendFailCode
export type AppendOperationJournalResult = AppendJournalEventsResult

export function operationJournalCommandId(result: Pick<OperationResultV2, 'operationId' | 'verification'>): string {
  return `operation-${result.operationId}-${result.verification}`
}

function cloneResult(result: OperationResultV2): OperationResultV2 {
  return JSON.parse(JSON.stringify(result)) as OperationResultV2
}

export function appendOperationResultEvent(input: {
  persistRootDir: string | null | undefined
  workspaceId: string
  meetingId: string
  result: OperationResultV2
}): AppendOperationJournalResult {
  return appendMeetingJournalEvents({
    persistRootDir: input.persistRootDir,
    workspaceId: input.workspaceId,
    meetingId: input.meetingId,
    commandId: operationJournalCommandId(input.result),
    events: [{ type: 'operation.result', result: cloneResult(input.result) }],
  })
}
