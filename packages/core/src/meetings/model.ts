/**
 * Meeting Agents domain model (RMA-I001 / #357).
 * Meeting is a specialization of Rox2 `call`, not an agent session.
 * Does not perform I/O. Conation is not claimed live from these types.
 */

import { formatRox2EntityId, type Rox2EntityRef } from '../rox2/platform-contract.ts'

export const MEETING_SCHEMA_VERSION = 1
export const OPERATION_RESULT_V2_SCHEMA = 2
export const MEETING_KIND = 'call' as const

export const MEETING_STATUSES = [
  'planned',
  'permission_required',
  'capturing',
  'paused',
  'finalizing',
  'completed',
  'failed',
  'cancelled',
] as const

export type MeetingStatus = (typeof MEETING_STATUSES)[number]

export const TRANSCRIPT_SOURCES = ['microphone', 'system', 'import', 'room'] as const
export type TranscriptSource = (typeof TRANSCRIPT_SOURCES)[number]

export const PROPOSAL_STATUSES = [
  'proposed',
  'needs_clarification',
  'approved',
  'rejected',
  'stale',
  'executing',
  'applied',
  'failed',
] as const

export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number]

export const OPERATION_MODES = ['production', 'fixture', 'simulated'] as const
export type OperationMode = (typeof OPERATION_MODES)[number]

export const OPERATION_LIFECYCLES = [
  'queued',
  'waiting_approval',
  'waiting_device',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'unknown',
] as const

export type OperationLifecycle = (typeof OPERATION_LIFECYCLES)[number]

export const VERIFICATION_STATES = [
  'not_requested',
  'pending',
  'verified',
  'mismatch',
  'unknown',
] as const

export type VerificationState = (typeof VERIFICATION_STATES)[number]

export type MeetingEntityRef = Rox2EntityRef & { revisionId: string }

export type EvidenceSpan = {
  meeting: MeetingEntityRef
  segmentId: string
  segmentRevision: number
  startMs: number
  endMs: number
  quote: string
}

/**
 * Observe-only live capture (S6 / d2). A `MeetingSessionRecord` is the live
 * join state; it is not a Conation room and not verified provider audio.
 */
export const MEETING_SESSION_MODES = ['agent', 'bidi', 'transcribe', 'observe'] as const
export type MeetingSessionMode = (typeof MEETING_SESSION_MODES)[number]

export const MEETING_SESSION_TRANSPORTS = ['mic', 'chrome', 'chrome-node', 'twilio'] as const
export type MeetingSessionTransport = (typeof MEETING_SESSION_TRANSPORTS)[number]

export const MEETING_SESSION_STATES = [
  'idle',
  'joining',
  'in_call',
  'paused',
  'leaving',
  'ended',
  'failed',
  'blocked',
] as const
export type MeetingSessionState = (typeof MEETING_SESSION_STATES)[number]

/** Terminal states never transition again; a new session record must be opened. */
export const TERMINAL_SESSION_STATES = ['ended', 'failed', 'blocked'] as const

const SESSION_TRANSITIONS: Record<MeetingSessionState, readonly MeetingSessionState[]> = {
  idle: ['joining', 'failed', 'blocked'],
  joining: ['in_call', 'ended', 'failed', 'blocked'],
  in_call: ['paused', 'leaving', 'ended', 'failed'],
  paused: ['in_call', 'leaving', 'ended', 'failed'],
  leaving: ['ended', 'failed'],
  ended: [],
  failed: [],
  blocked: [],
}

export function isTerminalSessionState(state: MeetingSessionState): boolean {
  return (TERMINAL_SESSION_STATES as readonly MeetingSessionState[]).includes(state)
}

export function isActiveSessionState(state: MeetingSessionState): boolean {
  return state === 'joining' || state === 'in_call' || state === 'paused' || state === 'leaving'
}

export function canTransitionSession(from: MeetingSessionState, to: MeetingSessionState): boolean {
  return SESSION_TRANSITIONS[from].includes(to)
}

/** Keyed session lock: one live session per `transport:url`. */
export function sessionLockKey(transport: MeetingSessionTransport, url: string): string {
  return `${transport}:${url}`
}

export type MeetingCaptionSource = {
  id: string
  epoch: number
  revision: number
  finalized: boolean
  ownEcho?: boolean
}

/** Per-line provenance. `self` distinguishes our own speaker from a remote one. */
export type MeetingObservationProvenance = {
  observer: 'asr-stream' | 'browser-caption' | 'manual'
  observationId?: string
  sessionId?: string
  epoch?: number
  observedAt?: number
  speaker?: string | null
  self: 'self' | 'other' | 'unknown'
}

export type MeetingSessionRecord = {
  schemaVersion: typeof MEETING_SCHEMA_VERSION
  sessionId: string
  workspaceId: string
  meetingId: string
  transport: MeetingSessionTransport
  mode: MeetingSessionMode
  state: MeetingSessionState
  observer: boolean
  createdAt: number
  updatedAt: number
  joinedAt?: number
  endedAt?: number
  transcriptEvicted: boolean
  lineCount: number
  epoch: number
  cursor: { tailKeys: readonly string[] }
}

