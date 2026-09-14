/**
 * GitHub/Linear tracker actions from an approved meeting proposal (issue #373 / I017).
 * Sits on the existing source registry + credential refs. No second secret store.
 * The meeting keeps a link/span; the issue lives in the tracker.
 * Fixture adapters are never live integration. Draft PRs never auto-merge.
 * Rollback revokes adapter capability; it does not delete remote issues.
 */

import { decodeRox2V2Result, isVerifiedEffect, type Rox2V2Result } from '@craft-agent/core/rox2'
import type { KnownProvider } from '@craft-agent/shared/sources'
import { authorizeMeetingAction, type MeetingGrant } from '@craft-agent/shared/meeting-agents'

export type TrackerProvider = Extract<KnownProvider, 'github' | 'linear'>

export type TrackerTarget = {
  provider: TrackerProvider
  accountId: string
  repositoryId?: string
  repositoryName?: string
  teamId?: string
  projectId?: string
  assigneeId?: string
}

export type ResolvedTrackerTarget = {
  provider: TrackerProvider
  accountId: string
  repositoryId?: string
  teamId?: string
  projectId?: string
  assigneeId?: string
  resource: string
  slug: string
  credentialRef: string
}

export type TrackerIssueDraft = {
  title: string
  context: string
  acceptanceCriteria: readonly string[]
  priority: 'p0' | 'p1' | 'p2'
  source: {
    meetingId: string
    excerptHash: string
    segmentId?: string
    segmentRevision?: number
    quote?: string
  }
}

export type TrackerIssueRecord = {
  remoteId: string
  htmlUrl: string
  revision: string
  title: string
  context: string
  acceptanceCriteria: readonly string[]
  priority: TrackerIssueDraft['priority']
  sourceMeetingId: string
  sourceExcerptHash: string
  assigneeId?: string
  provider: TrackerProvider
  resource: string
  accountId: string
}

export type TrackerBinding = {
  meetingId: string
  provider: TrackerProvider
  remoteId: string
  htmlUrl: string
  revision: string
  operationId: string
  payloadHash: string
  resource: string
  evidence?: { segmentId: string; segmentRevision: number; quote: string }
}

export type TrackerSourceRecord = {
  provider: TrackerProvider
  accountId: string
  slug: string
  credentialRef: string
  enabled: boolean
}

export type TrackerSourceRegistry = {
  lookup(provider: TrackerProvider, accountId: string): TrackerSourceRecord | undefined
}

export type TrackerWriteKind = 'ok' | 'timeout' | 'rate_limit' | 'conflict' | 'duplicate' | 'denied'

export type TrackerAdapterResult =
  | { kind: 'ok'; issue: TrackerIssueRecord }
  | { kind: 'timeout'; issue?: TrackerIssueRecord }
  | { kind: 'rate_limit'; afterWrite?: boolean; issue?: TrackerIssueRecord }
  | { kind: 'conflict'; currentRevision: string }
  | { kind: 'duplicate'; issue: TrackerIssueRecord }
  | { kind: 'denied'; reason: string }

export type TrackerAdapter = {
  mode: 'fixture' | 'live'
  capabilityEnabled: boolean
  createIssue(input: {
    operationId: string
    idempotencyKey: string
    target: ResolvedTrackerTarget
    draft: TrackerIssueDraft
    expectedRevision?: string
  }): Promise<TrackerAdapterResult>
  updateIssue(input: {
    operationId: string
    remoteId: string
    target: ResolvedTrackerTarget
    draft: TrackerIssueDraft
    expectedRevision: string
  }): Promise<TrackerAdapterResult>
  readback(remoteId: string): Promise<TrackerIssueRecord | undefined>
  list(): TrackerIssueRecord[]
}

export type TrackerCreateRequest = {
  operationId: string
  idempotencyKey: string
  payloadHash: string
  sourceRevision: string
  target: TrackerTarget
  approvedTarget: TrackerTarget
  currentAssigneeId?: string
  draft: TrackerIssueDraft
  grants: readonly MeetingGrant[]
  actorId: string
  workspaceId: string
  deviceId: string
  now: number
  draftPr?: { autoMerge?: boolean; merge?: boolean }
}

export type TrackerUpdateRequest = TrackerCreateRequest & {
  remoteId: string
  expectedRevision: string
  currentRevision?: string
}

export type TrackerActionStatus =
  | 'acked'
  | 'denied'
  | 'duplicate'
  | 'unknown'
  | 'conflict'
  | 'failed'
  | 'unsupported'

