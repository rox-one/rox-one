/**
 * Proposal inbox: approve a specific payload version (issue #365).
 * Approved is not applied. Edit / stale source / revoke invalidates approval.
 */

import { createHash } from 'node:crypto'
import { authorizeMeetingAction, type MeetingGrant } from '@craft-agent/shared/meeting-agents'

export type InboxProposal = {
  id: string
  workspaceId: string
  meetingId: string
  status: 'proposed' | 'needs_clarification' | 'approved' | 'rejected' | 'stale' | 'executing' | 'applied' | 'failed'
  payload: Record<string, unknown>
  payloadHash: string
  sourceRevision: number
  target?: string
  approvedBy?: string
  approvedPayloadHash?: string
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex')
}

export class ProposalInbox {
  private proposals = new Map<string, InboxProposal>()

  restore(items: readonly InboxProposal[]): void {
    this.proposals.clear()
    for (const item of items) this.proposals.set(item.id, structuredClone(item))
  }

  list(): InboxProposal[] {
    return [...this.proposals.values()].map((item) => structuredClone(item))
  }

  get(id: string): InboxProposal | undefined {
    const found = this.proposals.get(id)
    return found ? structuredClone(found) : undefined
  }

  put(proposal: Omit<InboxProposal, 'payloadHash' | 'status'> & { status?: InboxProposal['status'] }): InboxProposal {
    const stored: InboxProposal = {
      ...proposal,
      status: proposal.status ?? 'proposed',
      payloadHash: hash(proposal.payload),
    }
    this.proposals.set(stored.id, stored)
    return structuredClone(stored)
  }

  edit(id: string, payload: Record<string, unknown>): InboxProposal {
    const current = this.require(id)
    current.payload = payload
    current.payloadHash = hash(payload)
    if (current.status === 'approved') current.status = 'proposed'
    current.approvedBy = undefined
    current.approvedPayloadHash = undefined
    this.proposals.set(id, current)
    return structuredClone(current)
  }

  markStaleIfSourceChanged(id: string, currentSourceRevision: number): InboxProposal {
    const current = this.require(id)
    if (currentSourceRevision !== current.sourceRevision && current.status !== 'applied') {
      current.status = 'stale'
      current.approvedBy = undefined
      current.approvedPayloadHash = undefined
    }
    this.proposals.set(id, current)
    return structuredClone(current)
  }

  reject(id: string): InboxProposal {
    const current = this.require(id)
    current.status = 'rejected'
    this.proposals.set(id, current)
    return structuredClone(current)
  }

  clarify(id: string): InboxProposal {
    const current = this.require(id)
    if (current.status === 'rejected' || current.status === 'applied') {
      throw new Error(`Proposal ${current.status} cannot be clarified`)
    }
    current.status = 'needs_clarification'
    current.approvedBy = undefined
    current.approvedPayloadHash = undefined
    this.proposals.set(id, current)
    return structuredClone(current)
  }

  approve(input: {
    proposalId: string
    actorId: string
    workspaceId: string
    deviceId: string
    payloadHash: string
    now: number
    grants: readonly MeetingGrant[]
  }): InboxProposal {
    const current = this.require(input.proposalId)
    if (current.status === 'rejected' || current.status === 'stale' || current.status === 'applied') {
      throw new Error(`Proposal ${current.status} cannot be approved`)
    }
    if (current.payloadHash !== input.payloadHash) {
      throw new Error('Approval payload hash does not match')
    }
    const authz = authorizeMeetingAction({
      actor: {
        accountId: input.actorId,
        workspaceId: input.workspaceId,
        deviceId: input.deviceId,
        authenticated: true,
      },
      capability: 'action.external',
      operation: 'approve-proposal',
      source: 'external',
      target: current.target,
      payloadHash: input.payloadHash,
      now: input.now,
      permissionMode: 'ask',
      grants: input.grants,
    })
    if (!authz.ok) throw new Error(authz.code)
    if (current.status === 'approved' && current.approvedPayloadHash === input.payloadHash) {
      return structuredClone(current)
    }
    current.status = 'approved'
    current.approvedBy = input.actorId
    current.approvedPayloadHash = input.payloadHash
    this.proposals.set(current.id, current)
    return structuredClone(current)
  }

  markApplied(id: string): InboxProposal {
    const current = this.require(id)
    current.status = 'applied'
    this.proposals.set(id, current)
    return structuredClone(current)
  }

  markExecuting(id: string): InboxProposal {
    const current = this.require(id)
    current.status = 'executing'
    this.proposals.set(id, current)
    return structuredClone(current)
  }

  private require(id: string): InboxProposal {
    const current = this.proposals.get(id)
    if (!current) throw new Error(`Unknown proposal ${id}`)
    return current
  }
}

export type ApproveMeetingProposalInput = {
  proposalId: string
  actorId: string
  workspaceId: string
  deviceId: string
  payloadHash: string
  baseRevision: number
  target?: string
  now: number
  grants: readonly MeetingGrant[]
}

export type BatchApproveResult = {
  proposalId: string
  ok: boolean
  proposal?: InboxProposal
  error?: string
}

/** Approve a specific payload version. Approved is not applied. */
export function approveMeetingProposal(
  inbox: ProposalInbox,
  input: ApproveMeetingProposalInput,
): InboxProposal {
  const current = inbox.get(input.proposalId)
  if (!current) throw new Error('Unknown proposal')
  if (current.sourceRevision !== input.baseRevision) {
    return inbox.markStaleIfSourceChanged(input.proposalId, input.baseRevision)
  }
  if (input.target !== undefined && current.target !== input.target) {
    throw new Error('Approval target does not match')
  }
  return inbox.approve(input)
}

/** Batch approve is N validated operations, not a global allow-all. */
export function approveMeetingProposals(
  inbox: ProposalInbox,
  items: readonly ApproveMeetingProposalInput[],
): BatchApproveResult[] {
  return items.map((item) => {
    try {
      return { proposalId: item.proposalId, ok: true, proposal: approveMeetingProposal(inbox, item) }
    } catch (error) {
      return {
        proposalId: item.proposalId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  })
}
