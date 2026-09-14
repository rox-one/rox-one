import type { MeetingProposal, OperationResultV2 } from '@craft-agent/core/meetings'
import { authorizeMeetingAction, type MeetingGrant } from '@craft-agent/shared/meeting-agents'

export type OutboxJob = {
  operationId: string
  proposalId: string
  idempotencyKey: string
  leaseUntil?: number
  status: 'queued' | 'running' | 'unknown' | 'done'
  entityId?: string
  revision?: string
}

export type ExecutorHooks = {
  apply: (proposal: MeetingProposal) => { entityId: string; revision: string }
  readback: (entityId: string) => { entityId: string; revision: string } | null
}

/**
 * In-memory native apply/readback is not a live production receipt.
 * Local apply still runs; stamps stay fixture, never verified/production.
 */
function nativeLocalResult(
  rest: Omit<OperationResultV2, 'schemaVersion' | 'mode'>,
): OperationResultV2 {
  return { schemaVersion: 2, mode: 'fixture', ...rest }
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
    return nativeLocalResult({
      lifecycle: 'succeeded',
      verification: 'pending',
      operationId: existing.operationId,
      entityRef: existing.entityId
        ? {
            workspaceId: input.proposal.workspaceId,
            entityId: existing.entityId,
            revisionId: existing.revision ?? '',
          }
        : undefined,
      receipt: existing.entityId
        ? { provider: 'native', remoteId: existing.entityId, observedRevision: existing.revision }
        : undefined,
    })
  }
  if (input.proposal.status !== 'approved') {
    return nativeLocalResult({
      lifecycle: 'failed',
      verification: 'not_requested',
      operationId: input.proposal.id,
      error: { code: 'not-approved', retryable: false, safeMessage: 'Proposal is not approved' },
    })
  }
  if (input.revoke || input.grant?.revokedAt != null) {
    return nativeLocalResult({
      lifecycle: 'cancelled',
      verification: 'not_requested',
      operationId: input.proposal.id,
      error: { code: 'revoked', retryable: false, safeMessage: 'Grant revoked' },
    })
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
    return nativeLocalResult({
      lifecycle: 'failed',
      verification: 'not_requested',
      operationId: input.proposal.id,
      error: { code: auth.code, retryable: false, safeMessage: auth.code },
    })
  }
  if (input.crashBeforeApply) {
    return nativeLocalResult({
      lifecycle: 'unknown',
      verification: 'unknown',
      operationId: input.proposal.id,
    })
  }
  const applied = input.hooks.apply(input.proposal)
  if (input.crashAfterApply) {
    return nativeLocalResult({
      lifecycle: 'unknown',
      verification: 'unknown',
      operationId: input.proposal.id,
      entityRef: { workspaceId: input.proposal.workspaceId, entityId: applied.entityId, revisionId: applied.revision },
    })
  }
  const seen = input.hooks.readback(applied.entityId)
  if (!seen || seen.entityId !== applied.entityId || seen.revision !== applied.revision) {
    return nativeLocalResult({
      lifecycle: 'succeeded',
      verification: 'mismatch',
      operationId: input.proposal.id,
      error: { code: 'readback-mismatch', retryable: false, safeMessage: 'Readback did not match' },
    })
  }
  input.jobs.push({
    operationId: input.proposal.id,
    proposalId: input.proposal.id,
    idempotencyKey: input.proposal.id,
    status: 'done',
    entityId: applied.entityId,
    revision: applied.revision,
  })
  return nativeLocalResult({
    lifecycle: 'succeeded',
    verification: 'pending',
    operationId: input.proposal.id,
    entityRef: { workspaceId: input.proposal.workspaceId, entityId: applied.entityId, revisionId: applied.revision },
    receipt: { provider: 'native', remoteId: applied.entityId, observedRevision: seen.revision },
  })
}