export type TrackerActionResult = {
  status: TrackerActionStatus
  reason: string
  live: boolean
  evidenceLevel: 'U1' | 'L4'
  result: Rox2V2Result
  binding?: TrackerBinding
  issue?: TrackerIssueRecord
}

function resourceFor(target: Pick<TrackerTarget, 'provider' | 'accountId' | 'repositoryId' | 'teamId'>): string {
  if (target.provider === 'github') return `github:${target.accountId}:${target.repositoryId ?? ''}`
  return `linear:${target.accountId}:${target.teamId ?? ''}`
}

export function targetsEqual(a: TrackerTarget, b: TrackerTarget): boolean {
  return (
    a.provider === b.provider
    && a.accountId === b.accountId
    && a.repositoryId === b.repositoryId
    && a.teamId === b.teamId
    && a.projectId === b.projectId
    && a.assigneeId === b.assigneeId
  )
}

export function targetIdsPresent(target: TrackerTarget): boolean {
  if (!target.accountId) return false
  if (target.repositoryName && !target.repositoryId) return false
  if (target.provider === 'github') return Boolean(target.repositoryId)
  if (target.provider === 'linear') return Boolean(target.teamId)
  return false
}

export function createMemorySourceRegistry(records: readonly TrackerSourceRecord[] = []): TrackerSourceRegistry {
  return {
    lookup(provider, accountId) {
      return records.find((item) => item.provider === provider && item.accountId === accountId)
    },
  }
}

export function resolveTrackerTarget(
  hint: TrackerTarget,
  registry: TrackerSourceRegistry,
): { ok: true; target: ResolvedTrackerTarget } | { ok: false; reason: string } {
  if (!targetIdsPresent(hint)) return { ok: false, reason: 'missing-exact-ids' }
  const source = registry.lookup(hint.provider, hint.accountId)
  if (!source) return { ok: false, reason: 'source-missing' }
  if (!source.enabled) return { ok: false, reason: 'source-disabled' }
  return {
    ok: true,
    target: {
      provider: hint.provider,
      accountId: hint.accountId,
      repositoryId: hint.repositoryId,
      teamId: hint.teamId,
      projectId: hint.projectId,
      assigneeId: hint.assigneeId,
      resource: resourceFor(hint),
      slug: source.slug,
      credentialRef: source.credentialRef,
    },
  }
}

function deniedResult(reason: string): TrackerActionResult {
  return {
    status: 'denied',
    reason,
    live: false,
    evidenceLevel: 'U1',
    result: decodeRox2V2Result({ ok: false, state: 'queued', code: reason, message: reason }),
  }
}

function unknownResult(reason: string, issue?: TrackerIssueRecord): TrackerActionResult {
  return {
    status: 'unknown',
    reason,
    live: false,
    evidenceLevel: 'U1',
    result: decodeRox2V2Result({
      ok: true,
      state: 'live',
      entityId: issue?.remoteId,
    }),
    issue,
  }
}

function appliedResult(
  adapter: TrackerAdapter,
  issue: TrackerIssueRecord,
  binding: TrackerBinding,
  duplicate = false,
): TrackerActionResult {
  const live = adapter.mode === 'live'
  const result: Rox2V2Result = live
    ? { ok: true, mode: 'live', lifecycle: 'applied', verification: 'verified', entityId: issue.remoteId }
    : { ok: true, mode: 'fixture', lifecycle: 'applied', verification: 'unverified', entityId: issue.remoteId }
  if (live && !isVerifiedEffect(result)) {
    throw new Error('Verified result contract broken')
  }
  if (!live && isVerifiedEffect(result)) {
    throw new Error('Fixture must not be a verified live effect')
  }
  return {
    status: duplicate ? 'duplicate' : 'acked',
    reason: duplicate ? 'idempotent' : 'created',
    live,
    evidenceLevel: live ? 'L4' : 'U1',
    result,
    binding,
    issue,
  }
}

function bindingFrom(issue: TrackerIssueRecord, request: TrackerCreateRequest): TrackerBinding {
  const source = request.draft.source
  return {
    meetingId: source.meetingId,
    provider: issue.provider,
    remoteId: issue.remoteId,
    htmlUrl: issue.htmlUrl,
    revision: issue.revision,
    operationId: request.operationId,
    payloadHash: request.payloadHash,
    resource: issue.resource,
    ...(source.segmentId && source.quote
      ? {
          evidence: {
            segmentId: source.segmentId,
            segmentRevision: Number(source.segmentRevision ?? 0),
            quote: source.quote,
          },
        }
      : {}),
  }
}

