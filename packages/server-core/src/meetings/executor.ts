import type { MeetingProposal, OperationResultV2 } from '@craft-agent/core/meetings'
import { authorizeMeetingAction, type MeetingGrant } from '@craft-agent/shared/meeting-agents'

export type OutboxJob = {
  operationId: string
  proposalId: string
  idempotencyKey: string
  leaseUntil?: number
  status: 'queued' | 'running' | 'unknown' | 'done'
}

export type ExecutorHooks = {
  apply: (proposal: MeetingProposal) => { entityId: string; revision: string }
  readback: (entityId: string) => { entityId: string; revision: string } | null
}

export function executeApprovedProposal(input: {
  proposal: MeetingProposal
  grant: MeetingGrant | null
  actorId: string
  deviceId: string
  jobs: OutboxJob[]
  hooks: ExecutorHooks
  now?: number
  crashAfterApply?: boolean
  crashBeforeApply?: boolean
  revoke?: boolean
}): OperationResultV2 {
  const existing = input.jobs.find((job) => job.idempotencyKey === input.proposal.id)
  if (existing?.status === 'done') {
    return {
      schemaVersion: 2,
      mode: 'production',
      lifecycle: 'succeeded',
      verification: 'verified',
      operationId: existing.operationId,
    }
  }
  if (input.proposal.status !== 'approved') {
    return {
      schemaVersion: 2,
      mode: 'production',
      lifecycle: 'failed',
      verification: 'not_requested',
      operationId: input.proposal.id,
      error: { code: 'not-approved', retryable: false, safeMessage: 'Proposal is not approved' },
    }
  }
  if (input.revoke || input.grant?.revokedAt != null) {
    return {
      schemaVersion: 2,
      mode: 'production',
      lifecycle: 'cancelled',
      verification: 'not_requested',
      operationId: input.proposal.id,
      error: { code: 'revoked', retryable: false, safeMessage: 'Grant revoked' },
    }
  }
  const auth = authorizeMeetingAction(input.grant, {
    actorId: input.actorId,
    workspaceId: input.proposal.workspaceId,
    deviceId: input.deviceId,
    capability: 'send',
    operation: 'execute',
    payloadHash: input.proposal.approvedPayloadHash,
    now: input.now,
  })
  if (!auth.ok) {
    return {
      schemaVersion: 2,
      mode: 'production',
      lifecycle: 'failed',
      verification: 'not_requested',
      operationId: input.proposal.id,
      error: { code: auth.code, retryable: false, safeMessage: auth.code },
    }
  }
  if (input.crashBeforeApply) {
    return {
      schemaVersion: 2,
      mode: 'production',
      lifecycle: 'unknown',
      verification: 'unknown',
      operationId: input.proposal.id,
    }
  }
  const applied = input.hooks.apply(input.proposal)
  if (input.crashAfterApply) {
    return {
      schemaVersion: 2,
      mode: 'production',
      lifecycle: 'unknown',
      verification: 'unknown',
      operationId: input.proposal.id,
      entityRef: { workspaceId: input.proposal.workspaceId, entityId: applied.entityId, revisionId: applied.revision },
    }
  }
  const seen = input.hooks.readback(applied.entityId)
  if (!seen || seen.entityId !== applied.entityId) {
    return {
      schemaVersion: 2,
      mode: 'production',
      lifecycle: 'succeeded',
      verification: 'mismatch',
      operationId: input.proposal.id,
      error: { code: 'readback-mismatch', retryable: false, safeMessage: 'Readback did not match' },
    }
  }
  input.jobs.push({
    operationId: input.proposal.id,
    proposalId: input.proposal.id,
    idempotencyKey: input.proposal.id,
    status: 'done',
  })
  return {
    schemaVersion: 2,
    mode: 'production',
    lifecycle: 'succeeded',
    verification: 'verified',
    operationId: input.proposal.id,
    entityRef: { workspaceId: input.proposal.workspaceId, entityId: applied.entityId, revisionId: applied.revision },
    receipt: { provider: 'native', remoteId: applied.entityId, observedRevision: seen.revision },
  }
}
