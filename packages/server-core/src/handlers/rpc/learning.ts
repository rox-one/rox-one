/**
 * `learning:*` RPC — the PRD §15 surface over the learning service (WP-111).
 *
 * Reads/actions mirror the memory handler: every request is bound to exactly
 * one workspace, and the registration declares a `nativeAction` so a native
 * principal needs an explicit read/write grant.
 *
 * `observe|recordOutcome|recordCorrection` are agent/native actions. They are
 * registered for native principals and the local Electron app only (never
 * through the renderer channel map), a native caller must still hold the write
 * grant while the request runs, and ownership/workspace scope are always
 * stamped from the authenticated request — never taken from the payload.
 */
import { CodedError, RPC_CHANNELS } from '@rox/shared/protocol'
import type {
  LearningCandidate,
  LearningCandidateStatus,
  LearningEvidence,
  LearningExperiment,
  LearningPolicy,
  LearningStatsDto,
  LearningTimelineEntryDto,
  TaskOutcome,
  TaskOutcomeStatus,
  UserCorrection,
  UserCorrectionCategory,
  VerificationResult,
} from '@rox/shared/memory/learning'
import type { RequestContext, RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps, LearningRpcService } from '../handler-deps'
import type { PromotionResult, RollbackResult } from '../../memory/learning/learning-types'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.learning.LIST_CANDIDATES,
  RPC_CHANNELS.learning.GET_CANDIDATE,
  RPC_CHANNELS.learning.LIST_EVIDENCE,
  RPC_CHANNELS.learning.GET_OUTCOME,
  RPC_CHANNELS.learning.GET_EXPERIMENT,
  RPC_CHANNELS.learning.GET_STATS,
  RPC_CHANNELS.learning.GET_SKILL_EFFECTIVENESS,
  RPC_CHANNELS.learning.GET_POLICY,
  RPC_CHANNELS.learning.GET_TIMELINE,
  RPC_CHANNELS.learning.APPROVE,
  RPC_CHANNELS.learning.REJECT,
  RPC_CHANNELS.learning.ROLLBACK,
  RPC_CHANNELS.learning.REVALIDATE,
  RPC_CHANNELS.learning.FORCE_REFLECT,
  RPC_CHANNELS.learning.CONSOLIDATE,
  RPC_CHANNELS.learning.CURATE_SKILLS,
  RPC_CHANNELS.learning.RUN_POLICY_LEARNING,
  RPC_CHANNELS.learning.OBSERVE,
  RPC_CHANNELS.learning.RECORD_OUTCOME,
  RPC_CHANNELS.learning.RECORD_CORRECTION,
] as const

/** PRD §8 lifecycle signal behind `learning:observe`. */
export type LearningObservationReason = 'complete' | 'interrupted' | 'error' | 'timeout' | 'branch'

export interface LearningObservationInput {
  workspaceId: string
  sessionId: string
  reason: LearningObservationReason
}

export interface LearningOutcomeInput {
  workspaceId: string
  outcome: TaskOutcome
}

export interface LearningCorrectionInput {
  workspaceId: string
  correction: UserCorrection
}

const OBSERVATION_REASONS: readonly LearningObservationReason[] = ['complete', 'interrupted', 'error', 'timeout', 'branch']
const CANDIDATE_STATUSES: readonly LearningCandidateStatus[] = ['candidate', 'validating', 'approved', 'active', 'rejected', 'rolled_back']
const OUTCOME_STATUSES: readonly TaskOutcomeStatus[] = ['success', 'failure', 'partial', 'aborted']
const CORRECTION_CATEGORIES: readonly UserCorrectionCategory[] = ['fact', 'preference', 'workflow', 'tool', 'architecture', 'style']
const MAX_ID_LENGTH = 256
const MAX_TEXT_LENGTH = 20_000
const MAX_REASON_LENGTH = 2_000
const MAX_LIST_ITEMS = 1_000

function invalid(field: string): never {
  throw new CodedError('INVALID_PAYLOAD', `Invalid ${field}`)
}

function unavailable(): never {
  throw new CodedError('UNSUPPORTED_OPERATION', 'Learning operations are unavailable on this host')
}

function requireLearning(deps: HandlerDeps): LearningRpcService {
  return deps.learning ?? unavailable()
}

/** Bounded opaque id (candidate/evidence/outcome/experiment/policy/session/workspace). */
function requireId(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ID_LENGTH
    || /[\u0000-\u001f\u007f]/.test(value)) {
    return invalid(field)
  }
  return value
}