function fieldsMatch(issue: TrackerIssueRecord, draft: TrackerIssueDraft, target: ResolvedTrackerTarget): boolean {
  if (issue.title !== draft.title) return false
  if (issue.priority !== draft.priority) return false
  if (issue.sourceMeetingId !== draft.source.meetingId) return false
  if (issue.sourceExcerptHash !== draft.source.excerptHash) return false
  if (issue.resource !== target.resource) return false
  if (target.assigneeId && issue.assigneeId !== target.assigneeId) return false
  if (issue.acceptanceCriteria.join('\0') !== draft.acceptanceCriteria.join('\0')) return false
  return true
}

export class TrackerMeetingActions {
  private readonly completed = new Map<string, TrackerActionResult>()
  private readonly bindingsByMeeting = new Map<string, TrackerBinding[]>()
  private capabilityEnabled = true

  constructor(
    private readonly adapter: TrackerAdapter,
    private readonly registry: TrackerSourceRegistry,
  ) {}

  setCapabilityEnabled(enabled: boolean): void {
    this.capabilityEnabled = enabled
    this.adapter.capabilityEnabled = enabled
  }

  bindings(meetingId?: string): TrackerBinding[] {
    if (!meetingId) {
      return [...this.bindingsByMeeting.values()].flat().map((item) => ({ ...item }))
    }
    return (this.bindingsByMeeting.get(meetingId) ?? []).map((item) => ({ ...item }))
  }

  restoreBindings(items: readonly TrackerBinding[]): void {
    this.bindingsByMeeting.clear()
    for (const item of items) {
      const list = this.bindingsByMeeting.get(item.meetingId) ?? []
      list.push({ ...item })
      this.bindingsByMeeting.set(item.meetingId, list)
    }
  }

  async createFromMeeting(request: TrackerCreateRequest): Promise<TrackerActionResult> {
    const cached = this.completed.get(request.idempotencyKey)
    if (cached) {
      return {
        ...cached,
        status: cached.status === 'acked' ? 'duplicate' : cached.status,
        reason: cached.status === 'acked' ? 'idempotent' : cached.reason,
      }
    }
    const validated = this.validate(request)
    if (validated) return validated
    const resolved = resolveTrackerTarget(request.approvedTarget, this.registry)
    if (!resolved.ok) return deniedResult(resolved.reason)
    const wrote = await this.adapter.createIssue({
      operationId: request.operationId,
      idempotencyKey: request.idempotencyKey,
      target: resolved.target,
      draft: request.draft,
    })
    const mapped = await this.mapWrite(request, resolved.target, wrote)
    this.remember(request, mapped)
    return mapped
  }

  async updateFromMeeting(request: TrackerUpdateRequest): Promise<TrackerActionResult> {
    const validated = this.validate(request)
    if (validated) return validated
    if (request.currentRevision && request.currentRevision !== request.expectedRevision) {
      return {
        status: 'conflict',
        reason: 'concurrent_update',
        live: false,
        evidenceLevel: 'U1',
        result: decodeRox2V2Result({ ok: false, state: 'queued', code: 'concurrent_update', message: 'expected revision is stale' }),
      }
    }
    const resolved = resolveTrackerTarget(request.approvedTarget, this.registry)
    if (!resolved.ok) return deniedResult(resolved.reason)
    const wrote = await this.adapter.updateIssue({
      operationId: request.operationId,
      remoteId: request.remoteId,
      target: resolved.target,
      draft: request.draft,
      expectedRevision: request.expectedRevision,
    })
    return this.mapWrite(request, resolved.target, wrote, request.remoteId)
  }

