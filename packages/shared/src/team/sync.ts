import type { TeamLocalState, TeamOutboxEntry } from './types.ts'

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
}

export interface TeamPullResult {
  /** Remote-authored state to merge (teammates' comments, mentions, handoffs…) */
  remote: Partial<Pick<TeamLocalState, 'comments' | 'assignments' | 'handoffs' | 'access' | 'approvals' | 'activity'>>
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

/** Apply a push result: drop accepted entries, record errors on rejected. */
export function applyPushResult(state: TeamLocalState, result: TeamPushResult): TeamLocalState {
  if (result.acceptedIds.length === 0 && result.rejected.length === 0) return state
  const accepted = new Set(result.acceptedIds)
  const errors = new Map(result.rejected.map((r) => [r.id, r.error]))
  return {
    ...state,
    outbox: state.outbox
      .filter((e) => !accepted.has(e.id))
      .map((e) => (errors.has(e.id) ? { ...e, attempts: e.attempts + 1, lastError: errors.get(e.id) } : e)),
  }
}