function requireBoundedText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || /[\u0000\u007f]/.test(value)) {
    return invalid(field)
  }
  return value
}

function requireStringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length > MAX_LIST_ITEMS || value.some(entry => typeof entry !== 'string')) {
    return invalid(field)
  }
  return value as string[]
}

/**
 * Ownership is server-authenticated personal identity (shared memory contract,
 * PRD §16) — a payload-supplied `owner` is always overwritten, and the row is
 * pinned to the authorized workspace.
 */
function stampOwnerAndWorkspace<T extends { workspaceId?: string; owner?: { issuer: string; subject: string } }>(
  value: T,
  ctx: RequestContext,
  workspaceId: string,
): T {
  const owner = ctx.principal ? { issuer: ctx.principal.issuer, subject: ctx.principal.subject } : undefined
  return { ...value, workspaceId, owner }
}

/** Memory-handler authorization: bind the request to one workspace, refusing payload/binding mismatches. */
function authorizeLearningWorkspace(ctx: RequestContext, requestedId: unknown, deps: HandlerDeps): string {
  const requested = requestedId === undefined || requestedId === null ? undefined : requireId(requestedId, 'workspaceId')
  const boundId = ctx.workspaceId ?? (
    ctx.webContentsId === null ? undefined : deps.windowManager?.getWorkspaceForWindow(ctx.webContentsId) ?? undefined
  )
  if (boundId && requested && boundId !== requested) throw new CodedError('FORBIDDEN', 'Workspace access denied')
  if (ctx.principal && !boundId) throw new CodedError('FORBIDDEN', 'Workspace access denied')
  const workspaceId = boundId ?? requested
  if (!workspaceId) return invalid('workspaceId')
  return workspaceId
}

/**
 * Agent/native actions: a native caller must still hold the write grant (the
 * transport checked it at dispatch) and the original request must remain
 * current; local Electron callers — the in-process agent runtime — pass.
 */
function assertAgentLearningContext(
  ctx: RequestContext,
  deps: HandlerDeps,
  server: RpcServer,
  workspaceId: string,
): void {
  if (!ctx.principal) return
  if (deps.nativeData?.authority.authorize(ctx.principal, workspaceId, 'write') !== true
    || server.isRequestContextCurrent?.(ctx, 'write') !== true) {
    throw new CodedError('FORBIDDEN', 'Learning access denied')
  }
}

function normalizeCandidateFilter(filter: unknown): { status?: LearningCandidateStatus } | undefined {
  if (filter === undefined || filter === null) return undefined
  if (typeof filter !== 'object' || Array.isArray(filter)) return invalid('filter')
  if (!('status' in filter) || filter.status === undefined || filter.status === null) return {}
  const status = CANDIDATE_STATUSES.find(candidate => candidate === filter.status)
  if (status === undefined) return invalid('filter.status')
  return { status }
}

function normalizeLimit(limit: unknown): number | undefined {
  if (limit === undefined || limit === null) return undefined
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1) return invalid('limit')
  return limit
}

/** Optional non-negative metric (`qualityScore`/`durationMs`/`tokenUsage`). */
function requireMetric(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return invalid(field)
  return value
}

/** Optional non-negative count inside `outcome.verification`. */
function requireCount(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return invalid(field)
  return value
}

/** Optional boolean inside `outcome.verification`. */
function requireFlag(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') return invalid(field)
  return value
}

/** PRD §19 verification snapshot, rebuilt field-by-field from the payload. */
function requireVerification(value: unknown): VerificationResult | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) return invalid('outcome.verification')
  const verification: VerificationResult = {}
  if ('testsPassed' in value) verification.testsPassed = requireCount(value.testsPassed, 'outcome.verification.testsPassed')
  if ('testsFailed' in value) verification.testsFailed = requireCount(value.testsFailed, 'outcome.verification.testsFailed')
  if ('buildPassed' in value) verification.buildPassed = requireFlag(value.buildPassed, 'outcome.verification.buildPassed')
  if ('lintPassed' in value) verification.lintPassed = requireFlag(value.lintPassed, 'outcome.verification.lintPassed')
  if ('typecheckPassed' in value) {
    verification.typecheckPassed = requireFlag(value.typecheckPassed, 'outcome.verification.typecheckPassed')
  }
  return verification
}

