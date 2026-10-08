import type { MemoryProposal, MemoryProposalScope } from '@rox/shared/memory/proposals'

/** An RPC response is success only when it contains the durable target receipt. */
export function hasDurableMemoryApproval(proposal: MemoryProposal | null | undefined, scope: MemoryProposalScope): proposal is MemoryProposal {
  const receipt = proposal?.approval
  return proposal?.status === `approved_${scope}` && receipt?.scope === scope
    && Boolean(receipt.target && receipt.consentEventId && receipt.textHash && receipt.writtenAt)
    && Number.isFinite(Date.parse(receipt.writtenAt!))
}

export function canUsePersonalMemory(identity: { authority: 'native' | 'local'; issuer?: string; userId: string } | null, proposal: MemoryProposal): boolean {
  return identity?.authority === 'native' && Boolean(identity.issuer && identity.userId)
    && identity.issuer === proposal.owner?.issuer && identity.userId === proposal.owner?.subject
}