  private validate(request: TrackerCreateRequest): TrackerActionResult | null {
    if (!this.capabilityEnabled || !this.adapter.capabilityEnabled) {
      return { status: 'unsupported', reason: 'live-disabled', live: false, evidenceLevel: 'U1', result: decodeRox2V2Result({ ok: false, state: 'queued', code: 'live-disabled', message: 'tracker adapter capability revoked' }) }
    }
    if (request.draftPr?.autoMerge === true || request.draftPr?.merge === true) {
      return deniedResult('draft-pr-no-auto-merge')
    }
    if (!targetIdsPresent(request.target) || !targetIdsPresent(request.approvedTarget)) {
      return deniedResult('missing-exact-ids')
    }
    if (!targetsEqual(request.target, request.approvedTarget)) {
      return deniedResult('wrong_target')
    }
    if (
      request.approvedTarget.assigneeId
      && request.currentAssigneeId
      && request.currentAssigneeId !== request.approvedTarget.assigneeId
    ) {
      return deniedResult('assignee_changed')
    }
    const resource = resourceFor(request.approvedTarget)
    if (!request.grants.some((item) => item.target === resource)) {
      return deniedResult('permissions')
    }
    const authz = authorizeMeetingAction({
      actor: {
        accountId: request.actorId,
        workspaceId: request.workspaceId,
        deviceId: request.deviceId,
        authenticated: true,
      },
      capability: 'action.external',
      operation: 'tracker.create',
      source: 'external',
      target: resource,
      payloadHash: request.payloadHash,
      now: request.now,
      permissionMode: 'ask',
      grants: request.grants,
    })
    if (!authz.ok) {
      return deniedResult(
        authz.code === 'target-denied'
          || authz.code === 'grant-missing'
          || authz.code === 'challenge'
          || authz.code === 'grant-expired'
          || authz.code === 'grant-revoked'
          ? 'permissions'
          : authz.code,
      )
    }
    return null
  }

  private async mapWrite(
    request: TrackerCreateRequest,
    target: ResolvedTrackerTarget,
    wrote: TrackerAdapterResult,
    remoteId?: string,
  ): Promise<TrackerActionResult> {
    if (wrote.kind === 'timeout' || (wrote.kind === 'rate_limit' && wrote.afterWrite)) {
      return unknownResult(wrote.kind === 'timeout' ? 'timeout' : 'rate_limit', wrote.issue)
    }
    if (wrote.kind === 'rate_limit') {
      return {
        status: 'failed',
        reason: 'rate_limit',
        live: false,
        evidenceLevel: 'U1',
        result: decodeRox2V2Result({ ok: false, state: 'queued', code: 'rate_limit', message: 'provider rate limited before write' }),
      }
    }
    if (wrote.kind === 'denied') return deniedResult(wrote.reason)
    if (wrote.kind === 'conflict') {
      return {
        status: 'conflict',
        reason: 'concurrent_update',
        live: false,
        evidenceLevel: 'U1',
        result: decodeRox2V2Result({ ok: false, state: 'queued', code: 'concurrent_update', message: wrote.currentRevision }),
      }
    }
    const issue = wrote.kind === 'ok' || wrote.kind === 'duplicate' ? wrote.issue : undefined
    if (!issue) return deniedResult('missing-issue')
    if (issue.resource !== target.resource) {
      return deniedResult('wrong_target')
    }
    const observed = await this.adapter.readback(remoteId ?? issue.remoteId)
    if (!observed) return unknownResult('readback-missing', issue)
    if (!fieldsMatch(observed, request.draft, target)) {
      return {
        status: 'failed',
        reason: 'readback-mismatch',
        live: false,
        evidenceLevel: 'U1',
        result: {
          ok: true,
          mode: this.adapter.mode === 'live' ? 'live' : 'fixture',
          lifecycle: 'applied',
          verification: 'unverified',
          entityId: issue.remoteId,
          code: 'readback-mismatch',
        },
        issue: observed,
      }
    }
    const binding = bindingFrom(observed, request)
    return appliedResult(this.adapter, observed, binding, wrote.kind === 'duplicate')
  }

  private remember(request: TrackerCreateRequest, mapped: TrackerActionResult): void {
    this.completed.set(request.idempotencyKey, mapped)
    if (!mapped.binding) return
    const list = this.bindingsByMeeting.get(mapped.binding.meetingId) ?? []
    if (!list.some((item) => item.remoteId === mapped.binding?.remoteId && item.operationId === mapped.binding.operationId)) {
      list.push(mapped.binding)
      this.bindingsByMeeting.set(mapped.binding.meetingId, list)
    }
  }
}

