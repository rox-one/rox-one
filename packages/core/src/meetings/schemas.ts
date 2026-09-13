/**
 * Runtime validation for Meeting / Proposal / Operation / EvidenceSpan.
 * Unknown schema versions block writes.
 */

import {
  MEETING_SCHEMA_VERSION,
  OPERATION_RESULT_V2_SCHEMA,
  MEETING_STATUSES,
  OPERATION_LIFECYCLES,
  OPERATION_MODES,
  PROPOSAL_STATUSES,
  TRANSCRIPT_SOURCES,
  VERIFICATION_STATES,
  type EvidenceSpan,
  type Meeting,
  type MeetingProposal,
  type OperationResultV2,
  type TranscriptSegment,
} from './model.ts'

export type SchemaParseError = { status: 'invalid'; reason: string }
export type SchemaBlocked = { status: 'blocked'; reason: 'unsupported-schema'; version: number }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

export function parseMeeting(value: unknown): Meeting | SchemaParseError | SchemaBlocked {
  if (!isRecord(value)) return { status: 'invalid', reason: 'meeting-not-object' }
  const version = value.schemaVersion
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { status: 'invalid', reason: 'missing-schemaVersion' }
  }
  if (version > MEETING_SCHEMA_VERSION) {
    return { status: 'blocked', reason: 'unsupported-schema', version }
  }
  if (!isString(value.workspaceId) || !isString(value.meetingId) || !isString(value.entityId)) {
    return { status: 'invalid', reason: 'missing-ids' }
  }
  if (typeof value.revision !== 'number' || value.revision < 0) {
    return { status: 'invalid', reason: 'bad-revision' }
  }
  if (!MEETING_STATUSES.includes(value.status as Meeting['status'])) {
    return { status: 'invalid', reason: 'bad-status' }
  }
  return value as Meeting
}

export function parseEvidenceSpan(value: unknown): EvidenceSpan | SchemaParseError {
  if (!isRecord(value)) return { status: 'invalid', reason: 'span-not-object' }
  const meeting = value.meeting
  if (!isRecord(meeting) || !isString(meeting.workspaceId) || !isString(meeting.entityId) || !isString(meeting.revisionId)) {
    return { status: 'invalid', reason: 'span-meeting-ref' }
  }
  if (!isString(value.segmentId) || typeof value.segmentRevision !== 'number') {
    return { status: 'invalid', reason: 'span-segment' }
  }
  if (typeof value.startMs !== 'number' || typeof value.endMs !== 'number' || typeof value.quote !== 'string') {
    return { status: 'invalid', reason: 'span-range' }
  }
  return value as EvidenceSpan
}

export function parseTranscriptSegment(value: unknown): TranscriptSegment | SchemaParseError {
  if (!isRecord(value)) return { status: 'invalid', reason: 'segment-not-object' }
  if (!isString(value.meetingId) || !isString(value.streamId) || !isString(value.id)) {
    return { status: 'invalid', reason: 'segment-ids' }
  }
  if (typeof value.revision !== 'number' || typeof value.sequence !== 'number') {
    return { status: 'invalid', reason: 'segment-revision' }
  }
  if (!TRANSCRIPT_SOURCES.includes(value.source as TranscriptSegment['source'])) {
    return { status: 'invalid', reason: 'segment-source' }
  }
  if (typeof value.text !== 'string' || typeof value.final !== 'boolean') {
    return { status: 'invalid', reason: 'segment-text' }
  }
  return value as TranscriptSegment
}

export function parseProposal(value: unknown): MeetingProposal | SchemaParseError {
  if (!isRecord(value)) return { status: 'invalid', reason: 'proposal-not-object' }
  if (!isString(value.id) || !isString(value.workspaceId) || !isString(value.meetingId)) {
    return { status: 'invalid', reason: 'proposal-ids' }
  }
  if (!isString(value.payloadHash) || !PROPOSAL_STATUSES.includes(value.status as MeetingProposal['status'])) {
    return { status: 'invalid', reason: 'proposal-status' }
  }
  if (!isRecord(value.payload)) return { status: 'invalid', reason: 'proposal-payload' }
  return value as MeetingProposal
}

export function parseOperationResultV2(value: unknown): OperationResultV2 | SchemaParseError | SchemaBlocked {
  if (!isRecord(value)) return { status: 'invalid', reason: 'result-not-object' }
  const version = value.schemaVersion
  if (version !== OPERATION_RESULT_V2_SCHEMA) {
    if (typeof version === 'number' && version > OPERATION_RESULT_V2_SCHEMA) {
      return { status: 'blocked', reason: 'unsupported-schema', version }
    }
    return { status: 'invalid', reason: 'result-schema' }
  }
  if (!OPERATION_MODES.includes(value.mode as OperationResultV2['mode'])) {
    return { status: 'invalid', reason: 'result-mode' }
  }
  if (!OPERATION_LIFECYCLES.includes(value.lifecycle as OperationResultV2['lifecycle'])) {
    return { status: 'invalid', reason: 'result-lifecycle' }
  }
  if (!VERIFICATION_STATES.includes(value.verification as OperationResultV2['verification'])) {
    return { status: 'invalid', reason: 'result-verification' }
  }
  if (!isString(value.operationId)) return { status: 'invalid', reason: 'result-operationId' }
  return value as OperationResultV2
}

export function assertWritableSchema(value: unknown): void {
  const parsed = parseMeeting(value)
  if ('status' in parsed && parsed.status === 'blocked') {
    throw new Error(`unsupported meeting schema ${parsed.version}`)
  }
  if ('status' in parsed && parsed.status === 'invalid') {
    throw new Error(parsed.reason)
  }
}
