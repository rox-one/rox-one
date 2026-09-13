import { createHash } from 'node:crypto'
import type { MeetingProposal } from '@craft-agent/core/meetings'
import { authorizeMeetingAction, type MeetingGrant } from '@craft-agent/shared/meeting-agents'

export type ProposalStore = {
  items: MeetingProposal[]
}

export function payloadHash(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

export function approveMeetingProposal(input: {
  store: ProposalStore
  proposalId: string
  actorId: string
  grant: MeetingGrant | null
  payload: Record<string, unknown>
  now?: number
}): MeetingProposal {
  const proposal = input.store.items.find((item) => item.id === input.proposalId)
  if (!proposal) throw new Error('proposal not found')
  if (proposal.status === 'rejected') throw new Error('rejected')
  if (proposal.status === 'approved' || proposal.status === 'applied') return proposal
  const auth = authorizeMeetingAction(input.grant, {
    actorId: input.actorId,
    workspaceId: proposal.workspaceId,
    deviceId: input.grant?.deviceId ?? '',
    capability: 'send',
    operation: 'approve',
    payloadHash: payloadHash(input.payload),
    now: input.now,
  })
  if (!auth.ok) throw new Error(auth.code)
  const hash = payloadHash(input.payload)
  if (hash !== proposal.payloadHash) throw new Error('payload-changed')
  proposal.status = 'approved'
  proposal.approvedAt = input.now
  proposal.approvedBy = input.actorId
  proposal.approvedPayloadHash = hash
  return proposal
}

export function rejectMeetingProposal(store: ProposalStore, proposalId: string): MeetingProposal {
  const proposal = store.items.find((item) => item.id === proposalId)
  if (!proposal) throw new Error('proposal not found')
  proposal.status = 'rejected'
  return proposal
}

export function editMeetingProposal(store: ProposalStore, proposalId: string, payload: Record<string, unknown>): MeetingProposal {
  const proposal = store.items.find((item) => item.id === proposalId)
  if (!proposal) throw new Error('proposal not found')
  if (proposal.status === 'approved') proposal.status = 'stale'
  proposal.payload = payload
  proposal.payloadHash = payloadHash(payload)
  return proposal
}