/**
 * RPC args are untrusted: every field the service reads is validated here, and
 * the row is rebuilt from validated values only. `workspaceId`/`owner` are
 * stripped and re-stamped from the authenticated request by the handler.
 */
function requireTaskOutcome(value: unknown): TaskOutcome {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalid('outcome')
  const candidateStatus = 'status' in value ? value.status : undefined
  const status = OUTCOME_STATUSES.find(entry => entry === candidateStatus) ?? invalid('outcome.status')
  const userCorrections = 'userCorrections' in value ? value.userCorrections : undefined
  if (typeof userCorrections !== 'number' || !Number.isSafeInteger(userCorrections) || userCorrections < 0) {
    return invalid('outcome.userCorrections')
  }
  const metrics: Pick<TaskOutcome, 'qualityScore' | 'durationMs' | 'tokenUsage'> = {}
  if ('qualityScore' in value) metrics.qualityScore = requireMetric(value.qualityScore, 'outcome.qualityScore')
  if ('durationMs' in value) metrics.durationMs = requireMetric(value.durationMs, 'outcome.durationMs')
  if ('tokenUsage' in value) metrics.tokenUsage = requireMetric(value.tokenUsage, 'outcome.tokenUsage')
  return {
    id: requireId('id' in value ? value.id : undefined, 'outcome.id'),
    sessionId: requireId('sessionId' in value ? value.sessionId : undefined, 'outcome.sessionId'),
    taskFingerprint: requireId('taskFingerprint' in value ? value.taskFingerprint : undefined, 'outcome.taskFingerprint'),
    ts: requireBoundedText('ts' in value ? value.ts : undefined, 'outcome.ts', MAX_ID_LENGTH),
    status,
    userCorrections,
    memoryUsed: requireStringList('memoryUsed' in value ? value.memoryUsed : undefined, 'outcome.memoryUsed'),
    skillsUsed: requireStringList('skillsUsed' in value ? value.skillsUsed : undefined, 'outcome.skillsUsed'),
    errors: requireStringList('errors' in value ? value.errors : undefined, 'outcome.errors'),
    ...metrics,
    verification: requireVerification('verification' in value ? value.verification : undefined),
  }
}

/** Same boundary contract as `requireTaskOutcome`, for `learning:recordCorrection`. */
function requireCorrection(value: unknown): UserCorrection {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalid('correction')
  const candidateCategory = 'category' in value ? value.category : undefined
  const category = CORRECTION_CATEGORIES.find(entry => entry === candidateCategory) ?? invalid('correction.category')
  const confidence = 'confidence' in value ? value.confidence : undefined
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return invalid('correction.confidence')
  }
  const sourceObservationIds = 'sourceObservationIds' in value
    ? requireStringList(value.sourceObservationIds, 'correction.sourceObservationIds')
    : undefined
  return {
    id: requireId('id' in value ? value.id : undefined, 'correction.id'),
    sessionId: requireId('sessionId' in value ? value.sessionId : undefined, 'correction.sessionId'),
    original: requireBoundedText('original' in value ? value.original : undefined, 'correction.original', MAX_TEXT_LENGTH),
    corrected: requireBoundedText('corrected' in value ? value.corrected : undefined, 'correction.corrected', MAX_TEXT_LENGTH),
    category,
    confidence,
    ts: requireBoundedText('ts' in value ? value.ts : undefined, 'correction.ts', MAX_ID_LENGTH),
    sourceObservationIds,
  }
}

