/**
 * Durable meeting executor with outbox, leases, receipts, and readback (issue #366).
 * HTTP 202 / transport success is not verified. Crash after a possible effect stays unknown.
 */

import { createHash } from 'node:crypto'
import { authorizeMeetingAction, type MeetingGrant } from '@craft-agent/shared/meeting-agents'
import { decodeRox2V2Result, isVerifiedEffect, type Rox2V2Result } from '@craft-agent/core/rox2'
import type { InboxProposal } from './proposals.ts'

export type OutboxJob = {
  operationId: string
  idempotencyKey: string
  proposalId: string
  payloadHash: string
  status: 'pending' | 'leased' | 'acked' | 'failed' | 'unknown'
  leaseUntil?: number
  receipt?: { provider: string; remoteId?: string; requestId?: string }
  result?: Rox2V2Result
}

export type EffectAdapter = {
  idempotent: boolean
  execute(input: { operationId: string; payload: Record<string, unknown> }): Promise<{
    remoteId: string
    requestId: string
    fields: Record<string, unknown>
  }>
  readback?(remoteId: string): Promise<Record<string, unknown>>
}

export type ExecuteInput = {
  proposal: InboxProposal
  actorId: string
  workspaceId: string
  deviceId: string
  now: number
  grants: readonly MeetingGrant[]
  expectedFields?: Record<string, unknown>
  crashAfterEffect?: boolean
  crashBeforeEffect?: boolean
}

export class MeetingExecutor {
  private jobs = new Map<string, OutboxJob>()
  private effects = 0

  constructor(private readonly adapter: EffectAdapter) {}

  restore(jobs: readonly OutboxJob[]): void {
    this.jobs.clear()
    for (const job of jobs) this.jobs.set(job.idempotencyKey, structuredClone(job))
  }

  list(): OutboxJob[] {
    return [...this.jobs.values()].map((job) => structuredClone(job))
  }

  effectCount(): number {
    return this.effects
  }

  async executeApprovedProposal(input: ExecuteInput): Promise<OutboxJob> {
    if (input.proposal.status !== 'approved' && input.proposal.status !== 'executing') {
      throw new Error('Only approved proposals may execute')
    }
    const idempotencyKey = `${input.proposal.id}:${input.proposal.payloadHash}`
    const existing = this.jobs.get(idempotencyKey)
    if (existing && (existing.status === 'acked' || existing.status === 'unknown')) {
      return structuredClone(existing)
    }
    const authz = authorizeMeetingAction({
      actor: {
        accountId: input.actorId,
        workspaceId: input.workspaceId,
        deviceId: input.deviceId,
        authenticated: true,
      },
      capability: 'action.external',
      operation: 'execute-proposal',
      source: 'external',
      target: input.proposal.target,
      payloadHash: input.proposal.payloadHash,
      now: input.now,
      permissionMode: 'ask',
      grants: input.grants,
    })
    if (!authz.ok) {
      const denied: OutboxJob = {
        operationId: existing?.operationId ?? `op-${input.proposal.id}`,
        idempotencyKey,
        proposalId: input.proposal.id,
        payloadHash: input.proposal.payloadHash,
        status: 'failed',
        result: decodeRox2V2Result({ ok: false, state: 'queued', code: authz.code, message: authz.message }),
      }
      this.jobs.set(idempotencyKey, denied)
      return structuredClone(denied)
    }
    const job: OutboxJob = existing ?? {
      operationId: `op-${input.proposal.id}`,
      idempotencyKey,
      proposalId: input.proposal.id,
      payloadHash: input.proposal.payloadHash,
      status: 'pending',
    }
    if (input.crashBeforeEffect) {
      job.status = 'pending'
      this.jobs.set(idempotencyKey, job)
      return structuredClone(job)
    }
    job.status = 'leased'
    job.leaseUntil = input.now + 30_000
    this.jobs.set(idempotencyKey, job)
    try {
      const effect = await this.adapter.execute({
        operationId: job.operationId,
        payload: input.proposal.payload,
      })
      this.effects += 1
      job.receipt = { provider: 'native', remoteId: effect.remoteId, requestId: effect.requestId }
      if (input.crashAfterEffect) {
        job.status = 'unknown'
        job.result = decodeRox2V2Result({ ok: true, state: 'live', entityId: effect.remoteId })
        this.jobs.set(idempotencyKey, job)
        return structuredClone(job)
      }
      const observed = this.adapter.readback ? await this.adapter.readback(effect.remoteId) : effect.fields
      const mismatch = input.expectedFields
        ? Object.entries(input.expectedFields).some(([key, value]) => observed[key] !== value)
        : false
      if (mismatch) {
        job.status = 'failed'
        job.result = {
          ok: true,
          mode: 'live',
          lifecycle: 'applied',
          verification: 'unverified',
          entityId: effect.remoteId,
          code: 'readback-mismatch',
        }
        this.jobs.set(idempotencyKey, job)
        return structuredClone(job)
      }
      job.status = 'acked'
      job.result = {
        ok: true,
        mode: 'live',
        lifecycle: 'applied',
        verification: 'verified',
        entityId: effect.remoteId,
      }
      if (!isVerifiedEffect(job.result)) {
        throw new Error('Verified result contract broken')
      }
      this.jobs.set(idempotencyKey, job)
      return structuredClone(job)
    } catch (error) {
      if (!this.adapter.idempotent && job.receipt) {
        job.status = 'unknown'
        this.jobs.set(idempotencyKey, job)
        return structuredClone(job)
      }
      job.status = 'failed'
      job.result = decodeRox2V2Result({
        ok: false,
        state: 'queued',
        code: 'execute-failed',
        message: error instanceof Error ? error.message : 'execute failed',
      })
      this.jobs.set(idempotencyKey, job)
      return structuredClone(job)
    }
  }
}

export function operationFingerprint(proposalId: string, payloadHash: string): string {
  return createHash('sha256').update(`${proposalId}:${payloadHash}`, 'utf8').digest('hex')
}