export type MeetingSessionSummary = {
  sessionId: string
  meetingId: string
  windowStartMs: number
  windowEndMs: number
  revision: number
  text: string
  sourceSegmentIds: readonly string[]
  generator: 'model' | 'heuristic'
  invalidatedByRevision?: number
  updatedAt: number
}

/** Bounded observe capture caps (d2.3). */
export const TRANSCRIPT_MAX_LINES = 2000
export const ENDED_TRANSCRIPTS_MAX = 4
export const TRANSCRIPT_CURSOR_TAIL = 64
export const CAPTURE_INTERVAL_MS = 5000
export const LIVE_SUMMARY_INTERVAL_MS = 300_000

export function emptyMeetingSession(input: {
  sessionId: string
  workspaceId: string
  meetingId: string
  transport: MeetingSessionTransport
  mode?: MeetingSessionMode
  observer?: boolean
  now?: number
}): MeetingSessionRecord {
  const now = input.now ?? 0
  return {
    schemaVersion: MEETING_SCHEMA_VERSION,
    sessionId: input.sessionId,
    workspaceId: input.workspaceId,
    meetingId: input.meetingId,
    transport: input.transport,
    mode: input.mode ?? 'observe',
    state: 'idle',
    observer: input.observer ?? true,
    createdAt: now,
    updatedAt: now,
    transcriptEvicted: false,
    lineCount: 0,
    epoch: 0,
    cursor: { tailKeys: [] },
  }
}

export type TranscriptSegment = {
  meetingId: string
  streamId: string
  id: string
  revision: number
  sequence: number
  startMs: number
  endMs: number
  source: TranscriptSource
  speakerId: string | null
  language: string | null
  text: string
  final: boolean
  supersedesRevision?: number
  /** Only `true` when agent/own audio is genuinely observable; omitted on mic-only capture. */
  ownEcho?: boolean
  provenance?: MeetingObservationProvenance
}

export type RelativeDue = {
  originalPhrase: string
  timeZone: string
  referenceInstant: string
  resolved: string | 'unresolved'
}

export type Meeting = {
  schemaVersion: typeof MEETING_SCHEMA_VERSION
  workspaceId: string
  meetingId: string
  entityId: string
  revision: number
  status: MeetingStatus
  title: string
  createdAt: number
  updatedAt: number
  archiveGranted: boolean
  sourceBinding?: {
    provider: string
    accountId: string
    remoteType: string
    remoteId: string
    remoteRevision?: string
  }
}

export type MeetingProposal = {
  id: string
  workspaceId: string
  meetingId: string
  type: 'create_task' | 'create_note' | 'knowledge_change' | 'artifact' | 'external'
  payload: Record<string, unknown>
  payloadHash: string
  status: ProposalStatus
  sourceSpans: readonly EvidenceSpan[]
  baseRevisions: Record<string, string>
  targetAccountId?: string
  expiry?: number
  approvedAt?: number
  approvedBy?: string
  approvedPayloadHash?: string
  operationId?: string
}

export type OperationReceipt = {
  provider: string
  remoteId?: string
  requestId?: string
  observedRevision?: string
  verifiedAt?: string
}

export type OperationResultV2 = {
  schemaVersion: typeof OPERATION_RESULT_V2_SCHEMA
  mode: OperationMode
  lifecycle: OperationLifecycle
  verification: VerificationState
  operationId: string
  entityRef?: MeetingEntityRef
  receipt?: OperationReceipt
  error?: { code: string; retryable: boolean; safeMessage: string }
}

/** Legacy Rox2 live is not verified. */
export type LegacyLiveResult = { ok: true; state: 'live'; entityId?: string }

export function meetingEntityId(meetingId: string): string {
  return formatRox2EntityId('call', meetingId)
}

export function segmentKey(segment: Pick<TranscriptSegment, 'streamId' | 'id'>): string {
  return `${segment.streamId}:${segment.id}`
}

export function meetingBindingKey(input: {
  workspaceId: string
  provider: string
  accountId: string
  remoteType: string
  remoteId: string
}): string {
  return `${input.workspaceId}:${input.provider}:${input.accountId}:${input.remoteType}:${input.remoteId}`
}

export function isUiVerified(result: OperationResultV2): boolean {
  return result.mode === 'production' && result.lifecycle === 'succeeded' && result.verification === 'verified'
}

/** Old `{ ok: true, state: 'live' }` is fixture, not production. Never UI-verified. */
export function decodeLegacyLiveResult(legacy: LegacyLiveResult, operationId: string): OperationResultV2 {
  return {
    schemaVersion: OPERATION_RESULT_V2_SCHEMA,
    mode: 'fixture',
    lifecycle: 'succeeded',
    verification: 'unknown',
    operationId,
    entityRef: legacy.entityId
      ? { workspaceId: '', entityId: legacy.entityId, revisionId: 'legacy' }
      : undefined,
  }
}

export function emptyMeeting(input: {
  workspaceId: string
  meetingId: string
  title?: string
  now?: number
}): Meeting {
  const now = input.now ?? 0
  return {
    schemaVersion: MEETING_SCHEMA_VERSION,
    workspaceId: input.workspaceId,
    meetingId: input.meetingId,
    entityId: meetingEntityId(input.meetingId),
    revision: 0,
    status: 'planned',
    title: input.title ?? '',
    createdAt: now,
    updatedAt: now,
    archiveGranted: false,
  }
}
