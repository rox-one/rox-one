/**
 * Approve a meeting proposal, then execute native apply through persist.
 * Not live Conation. Fail-closed when grant, outbox, or configDir is missing:
 * nothing is applied and revision is not invented.
 */
import type { MeetingProposal, OperationResultV2 } from '@craft-agent/core/meetings'
import type { MeetingGrant } from '@craft-agent/shared/meeting-agents'
import { applyNativeMeetingAction, createNativeActionHarness, readbackNative } from './native-actions.ts'
import { executeApprovedProposal, type OutboxJob } from './executor.ts'
import { approveMeetingProposal, type ProposalStore } from './proposals.ts'

export type NativeExecuteRuntime = ReturnType<typeof createNativeActionHarness>

export type ApproveExecuteResult = {
  proposal: MeetingProposal
  operation: OperationResultV2
}

export type ApproveAndExecuteInput = {
  store: ProposalStore
  proposalId: string
  actorId: string
  grant: MeetingGrant | null
  payload: Record<string, unknown>
  jobs: OutboxJob[] | null
  persistRootDir: string | null
  runtime?: NativeExecuteRuntime
  now?: number
}

function failOperation(operationId: string, code: string): OperationResultV2 {
  return {
    schemaVersion: 2,
    mode: 'production',
    lifecycle: 'failed',
    verification: 'not_requested',
    operationId,
    error: { code, retryable: false, safeMessage: code },
  }
}

function isNativeKind(type: MeetingProposal['type']): boolean {
  return type === 'create_task' || type === 'create_note'
}

export function approveAndExecuteNative(input: ApproveAndExecuteInput): ApproveExecuteResult {
  const found = input.store.items.find((item) => item.id === input.proposalId)
  if (!found) throw new Error('proposal not found')
  if (!input.grant) {
    return { proposal: found, operation: failOperation(found.id, 'grant-required') }
  }
  let proposal: MeetingProposal
  try {
    proposal = approveMeetingProposal({
      store: input.store,
      proposalId: input.proposalId,
      actorId: input.actorId,
      grant: input.grant,
      payload: input.payload,
      now: input.now,
    })
  } catch (error) {
    const code = error instanceof Error ? error.message : 'approve-failed'
    return { proposal: found, operation: failOperation(found.id, code) }
  }
  if (input.jobs == null) {
    return { proposal, operation: failOperation(proposal.id, 'outbox-required') }
  }
  if (!input.persistRootDir) {
    return { proposal, operation: failOperation(proposal.id, 'config-dir-required') }
  }
  if (!isNativeKind(proposal.type)) {
    return { proposal, operation: failOperation(proposal.id, 'unsupported-native-kind') }
  }
  const runtime = input.runtime ?? createNativeActionHarness(input.persistRootDir)
  const operation = executeApprovedProposal({
    proposal,
    grant: input.grant,
    actorId: input.actorId,
    deviceId: input.grant.deviceId,
    jobs: input.jobs,
    hooks: {
      apply: (next) => applyNativeMeetingAction(next, runtime.notes, runtime.tasks, runtime.seen, runtime.persist),
      readback: (entityId) => readbackNative(entityId, runtime.notes, runtime.tasks, runtime.persist),
    },
    now: input.now,
  })
  if (operation.verification === 'verified') {
    proposal.status = 'applied'
    proposal.operationId = operation.operationId
  }
  return { proposal, operation }
}
