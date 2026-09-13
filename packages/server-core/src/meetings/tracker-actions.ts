/**
 * RMA-I017 / #373 — GitHub/Linear tracker handoff.
 *
 * Native slice: fail-closed stubs over injected adapters. Exact
 * repository/team/project/assignee IDs required. Wrong target is never
 * auto-retargeted. Fixture adapters are not live integration. Draft PRs
 * never auto-merge. Post-write timeout → unknown (reconcile), not success.
 */

import {
  denied,
  unknownEffect,
  unsupported,
  type MeetingOpResult,
} from './types.ts'

export type TrackerProvider = 'github' | 'linear'

export type TrackerTarget = {
  readonly provider: TrackerProvider
  readonly accountId: string
  readonly repositoryId?: string
  readonly teamId?: string
  readonly projectId?: string
  readonly assigneeId?: string
}

export type TrackerIssueDraft = {
  readonly title: string
  readonly context: string
  readonly acceptanceCriteria: readonly string[]
  readonly priority: 'p0' | 'p1' | 'p2'
  readonly source: { readonly meetingId: string; readonly excerptHash: string }
}

export type TrackerGrant = {
  readonly actions: readonly string[]
  readonly resources: readonly string[]
  readonly expired?: boolean
}

export type TrackerCreateRequest = {
  readonly operationId: string
  readonly idempotencyKey: string
  readonly sourceRevision: string
  readonly target: TrackerTarget
  readonly approvedTarget: TrackerTarget
  readonly currentAssigneeId?: string
  readonly draft: TrackerIssueDraft
  readonly grant: TrackerGrant
  readonly draftPr?: { readonly autoMerge?: boolean }
}

export type TrackerUpdateRequest = TrackerCreateRequest & {
  readonly remoteId: string
  readonly baseRevision: string
  readonly currentRevision?: string
}

export type SanitizedReceipt = {
  readonly operationId: string
  readonly provider: TrackerProvider
  readonly remoteId?: string
  readonly htmlUrl?: string
  readonly revision?: string
  readonly mode: 'fixture' | 'live'
}

export type TrackerWriteKind = 'ok' | 'timeout' | 'rate_limit' | 'conflict' | 'duplicate' | 'denied'

export type TrackerAdapterResult =
  | { readonly kind: 'ok'; readonly remoteId: string; readonly htmlUrl: string; readonly revision: string }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'rate_limit' }
  | { readonly kind: 'conflict'; readonly currentRevision: string }
  | { readonly kind: 'duplicate'; readonly remoteId: string; readonly htmlUrl: string }
  | { readonly kind: 'denied'; readonly reason: string }

export type TrackerAdapter = {
  readonly mode: 'fixture' | 'live'
  createIssue(request: TrackerCreateRequest): Promise<TrackerAdapterResult>
  updateIssue(request: TrackerUpdateRequest): Promise<TrackerAdapterResult>
}

export type TrackerActions = {
  createFromMeeting(request: TrackerCreateRequest): Promise<MeetingOpResult<string, SanitizedReceipt>>
  updateFromMeeting(request: TrackerUpdateRequest): Promise<MeetingOpResult<string, SanitizedReceipt>>
}

const REQUIRED_CREATE_ACTION = 'tracker.create'

function targetsEqual(a: TrackerTarget, b: TrackerTarget): boolean {
  return (
    a.provider === b.provider
    && a.accountId === b.accountId
    && a.repositoryId === b.repositoryId
    && a.teamId === b.teamId
    && a.projectId === b.projectId
    && a.assigneeId === b.assigneeId
  )
}

function targetIdsPresent(target: TrackerTarget): boolean {
  if (!target.accountId) return false
  if (target.provider === 'github') return Boolean(target.repositoryId)
  if (target.provider === 'linear') return Boolean(target.teamId)
  return false
}

function grantAllows(grant: TrackerGrant, target: TrackerTarget): boolean {
  if (grant.expired) return false
  if (!grant.actions.includes(REQUIRED_CREATE_ACTION)) return false
  const resource = `${target.provider}:${target.accountId}:${target.repositoryId ?? target.teamId}`
  return grant.resources.includes(resource) || grant.resources.includes(`${target.provider}:*`)
}

function validateRequest(request: TrackerCreateRequest): MeetingOpResult<string> | null {
  if (!targetIdsPresent(request.target) || !targetIdsPresent(request.approvedTarget)) {
    return denied('missing-exact-ids')
  }
  if (!targetsEqual(request.target, request.approvedTarget)) {
    return denied('wrong_target')
  }
  if (
    request.approvedTarget.assigneeId
    && request.currentAssigneeId
    && request.currentAssigneeId !== request.approvedTarget.assigneeId
  ) {
    return denied('assignee_changed')
  }
  if (!grantAllows(request.grant, request.approvedTarget)) {
    return denied('permissions')
  }
  if (request.draftPr?.autoMerge === true) {
    return denied('draft-pr-no-auto-merge')
  }
  return null
}

