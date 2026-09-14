export type ProposalInboxStatus =
  | 'proposed'
  | 'needs_clarification'
  | 'approved'
  | 'rejected'
  | 'stale'
  | 'executing'
  | 'applied'
  | 'failed'

export type ProposalInboxItem = {
  id: string
  meetingId: string
  status: ProposalInboxStatus
  payload: Record<string, unknown>
  payloadHash: string
  sourceRevision: number
  target?: string
  verification?: 'not_requested' | 'pending' | 'verified' | 'mismatch' | 'unknown'
}

export function operationVerificationKey(item: ProposalInboxItem): string | null {
  if (item.verification === 'verified' && item.status === 'applied') return 'meetings.artifactVerified'
  if (item.status === 'applied' && item.verification === 'unknown') return 'meetings.trackerUnknown'
  if (item.status === 'failed' || item.verification === 'mismatch') return 'meetings.trackerFailed'
  return null
}

export type ProposalApproveRequest = {
  proposalId: string
  payloadHash: string
  baseRevision: number
  target?: string
}

const TERMINAL: ReadonlySet<ProposalInboxStatus> = new Set(['rejected', 'stale', 'applied'])

export function canApproveProposal(status: ProposalInboxStatus): boolean {
  return status === 'proposed' || status === 'needs_clarification'
}

export function selectedApproveRequests(
  proposals: readonly ProposalInboxItem[],
  selectedIds: readonly string[],
): ProposalApproveRequest[] {
  const selected = new Set(selectedIds)
  const requests: ProposalApproveRequest[] = []
  for (const proposal of proposals) {
    if (!selected.has(proposal.id) || !canApproveProposal(proposal.status)) continue
    requests.push({
      proposalId: proposal.id,
      payloadHash: proposal.payloadHash,
      baseRevision: proposal.sourceRevision,
      target: proposal.target,
    })
  }
  return requests
}

export function isTerminalProposal(status: ProposalInboxStatus): boolean {
  return TERMINAL.has(status)
}