export function registerLearningHandlers(server: RpcServer, deps: HandlerDeps): void {
  // -------------------------------------------------------------------------
  // Read surface (PRD §15)
  // -------------------------------------------------------------------------

  server.handle(RPC_CHANNELS.learning.LIST_CANDIDATES, async (
    ctx: RequestContext,
    workspaceId: string,
    filter?: unknown,
  ): Promise<LearningCandidate[]> => {
    const scoped = authorizeLearningWorkspace(ctx, workspaceId, deps)
    return requireLearning(deps).listCandidates(scoped, normalizeCandidateFilter(filter))
  }, { nativeAction: 'read' })

  server.handle(RPC_CHANNELS.learning.GET_CANDIDATE, async (
    ctx: RequestContext,
    workspaceId: string,
    id: string,
  ): Promise<LearningCandidate | null> => {
    const scoped = authorizeLearningWorkspace(ctx, workspaceId, deps)
    return requireLearning(deps).getCandidate(scoped, requireId(id, 'id'))
  }, { nativeAction: 'read' })

  server.handle(RPC_CHANNELS.learning.LIST_EVIDENCE, async (
    ctx: RequestContext,
    workspaceId: string,
    candidateId?: string,
  ): Promise<LearningEvidence[]> => {
    const scoped = authorizeLearningWorkspace(ctx, workspaceId, deps)
    const evidenceFor = candidateId === undefined || candidateId === null ? undefined : requireId(candidateId, 'candidateId')
    return requireLearning(deps).listEvidence(scoped, evidenceFor)
  }, { nativeAction: 'read' })

  server.handle(RPC_CHANNELS.learning.GET_OUTCOME, async (
    ctx: RequestContext,
    workspaceId: string,
    id: string,
  ): Promise<TaskOutcome | null> => {
    const scoped = authorizeLearningWorkspace(ctx, workspaceId, deps)
    return requireLearning(deps).getOutcome(scoped, requireId(id, 'id'))
  }, { nativeAction: 'read' })

  server.handle(RPC_CHANNELS.learning.GET_EXPERIMENT, async (
    ctx: RequestContext,
    workspaceId: string,
    id: string,
  ): Promise<LearningExperiment | null> => {
    const scoped = authorizeLearningWorkspace(ctx, workspaceId, deps)
    return requireLearning(deps).getExperiment(scoped, requireId(id, 'id'))
  }, { nativeAction: 'read' })

  server.handle(RPC_CHANNELS.learning.GET_STATS, async (
    ctx: RequestContext,
    workspaceId: string,
  ): Promise<LearningStatsDto> => {
    const scoped = authorizeLearningWorkspace(ctx, workspaceId, deps)
    return requireLearning(deps).getStats(scoped)
  }, { nativeAction: 'read' })

  server.handle(RPC_CHANNELS.learning.GET_SKILL_EFFECTIVENESS, async (
    ctx: RequestContext,
    workspaceId: string,
    targetId: string,
  ) => {
    const scoped = authorizeLearningWorkspace(ctx, workspaceId, deps)
    return requireLearning(deps).getSkillEffectiveness(scoped, requireId(targetId, 'targetId'))
  }, { nativeAction: 'read' })

  server.handle(RPC_CHANNELS.learning.GET_POLICY, async (
    ctx: RequestContext,
    workspaceId: string,
    id?: string,
  ): Promise<LearningPolicy[]> => {
    const scoped = authorizeLearningWorkspace(ctx, workspaceId, deps)
    const service = requireLearning(deps)
    if (id === undefined || id === null) return service.getPolicies(scoped)
    const wanted = requireId(id, 'id')
    return service.getPolicies(scoped).filter(policy => policy.id === wanted)
  }, { nativeAction: 'read' })

  server.handle(RPC_CHANNELS.learning.GET_TIMELINE, async (
    ctx: RequestContext,
    workspaceId: string,
    limit?: number,
  ): Promise<LearningTimelineEntryDto[]> => {
    const scoped = authorizeLearningWorkspace(ctx, workspaceId, deps)
    return requireLearning(deps).getTimeline(scoped, normalizeLimit(limit))
  }, { nativeAction: 'read' })

  // -------------------------------------------------------------------------
  // Actions (PRD §15) — each already gates through the service's validation.
  // -------------------------------------------------------------------------

  server.handle(RPC_CHANNELS.learning.APPROVE, async (
    ctx: RequestContext,
    workspaceId: string,
    id: string,
  ): Promise<PromotionResult> => {
    const scoped = authorizeLearningWorkspace(ctx, workspaceId, deps)
    return requireLearning(deps).approveCandidate(scoped, requireId(id, 'id'))
  }, { nativeAction: 'write' })

  server.handle(RPC_CHANNELS.learning.REJECT, async (
    ctx: RequestContext,
    workspaceId: string,
    id: string,
    reason?: string,
  ): Promise<LearningCandidate | null> => {
    const scoped = authorizeLearningWorkspace(ctx, workspaceId, deps)
    const why = reason === undefined || reason === null ? undefined : requireBoundedText(reason, 'reason', MAX_REASON_LENGTH)
    return requireLearning(deps).rejectCandidate(scoped, requireId(id, 'id'), why)
  }, { nativeAction: 'write' })

  server.handle(RPC_CHANNELS.learning.ROLLBACK, async (
    ctx: RequestContext,
    workspaceId: string,
    id: string,
  ): Promise<RollbackResult> => {
    const scoped = authorizeLearningWorkspace(ctx, workspaceId, deps)
    return requireLearning(deps).rollbackCandidate(scoped, requireId(id, 'id'))
  }, { nativeAction: 'write' })

  server.handle(RPC_CHANNELS.learning.REVALIDATE, async (
    ctx: RequestContext,
    workspaceId: string,
    id: string,
  ): Promise<LearningCandidate | null> => {
    const scoped = authorizeLearningWorkspace(ctx, workspaceId, deps)
    return requireLearning(deps).revalidateCandidate(scoped, requireId(id, 'id'))
  }, { nativeAction: 'write' })

  server.handle(RPC_CHANNELS.learning.FORCE_REFLECT, async (
    ctx: RequestContext,
    workspaceId: string,
    sessionId: string,
  ): Promise<{ candidates: LearningCandidate[] }> => {
    const scoped = authorizeLearningWorkspace(ctx, workspaceId, deps)
    return requireLearning(deps).reflectSession(scoped, requireId(sessionId, 'sessionId'))
  }, { nativeAction: 'write' })

  server.handle(RPC_CHANNELS.learning.CONSOLIDATE, async (
    ctx: RequestContext,
    workspaceId: string,
  ): Promise<{ candidates: LearningCandidate[] }> => {
    const scoped = authorizeLearningWorkspace(ctx, workspaceId, deps)
    return requireLearning(deps).runConsolidation(scoped)
  }, { nativeAction: 'write' })

  server.handle(RPC_CHANNELS.learning.CURATE_SKILLS, async (
    ctx: RequestContext,
    workspaceId: string,
  ): Promise<{ items: Array<{ slug: string; action: 'keep' | 'improve' | 'archive' }> }> => {
    const scoped = authorizeLearningWorkspace(ctx, workspaceId, deps)
    return requireLearning(deps).runSkillCuration(scoped)
  }, { nativeAction: 'write' })

  server.handle(RPC_CHANNELS.learning.RUN_POLICY_LEARNING, async (
    ctx: RequestContext,
    workspaceId: string,
  ): Promise<{ policies: LearningPolicy[] }> => {
    const scoped = authorizeLearningWorkspace(ctx, workspaceId, deps)
    return requireLearning(deps).runPolicyLearning(scoped)
  }, { nativeAction: 'write' })

  // -------------------------------------------------------------------------
  // Agent/native actions (PRD §8/§3.5/§16) — deliberately absent from the
  // renderer channel map: native principals and the local agent runtime only.
  // -------------------------------------------------------------------------

  server.handle(RPC_CHANNELS.learning.OBSERVE, async (
    ctx: RequestContext,
    input: LearningObservationInput | null | undefined,
  ): Promise<void> => {
    const service = requireLearning(deps)
    const workspaceId = authorizeLearningWorkspace(ctx, input?.workspaceId, deps)
    const sessionId = requireId(input?.sessionId, 'sessionId')
    const reason = OBSERVATION_REASONS.find(entry => entry === input?.reason) ?? invalid('reason')
    assertAgentLearningContext(ctx, deps, server, workspaceId)
    service.observeCompletion({ workspaceId, sessionId, reason })
  }, { access: 'nativeOrLocalElectron', nativeAction: 'write' })

  server.handle(RPC_CHANNELS.learning.RECORD_OUTCOME, async (
    ctx: RequestContext,
    input: LearningOutcomeInput | null | undefined,
  ): Promise<void> => {
    const service = requireLearning(deps)
    const workspaceId = authorizeLearningWorkspace(ctx, input?.workspaceId, deps)
    const outcome = requireTaskOutcome(input?.outcome)
    assertAgentLearningContext(ctx, deps, server, workspaceId)
    service.recordOutcome(workspaceId, stampOwnerAndWorkspace(outcome, ctx, workspaceId))
  }, { access: 'nativeOrLocalElectron', nativeAction: 'write' })

  server.handle(RPC_CHANNELS.learning.RECORD_CORRECTION, async (
    ctx: RequestContext,
    input: LearningCorrectionInput | null | undefined,
  ): Promise<void> => {
    const service = requireLearning(deps)
    const workspaceId = authorizeLearningWorkspace(ctx, input?.workspaceId, deps)
    const correction = requireCorrection(input?.correction)
    assertAgentLearningContext(ctx, deps, server, workspaceId)
    service.recordCorrection(stampOwnerAndWorkspace(correction, ctx, workspaceId))
  }, { access: 'nativeOrLocalElectron', nativeAction: 'write' })
}