function fromAdapter(
  request: TrackerCreateRequest,
  adapter: TrackerAdapter,
  result: TrackerAdapterResult,
): MeetingOpResult<string, SanitizedReceipt> {
  const base = {
    operationId: request.operationId,
    provider: request.target.provider,
    mode: adapter.mode,
  } as const
  if (result.kind === 'timeout' || result.kind === 'rate_limit') {
    return {
      ...unknownEffect(result.kind),
      payload: { ...base },
    }
  }
  if (result.kind === 'denied') {
    return { ...denied(result.reason), payload: { ...base } }
  }
  if (result.kind === 'conflict') {
    return {
      status: 'conflict',
      reason: 'concurrent_update',
      live: false,
      evidenceLevel: 'U1',
      payload: { ...base, revision: result.currentRevision },
    }
  }
  if (result.kind === 'duplicate') {
    return {
      status: 'duplicate',
      reason: 'idempotent',
      live: adapter.mode === 'live',
      evidenceLevel: adapter.mode === 'live' ? 'L4' : 'U1',
      payload: { ...base, remoteId: result.remoteId, htmlUrl: result.htmlUrl },
    }
  }
  return {
    status: 'verified',
    reason: 'created',
    live: adapter.mode === 'live',
    evidenceLevel: adapter.mode === 'live' ? 'L4' : 'U1',
    payload: {
      ...base,
      remoteId: result.remoteId,
      htmlUrl: result.htmlUrl,
      revision: result.revision,
    },
  }
}

export function createDisabledTrackerAdapter(): TrackerAdapter {
  return {
    mode: 'fixture',
    async createIssue() {
      return { kind: 'denied', reason: 'live-disabled' }
    },
    async updateIssue() {
      return { kind: 'denied', reason: 'live-disabled' }
    },
  }
}

export function createMemoryTrackerAdapter(options?: {
  readonly fail?: TrackerWriteKind
  readonly currentRevision?: string
}): TrackerAdapter {
  const byKey = new Map<string, { remoteId: string; htmlUrl: string; revision: string }>()
  return {
    mode: 'fixture',
    async createIssue(request) {
      if (options?.fail === 'timeout') return { kind: 'timeout' }
      if (options?.fail === 'rate_limit') return { kind: 'rate_limit' }
      if (options?.fail === 'denied') return { kind: 'denied', reason: 'adapter-denied' }
      const existing = byKey.get(request.idempotencyKey)
      if (existing) {
        return { kind: 'duplicate', remoteId: existing.remoteId, htmlUrl: existing.htmlUrl }
      }
      const remoteId = `${request.target.provider}-${request.operationId}`
      const created = {
        remoteId,
        htmlUrl: `https://example.invalid/${request.target.provider}/${remoteId}`,
        revision: '1',
      }
      byKey.set(request.idempotencyKey, created)
      return { kind: 'ok', ...created }
    },
    async updateIssue(request) {
      if (options?.fail === 'conflict' || (options?.currentRevision && request.baseRevision !== options.currentRevision)) {
        return { kind: 'conflict', currentRevision: options?.currentRevision ?? '2' }
      }
      if (options?.fail === 'timeout') return { kind: 'timeout' }
      return {
        kind: 'ok',
        remoteId: request.remoteId,
        htmlUrl: `https://example.invalid/${request.target.provider}/${request.remoteId}`,
        revision: String(Number(request.baseRevision) + 1),
      }
    },
  }
}

export function createTrackerActions(adapter: TrackerAdapter = createDisabledTrackerAdapter()): TrackerActions {
  const inflight = new Map<string, Promise<MeetingOpResult<string, SanitizedReceipt>>>()
  const completed = new Map<string, MeetingOpResult<string, SanitizedReceipt>>()
  const runCreate = async (request: TrackerCreateRequest) => {
    const cached = completed.get(request.idempotencyKey)
    if (cached) return { ...cached, status: 'duplicate' as const, reason: 'idempotent' }
    const invalid = validateRequest(request)
    if (invalid) return invalid
    if (adapter.mode !== 'live') {
      const wrote = fromAdapter(request, adapter, await adapter.createIssue(request))
      if (wrote.status === 'verified') {
        // Fixture success is recorded but never live.
        const stored = { ...wrote, live: false as const, evidenceLevel: 'U1' as const }
        completed.set(request.idempotencyKey, stored)
        return stored
      }
      return wrote
    }
    const wrote = fromAdapter(request, adapter, await adapter.createIssue(request))
    if (wrote.status === 'verified' || wrote.status === 'duplicate') {
      completed.set(request.idempotencyKey, wrote)
    }
    return wrote
  }

  return {
    async createFromMeeting(request) {
      const existing = inflight.get(request.idempotencyKey)
      if (existing) return existing
      const pending = runCreate(request)
      inflight.set(request.idempotencyKey, pending)
      try {
        return await pending
      } finally {
        inflight.delete(request.idempotencyKey)
      }
    },
    async updateFromMeeting(request) {
      const invalid = validateRequest(request)
      if (invalid) return invalid
      if (request.currentRevision && request.currentRevision !== request.baseRevision) {
        return {
          status: 'conflict',
          reason: 'concurrent_update',
          live: false,
          evidenceLevel: 'U1',
        }
      }
      return fromAdapter(request, adapter, await adapter.updateIssue(request))
    },
  }
}

/** Live GitHub/Linear remain opt-in. Default export is fail-closed. */
export function createLiveDisabledTrackerActions(): TrackerActions {
  return {
    async createFromMeeting() {
      return unsupported('live-disabled')
    },
    async updateFromMeeting() {
      return unsupported('live-disabled')
    },
  }
}
