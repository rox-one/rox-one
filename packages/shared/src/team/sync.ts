import type { TeamLocalState, TeamOutboxEntry, TeamRecipientAction } from './types.ts'

/**
 * Sync adapter between the local team state and an organization server.
 *
 * Rox has no multi-user team API yet: orgs are local (orgs.json) and
 * CRAFT_SERVER_URL only gates invite logging. Until a server implements
 * `push`/`pull`, the local-only adapter reports `org-server-required` and
 * keeps everything in the outbox. Adding a real transport means adding an
 * adapter here — the UI only reads `status()`.
 */

export type TeamSyncStatus =
  | { state: 'no-org' }
  | { state: 'org-server-required'; orgId: string; serverUrl?: string }
  | { state: 'connected'; orgId: string; serverUrl: string; lastSyncAt?: number }
  | { state: 'error'; orgId: string; message: string }

export interface TeamPushResult {
  acceptedIds: string[]
  rejected: Array<{ id: string; error: string }>
  /** Request record IDs with a confirmed recipient delivery acknowledgment. */
  deliveredIds?: string[]
}

export interface TeamPullResult {
  /** Remote-authored state to merge from an authoritative organization service. */
  remote: Partial<Pick<TeamLocalState, 'comments' | 'assignments' | 'handoffs' | 'access' | 'approvals' | 'recipientRequests' | 'recipientActions' | 'activity'>>
  cursor: string
}

export interface TeamSyncAdapter {
  readonly id: string
  status(): TeamSyncStatus
  push(entries: readonly TeamOutboxEntry[]): Promise<TeamPushResult>
  pull(cursor?: string): Promise<TeamPullResult | null>
}

export class LocalOnlyTeamSyncAdapter implements TeamSyncAdapter {
  readonly id = 'local-only'
  constructor(private readonly orgId: string | null, private readonly serverUrl?: string) {}

  status(): TeamSyncStatus {
    if (!this.orgId) return { state: 'no-org' }
    return { state: 'org-server-required', orgId: this.orgId, ...(this.serverUrl ? { serverUrl: this.serverUrl } : {}) }
  }

  async push(): Promise<TeamPushResult> {
    // Nothing leaves the device; entries stay queued.
    return { acceptedIds: [], rejected: [] }
  }

  async pull(): Promise<TeamPullResult | null> {
    return null
  }
}

export function createTeamSyncAdapter(opts: { orgId: string | null; serverUrl?: string | null }): TeamSyncAdapter {
  // No org-server team API exists yet — always local-only (honest state).
  return new LocalOnlyTeamSyncAdapter(opts.orgId, opts.serverUrl?.trim() || undefined)
}

/** Apply service acknowledgments without conflating queue acceptance and delivery. */
export function applyPushResult(state: TeamLocalState, result: TeamPushResult): TeamLocalState {
  if (result.acceptedIds.length === 0 && result.rejected.length === 0 && !result.deliveredIds?.length) return state
  const accepted = new Set(result.acceptedIds)
  const delivered = new Set(result.deliveredIds ?? [])
  const errors = new Map(result.rejected.map((r) => [r.id, r.error]))
  const acceptedOps = state.outbox.filter((entry) => accepted.has(entry.id))
  const rejectedOps = state.outbox.filter((entry) => errors.has(entry.id))
  const decisions = new Map<string, TeamRecipientAction>()
  const revoked = new Set<string>()
  for (const entry of acceptedOps) {
    if (entry.op.type === 'recipient-action') decisions.set(entry.op.record.requestId, entry.op.record)
    if (entry.op.type === 'recipient-revoke') revoked.add(entry.op.record.id)
  }
  const commentStatus = (id: string) => {
    if (acceptedOps.some((entry) => entry.op.type === 'comment' && entry.op.record.id === id)) return 'synced' as const
    if (rejectedOps.some((entry) => entry.op.type === 'comment' && entry.op.record.id === id)) return 'rejected' as const
    return undefined
  }
  const handoffStatus = (id: string) => {
    if (acceptedOps.some((entry) => entry.op.type === 'handoff' && entry.op.record.id === id)) return 'synced' as const
    if (rejectedOps.some((entry) => entry.op.type === 'handoff' && entry.op.record.id === id)) return 'rejected' as const
    return undefined
  }
  const assignmentStatus = (id: string) => {
    if (acceptedOps.some((entry) => entry.op.type === 'assign' && entry.op.record.id === id)) return 'synced' as const
    if (rejectedOps.some((entry) => entry.op.type === 'assign' && entry.op.record.id === id)) return 'rejected' as const
    return undefined
  }
  const accessStatus = (id: string) => {
    if (acceptedOps.some((entry) => entry.op.type === 'access' && entry.op.record.id === id)) return 'synced' as const
    if (rejectedOps.some((entry) => entry.op.type === 'access' && entry.op.record.id === id)) return 'rejected' as const
    return undefined
  }
  const approvalStatus = (id: string) => {
    if (acceptedOps.some((entry) => entry.op.type === 'approval' && entry.op.record.id === id)) return 'synced' as const
    if (rejectedOps.some((entry) => entry.op.type === 'approval' && entry.op.record.id === id)) return 'rejected' as const
    return undefined
  }
  return {
    ...state,
    comments: state.comments.map((record) => {
      const sync = commentStatus(record.id)
      return sync ? { ...record, sync } : record
    }),
    handoffs: state.handoffs.map((record) => {
      const sync = handoffStatus(record.id)
      return sync ? { ...record, sync } : record
    }),
    assignments: state.assignments.map((record) => {
      const sync = assignmentStatus(record.id)
      return sync ? { ...record, sync } : record
    }),
    access: state.access.map((record) => {
      const sync = accessStatus(record.id)
      return sync ? { ...record, sync } : record
    }),
    approvals: state.approvals.map((record) => {
      const sync = approvalStatus(record.id)
      return sync ? { ...record, sync } : record
    }),
    recipientRequests: state.recipientRequests.map((record) => {
      const requestEntry = rejectedOps.find((entry) => entry.op.type === 'recipient-request' && entry.op.record.id === record.id)
      const revokeEntry = acceptedOps.some((entry) => entry.op.type === 'recipient-revoke' && entry.op.record.id === record.id)
      const decision = decisions.get(record.id)
      return {
        ...record,
        ...(delivered.has(record.id) && !revoked.has(record.id) ? { delivery: 'delivered' as const } : {}),
        ...(requestEntry ? { delivery: 'failed' as const } : {}),
        ...(revokeEntry ? { delivery: 'revoked' as const } : {}),
        ...(decision ? { decision: decision.decision, decidedAt: decision.decidedAt } : {}),
      }
    }),
    recipientActions: state.recipientActions.map((record) => {
      const acceptedAction = acceptedOps.some((entry) => entry.op.type === 'recipient-action' && entry.op.record.requestId === record.requestId)
      const rejectedAction = rejectedOps.some((entry) => entry.op.type === 'recipient-action' && entry.op.record.requestId === record.requestId)
      return acceptedAction ? { ...record, sync: 'synced' } : rejectedAction ? { ...record, sync: 'rejected' } : record
    }),
    outbox: state.outbox
      .filter((entry) => !accepted.has(entry.id))
      .map((entry) => (errors.has(entry.id) ? { ...entry, attempts: entry.attempts + 1, lastError: errors.get(entry.id) } : entry)),
  }
}
