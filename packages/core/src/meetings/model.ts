/**
 * Meeting is a specialization of a call, not an agent session (issue #357 / I001).
 * V2 results split mode / lifecycle / verification. Legacy live is unknown.
 */

import {
  decodeRox2V2Result,
  externalBindingKey,
  isVerifiedEffect,
  type Rox2EntityRef,
  type Rox2ExternalBinding,
  type Rox2V2Result,
} from '../rox2/platform-contract.ts'

export const MEETING_SCHEMA_VERSION = 2 as const

export type EvidenceSpan = {
  id: string
  sourceRevisionId: string
  startMs: number
  endMs: number
  text?: string
}

export type MeetingCausation = {
  commandId: string
  evidenceIds: readonly string[]
}

export type Meeting = {
  schemaVersion: typeof MEETING_SCHEMA_VERSION
  kind: 'meeting'
  ref: Rox2EntityRef
  title: string
  callBinding?: Rox2ExternalBinding
  sourceRevisions: Record<string, string>
  createdAt: number
  updatedAt: number
}

export type MeetingProposal = {
  schemaVersion: typeof MEETING_SCHEMA_VERSION
  kind: 'proposal'
  ref: Rox2EntityRef
  meetingId: string
  action: string
  payload: Record<string, unknown>
  causation: MeetingCausation
  sourceRevisions: Record<string, string>
}

export type MeetingOperation = {
  schemaVersion: typeof MEETING_SCHEMA_VERSION
  kind: 'operation'
  ref: Rox2EntityRef
  proposalId: string
  type: string
  payloadHash: string
  causation: { commandId: string; proposalRevisionId: string }
}

export type MeetingRecord = Meeting | MeetingProposal | MeetingOperation

export { decodeRox2V2Result, isVerifiedEffect }
export type { Rox2V2Result }

export function meetingBindingKey(binding: Rox2ExternalBinding): string {
  return externalBindingKey(binding)
}

export function verifiedMeetingResult(entityId: string): Rox2V2Result {
  return {
    ok: true,
    mode: 'live',
    lifecycle: 'applied',
    verification: 'verified',
    entityId,
  }
}

export function unknownLiveResult(entityId: string): Rox2V2Result {
  return decodeRox2V2Result({ ok: true, state: 'live', entityId })
}