export function createMemoryTrackerAdapter(options?: {
  fail?: TrackerWriteKind
  currentRevision?: string
  mode?: 'fixture' | 'live'
}): TrackerAdapter & { writes: TrackerIssueRecord[] } {
  const byKey = new Map<string, TrackerIssueRecord>()
  const byRemote = new Map<string, TrackerIssueRecord>()
  const writes: TrackerIssueRecord[] = []
  const mode = options?.mode ?? 'fixture'

  const htmlUrlFor = (target: ResolvedTrackerTarget, remoteId: string): string => {
    if (target.provider === 'github') {
      return `https://github.com/${target.accountId}/${target.repositoryId}/issues/${remoteId}`
    }
    return `https://linear.app/${target.accountId}/issue/${remoteId}`
  }

  const recordFrom = (
    target: ResolvedTrackerTarget,
    draft: TrackerIssueDraft,
    operationId: string,
    revision: string,
  ): TrackerIssueRecord => {
    const remoteId = `${target.provider}-${operationId}`
    return {
      remoteId,
      htmlUrl: htmlUrlFor(target, remoteId),
      revision,
      title: draft.title,
      context: draft.context,
      acceptanceCriteria: [...draft.acceptanceCriteria],
      priority: draft.priority,
      sourceMeetingId: draft.source.meetingId,
      sourceExcerptHash: draft.source.excerptHash,
      assigneeId: target.assigneeId,
      provider: target.provider,
      resource: target.resource,
      accountId: target.accountId,
    }
  }

  const adapter: TrackerAdapter & { writes: TrackerIssueRecord[] } = {
    mode,
    capabilityEnabled: true,
    writes,
    async createIssue(input) {
      if (!adapter.capabilityEnabled) return { kind: 'denied', reason: 'live-disabled' }
      if (options?.fail === 'denied') return { kind: 'denied', reason: 'adapter-denied' }
      const existing = byKey.get(input.idempotencyKey)
      if (existing) return { kind: 'duplicate', issue: existing }
      const created = recordFrom(input.target, input.draft, input.operationId, '1')
      byKey.set(input.idempotencyKey, created)
      byRemote.set(created.remoteId, created)
      writes.push(created)
      if (options?.fail === 'timeout') return { kind: 'timeout', issue: created }
      if (options?.fail === 'rate_limit') return { kind: 'rate_limit', afterWrite: true, issue: created }
      return { kind: 'ok', issue: created }
    },
    async updateIssue(input) {
      if (!adapter.capabilityEnabled) return { kind: 'denied', reason: 'live-disabled' }
      const current = byRemote.get(input.remoteId)
      const expected = options?.currentRevision ?? current?.revision
      if (options?.fail === 'conflict' || (expected && input.expectedRevision !== expected)) {
        return { kind: 'conflict', currentRevision: expected ?? '2' }
      }
      if (options?.fail === 'timeout') return { kind: 'timeout', issue: current }
      const next: TrackerIssueRecord = {
        ...(current ?? recordFrom(input.target, input.draft, input.operationId, '1')),
        title: input.draft.title,
        context: input.draft.context,
        acceptanceCriteria: [...input.draft.acceptanceCriteria],
        priority: input.draft.priority,
        revision: String(Number(input.expectedRevision) + 1),
        htmlUrl: current?.htmlUrl ?? htmlUrlFor(input.target, input.remoteId),
        remoteId: input.remoteId,
        resource: input.target.resource,
      }
      byRemote.set(input.remoteId, next)
      return { kind: 'ok', issue: next }
    },
    async readback(remoteId) {
      const found = byRemote.get(remoteId)
      return found ? { ...found, acceptanceCriteria: [...found.acceptanceCriteria] } : undefined
    },
    list() {
      return [...byRemote.values()].map((item) => ({ ...item, acceptanceCriteria: [...item.acceptanceCriteria] }))
    },
  }
  return adapter
}

export function createDisabledTrackerAdapter(): TrackerAdapter {
  return {
    mode: 'fixture',
    capabilityEnabled: false,
    async createIssue() {
      return { kind: 'denied', reason: 'live-disabled' }
    },
    async updateIssue() {
      return { kind: 'denied', reason: 'live-disabled' }
    },
    async readback() {
      return undefined
    },
    list() {
      return []
    },
  }
}

export function createTrackerActions(
  adapter: TrackerAdapter = createDisabledTrackerAdapter(),
  registry: TrackerSourceRegistry = createMemorySourceRegistry(),
): TrackerMeetingActions {
  return new TrackerMeetingActions(adapter, registry)
}

/** Live GitHub/Linear remain opt-in. Default export is fail-closed. */
export function createLiveDisabledTrackerActions(): TrackerMeetingActions {
  return createTrackerActions(createDisabledTrackerAdapter(), createMemorySourceRegistry())
}
