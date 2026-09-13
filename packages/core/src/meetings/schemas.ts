import { MEETING_SCHEMA_VERSION, type EvidenceSpan, type Meeting, type MeetingOperation, type MeetingProposal } from './model.ts'
import type { Rox2EntityRef, Rox2ExternalBinding } from '../rox2/platform-contract.ts'

export class MeetingSchemaError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'MeetingSchemaError'
  }
}

function asRef(value: unknown): Rox2EntityRef {
  if (!value || typeof value !== 'object') {
    throw new MeetingSchemaError('invalid-ref', 'Entity ref is required')
  }
  const ref = value as Record<string, unknown>
  if (typeof ref.workspaceId !== 'string' || !ref.workspaceId) {
    throw new MeetingSchemaError('invalid-ref', 'workspaceId is required')
  }
  if (typeof ref.entityId !== 'string' || !ref.entityId) {
    throw new MeetingSchemaError('invalid-ref', 'entityId is required')
  }
  if (typeof ref.revisionId !== 'string' || !ref.revisionId) {
    throw new MeetingSchemaError('invalid-ref', 'revisionId is required')
  }
  return { workspaceId: ref.workspaceId, entityId: ref.entityId, revisionId: ref.revisionId }
}

function asBinding(value: unknown): Rox2ExternalBinding | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object') {
    throw new MeetingSchemaError('invalid-binding', 'callBinding is invalid')
  }
  const binding = value as Record<string, unknown>
  if (
    typeof binding.provider !== 'string' || !binding.provider
    || typeof binding.account !== 'string' || !binding.account
    || typeof binding.remoteType !== 'string' || !binding.remoteType
    || typeof binding.remoteId !== 'string' || !binding.remoteId
  ) {
    throw new MeetingSchemaError('invalid-binding', 'callBinding is incomplete')
  }
  return {
    provider: binding.provider,
    account: binding.account,
    remoteType: binding.remoteType,
    remoteId: binding.remoteId,
  }
}

function asRevisions(value: unknown): Record<string, string> {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new MeetingSchemaError('invalid-revisions', 'sourceRevisions must be an object')
  }
  const out: Record<string, string> = {}
  for (const [key, revision] of Object.entries(value as Record<string, unknown>)) {
    if (typeof revision !== 'string' || !revision) {
      throw new MeetingSchemaError('invalid-revisions', `source revision ${key} is invalid`)
    }
    out[key] = revision
  }
  return out
}

function requireSchema(raw: Record<string, unknown>): void {
  if (raw.schemaVersion !== MEETING_SCHEMA_VERSION) {
    throw new MeetingSchemaError('unknown-schema-version', 'Unknown meeting schema version')
  }
}

export function parseEvidenceSpan(raw: unknown): EvidenceSpan {
  if (!raw || typeof raw !== 'object') {
    throw new MeetingSchemaError('invalid-span', 'Evidence span is required')
  }
  const obj = raw as Record<string, unknown>
  if (typeof obj.id !== 'string' || !obj.id) {
    throw new MeetingSchemaError('invalid-span', 'Evidence span id is required')
  }
  if (typeof obj.sourceRevisionId !== 'string' || !obj.sourceRevisionId) {
    throw new MeetingSchemaError('invalid-span', 'Evidence span sourceRevisionId is required')
  }
  if (typeof obj.startMs !== 'number' || !Number.isFinite(obj.startMs) || obj.startMs < 0) {
    throw new MeetingSchemaError('invalid-span', 'Evidence span startMs is invalid')
  }
  if (typeof obj.endMs !== 'number' || !Number.isFinite(obj.endMs) || obj.endMs < obj.startMs) {
    throw new MeetingSchemaError('invalid-span', 'Evidence span endMs is invalid')
  }
  return {
    id: obj.id,
    sourceRevisionId: obj.sourceRevisionId,
    startMs: obj.startMs,
    endMs: obj.endMs,
    text: typeof obj.text === 'string' ? obj.text : undefined,
  }
}

export function parseMeeting(raw: unknown): Meeting {
  if (!raw || typeof raw !== 'object') {
    throw new MeetingSchemaError('invalid-meeting', 'Meeting is required')
  }
  const obj = raw as Record<string, unknown>
  requireSchema(obj)
  if (obj.kind !== 'meeting') {
    throw new MeetingSchemaError('invalid-kind', 'Meeting kind must be meeting')
  }
  if (typeof obj.title !== 'string' || !obj.title.trim()) {
    throw new MeetingSchemaError('invalid-title', 'Meeting title is required')
  }
  if (typeof obj.createdAt !== 'number' || !Number.isFinite(obj.createdAt)) {
    throw new MeetingSchemaError('invalid-date', 'createdAt is invalid')
  }
  if (typeof obj.updatedAt !== 'number' || !Number.isFinite(obj.updatedAt)) {
    throw new MeetingSchemaError('invalid-date', 'updatedAt is invalid')
  }
  return {
    schemaVersion: MEETING_SCHEMA_VERSION,
    kind: 'meeting',
    ref: asRef(obj.ref),
    title: obj.title.trim(),
    callBinding: asBinding(obj.callBinding),
    sourceRevisions: asRevisions(obj.sourceRevisions),
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
  }
}

export function parseProposal(raw: unknown): MeetingProposal {
  if (!raw || typeof raw !== 'object') {
    throw new MeetingSchemaError('invalid-proposal', 'Proposal is required')
  }
  const obj = raw as Record<string, unknown>
  requireSchema(obj)
  if (obj.kind !== 'proposal') {
    throw new MeetingSchemaError('invalid-kind', 'Proposal kind must be proposal')
  }
  if (typeof obj.meetingId !== 'string' || !obj.meetingId) {
    throw new MeetingSchemaError('invalid-proposal', 'meetingId is required')
  }
  if (typeof obj.action !== 'string' || !obj.action) {
    throw new MeetingSchemaError('invalid-proposal', 'action is required')
  }
  const causation = obj.causation && typeof obj.causation === 'object'
    ? obj.causation as Record<string, unknown>
    : null
  if (!causation || typeof causation.commandId !== 'string' || !causation.commandId) {
    throw new MeetingSchemaError('invalid-causation', 'proposal causation.commandId is required')
  }
  const evidenceIds = Array.isArray(causation.evidenceIds)
    ? causation.evidenceIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : []
  const payload = obj.payload && typeof obj.payload === 'object' && !Array.isArray(obj.payload)
    ? { ...(obj.payload as Record<string, unknown>) }
    : {}
  return {
    schemaVersion: MEETING_SCHEMA_VERSION,
    kind: 'proposal',
    ref: asRef(obj.ref),
    meetingId: obj.meetingId,
    action: obj.action,
    payload,
    causation: { commandId: causation.commandId, evidenceIds },
    sourceRevisions: asRevisions(obj.sourceRevisions),
  }
}

export function parseOperation(raw: unknown): MeetingOperation {
  if (!raw || typeof raw !== 'object') {
    throw new MeetingSchemaError('invalid-operation', 'Operation is required')
  }
  const obj = raw as Record<string, unknown>
  requireSchema(obj)
  if (obj.kind !== 'operation') {
    throw new MeetingSchemaError('invalid-kind', 'Operation kind must be operation')
  }
  if (typeof obj.proposalId !== 'string' || !obj.proposalId) {
    throw new MeetingSchemaError('invalid-operation', 'proposalId is required')
  }
  if (typeof obj.type !== 'string' || !obj.type) {
    throw new MeetingSchemaError('invalid-operation', 'type is required')
  }
  if (typeof obj.payloadHash !== 'string' || !obj.payloadHash) {
    throw new MeetingSchemaError('invalid-operation', 'payloadHash is required')
  }
  const causation = obj.causation && typeof obj.causation === 'object'
    ? obj.causation as Record<string, unknown>
    : null
  if (
    !causation
    || typeof causation.commandId !== 'string' || !causation.commandId
    || typeof causation.proposalRevisionId !== 'string' || !causation.proposalRevisionId
  ) {
    throw new MeetingSchemaError('invalid-causation', 'operation causation is incomplete')
  }
  return {
    schemaVersion: MEETING_SCHEMA_VERSION,
    kind: 'operation',
    ref: asRef(obj.ref),
    proposalId: obj.proposalId,
    type: obj.type,
    payloadHash: obj.payloadHash,
    causation: {
      commandId: causation.commandId,
      proposalRevisionId: causation.proposalRevisionId,
    },
  }
}
