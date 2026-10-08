/**
 * LearningService — the orchestrator over the learning layer (PRD §15/§31).
 *
 * It owns no durable storage of its own: every row is written through the
 * injected `LearningStore` family, every durable target change goes through
 * `PromotionEngine` (never around it), and every durable change stays reversible
 * through `RollbackManager`.
 *
 * Wiring rules:
 * - The leaf engines are built here from injected deps (stores, targets,
 *   validator ports) so the composition layer never has to know their shapes.
 * - Event paths (`observeCompletion`, `recordCorrection`, `recordToolOutcome`,
 *   `recordContextUsage`) and reflection are fail-soft: telemetry must never
 *   break the caller.
 * - `ingestDistilled` is the MemoryService seam (PRD §45 Wave 3–4): it returns
 *   `handled:false` whenever learning is disabled so the caller keeps its
 *   legacy write path.
 */
import { createHash, randomUUID } from 'crypto'
import { existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import type {
  ConfidenceComponents,
  EvidenceRef,
  LearningCandidate,
  LearningCandidateStatus,
  LearningCandidateType,
  LearningEvidence,
  LearningEvidenceType,
  LearningExperiment,
  LearningObservation,
  LearningPolicy,
  LearningPromotionThresholds,
  LearningScope,
  LearningStatsDto,
  LearningTimelineEntryDto,
  TaskOutcome,
  UserCorrection,
} from '@rox/shared/memory/learning'
import {
  DEFAULT_LEARNING_THRESHOLDS,
  DEFAULT_SKILLS_LEARNING_POLICY,
  candidateFingerprint,
  computeConfidence,
} from '@rox/shared/memory/learning'
import type { SkillUsageMap } from '@rox/shared/memory/types'
import type { LearningRpcService } from '../../handlers/handler-deps'
import type {
  DistillIngestResult,
  EffectivenessReport,
  LearningServicePorts,
  LearningTargetStores,
  PromotionResult,
  ReflectionContext,
  ReflectionHypothesis,
  RollbackResult,
  StoredEvidence,
  ValidatorPorts,
} from './learning-types'
import type { CandidateStore } from './CandidateStore'
import { CandidateValidator, computeConfidenceComponents } from './CandidateValidator'
import { ConsolidationEngine } from './ConsolidationEngine'
import type { EvidenceStore } from './EvidenceStore'
import type { ExperimentStore } from './ExperimentStore'
import { GarbageCollector } from './GarbageCollector'
import type { GarbageInput, GarbageSkillRow } from './GarbageCollector'
import type { LearningAudit } from './LearningAudit'
import type { MutationStore } from './MutationStore'
import type { ObservationStore } from './ObservationStore'
import type { OutcomeStore } from './OutcomeStore'
import { PolicyLearner } from './PolicyLearner'
import type { PolicyStore } from './PolicyStore'
import { PromotionEngine } from './PromotionEngine'
import { ReflectionEngine } from './ReflectionEngine'
import { RollbackManager } from './RollbackManager'
import { scoreEffectiveness } from './EffectivenessScorer'
import { SkillEvolutionEngine } from './SkillEvolutionEngine'
import type { SkillCurationSkill } from './SkillEvolutionEngine'

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

const ZERO_COMPONENTS: ConfidenceComponents = {
  recurrence: 0,
  evidenceQuality: 0,
  userSignal: 0,
  repositorySupport: 0,
  outcomeSupport: 0,
  consistency: 0,
}

export interface LearningServiceLogger {
  warn(message: string, error?: unknown): void
  info?(message: string, meta?: unknown): void
  error?(message: string, meta?: unknown): void
}

/** The durable stores the service orchestrates (all workspace-scoped). */
export interface LearningServiceStores {
  observations: ObservationStore
  candidates: CandidateStore
  evidence: EvidenceStore
  outcomes: OutcomeStore
  mutations: MutationStore
  experiments: ExperimentStore
  policies: PolicyStore
}

export interface LearningServiceDeps {
  workspaceRoot: string
  workspaceId: string
  /** Injectable clock returning epoch ms (ISO conversion happens here). */
  clock?: () => number
  logger?: LearningServiceLogger
  /** Reflection/distillation LLM call. */
  distiller?: (prompt: string, sessionId?: string) => Promise<string>
  /** Validation judge LLM call. */
  judge?: (prompt: string) => Promise<string>
  audit?: LearningAudit
  thresholds?: LearningPromotionThresholds
  stores: LearningServiceStores
  targets: LearningTargetStores
  validatorPorts: ValidatorPorts
}

export class LearningService implements LearningServicePorts, LearningRpcService {
  private readonly deps: LearningServiceDeps
  private readonly stores: LearningServiceStores
  private readonly clock: () => number
  private readonly logger: LearningServiceLogger
  private readonly thresholds: LearningPromotionThresholds
  private readonly validator: CandidateValidator
  private readonly promoter: PromotionEngine
  private readonly rollback: RollbackManager
  private readonly reflection: ReflectionEngine
  private readonly consolidation = new ConsolidationEngine()
  private readonly curation: SkillEvolutionEngine
  private readonly policyLearner: PolicyLearner
  private readonly garbage: GarbageCollector
  /** Every promise this service spawned internally, for `whenIdle()`. */
  private readonly pending = new Set<Promise<unknown>>()

  constructor(deps: LearningServiceDeps) {
    this.deps = deps
    this.stores = deps.stores
    this.clock = deps.clock ?? (() => Date.now())
    this.logger = deps.logger ?? { warn: () => {} }
    this.thresholds = deps.thresholds ?? DEFAULT_LEARNING_THRESHOLDS
    const ports: ValidatorPorts = { ...deps.validatorPorts, thresholds: this.thresholds }
    this.validator = new CandidateValidator(ports)
    this.promoter = new PromotionEngine({
      targets: deps.targets,
      mutationStore: deps.stores.mutations,
      candidateStore: deps.stores.candidates,
      evidenceStore: deps.stores.evidence,
      thresholds: this.thresholds,
      ...(deps.audit === undefined ? {} : { audit: deps.audit }),
      clock: this.clock,
    })
    this.rollback = new RollbackManager({
      targets: deps.targets,
      mutationStore: deps.stores.mutations,
      candidateStore: deps.stores.candidates,
      ...(deps.audit === undefined ? {} : { audit: deps.audit }),
      clock: this.clock,
    })
    this.reflection = new ReflectionEngine({
      logger: { warn: (message: string, error?: unknown) => this.logger.warn(message, error) },
      ...(deps.distiller === undefined ? {} : { distiller: deps.distiller }),
    })
    this.curation = new SkillEvolutionEngine({
      clock: this.clock,
      ...(deps.audit === undefined ? {} : { auditor: deps.audit }),
    })
    this.policyLearner = new PolicyLearner({ clock: this.clock })
    this.garbage = new GarbageCollector({ clock: this.clock })
  }

  // -------------------------------------------------------------------------
  // Event paths (PRD §8) — build/merge the session's observation, never throw.
  // -------------------------------------------------------------------------

  observeCompletion(evt: { workspaceId: string; sessionId: string; reason: 'complete' | 'interrupted' | 'error' | 'timeout' | 'branch' }): void {
    this.mutateObservation(evt.workspaceId, evt.sessionId, (observation) => {
      if (evt.reason === 'complete') {
        observation.outcome = { status: 'success' }
      } else if (evt.reason === 'error') {
        observation.outcome = { status: 'failure', reason: 'error' }
      } else if (evt.reason === 'timeout') {
        observation.outcome = { status: 'aborted', reason: 'timeout' }
      } else if (evt.reason === 'interrupted') {
        observation.outcome = { status: 'aborted', reason: 'interrupted' }
        observation.signals.interruptions += 1
      } else {
        observation.signals.branches += 1
      }
    })
    // A terminal session also yields its TaskOutcome row (PRD §3.5/§19), the
    // sole producer `evaluateOutcomes` (§40) reads. 'branch' is not terminal.
    const outcome = this.terminalOutcome(evt)
    if (outcome !== null) this.recordOutcome(evt.workspaceId, outcome)
  }

  /**
   * Deterministic TaskOutcome for a terminal session (PRD §3.5/§19), built from
   * the just-merged observation. No model calls; fields without a source
   * (durationMs/tokenUsage/verification) are omitted rather than fabricated.
   */
  private terminalOutcome(evt: { workspaceId: string; sessionId: string; reason: 'complete' | 'interrupted' | 'error' | 'timeout' | 'branch' }): TaskOutcome | null {
    if (evt.reason === 'branch') return null
    const observation = this.latestObservation(evt.sessionId)
    if (observation === null) return null
    const status: TaskOutcome['status'] =
      evt.reason === 'complete' ? 'success' : evt.reason === 'error' ? 'failure' : 'aborted'
    const outcome: TaskOutcome = {
      id: `out_${evt.sessionId}`,
      sessionId: evt.sessionId,
      workspaceId: evt.workspaceId,
      // Comparable-task fingerprint (PRD §19): stable across before/after of a
      // mutation — tools/skills are deliberately excluded.
      taskFingerprint: sha256(`${evt.workspaceId}\u0000${observation.task?.category ?? 'general'}`).slice(0, 32),
      status,
      userCorrections: observation.signals.userCorrections.length,
      memoryUsed: observation.memory.lessonsInjected.map((lesson) => lesson.rule),
      skillsUsed: [...new Set([...observation.execution.skills, ...observation.memory.skillsInjected])].sort(),
      errors: observation.signals.errors.map((error) => error.message),
      ts: observation.ts,
      ...(observation.owner === undefined ? {} : { owner: observation.owner }),
    }
    const passed = observation.artifacts.testsPassed
    const failed = observation.artifacts.testsFailed
    if (passed !== undefined || failed !== undefined) {
      const total = (passed ?? 0) + (failed ?? 0)
      if (total > 0) outcome.qualityScore = (passed ?? 0) / total
    }
    return outcome
  }

  recordCorrection(correction: UserCorrection): void {
    this.mutateObservation(correction.workspaceId ?? this.deps.workspaceId, correction.sessionId, (observation) => {
      if (!observation.signals.userCorrections.some((existing) => existing.id === correction.id)) {
        observation.signals.userCorrections.push(correction)
      }
    })
  }

  recordToolOutcome(input: { workspaceId: string; sessionId: string; tool: string; ok: boolean; error?: string; ts: string }): void {
    this.mutateObservation(input.workspaceId, input.sessionId, (observation) => {
      if (!observation.execution.tools.includes(input.tool)) observation.execution.tools.push(input.tool)
      if (!input.ok) {
        observation.signals.errors.push({
          tool: input.tool,
          message: input.error ?? 'tool failed',
          ts: input.ts,
        })
      }
    })
  }

  recordContextUsage(input: { workspaceId: string; sessionId: string; lessons: Array<{ rule: string; scope: 'global' | 'workspace' }>; skills: string[] }): void {
    this.mutateObservation(input.workspaceId, input.sessionId, (observation) => {
      observation.memory.lessonsInjected = input.lessons.map((lesson) => ({ rule: lesson.rule, scope: lesson.scope }))
      observation.memory.skillsInjected = [...input.skills]
    })
  }

  // -------------------------------------------------------------------------
  // Small shared helpers
  // -------------------------------------------------------------------------

  private nowIso(): string {
    return new Date(this.clock()).toISOString()
  }

  /** Deterministic evidence row id so re-runs stay idempotent and fingerprints stable. */
  private evidenceRow(input: {
    type: LearningEvidenceType
    ref: string
    weight?: number
    metadata?: Record<string, unknown>
  }): StoredEvidence {
    const id = `ev_${sha256(`${input.type}\u0000${input.ref}`)}`
    return {
      id,
      type: input.type,
      ref: input.ref,
      weight: input.weight ?? 1,
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
      ts: this.nowIso(),
    }
  }

  /**
   * PRD §40/§41 — a rollback MUST leave failure evidence behind: one
   * deterministic `failed_outcome` row per reverted mutation, attached to the
   * owning candidate, so the reason a durable change was undone stays
   * learnable. Idempotent (EvidenceStore.add keeps the first row) and
   * fail-soft — evidence bookkeeping never breaks the rollback caller.
   */
  private recordRollbackFailureEvidence(candidateId: string, mutationIds: string[], reason?: string): void {
    try {
      const candidate = this.stores.candidates.get(candidateId)
      if (candidate === null) return
      let evidence = candidate.evidence
      let changed = false
      for (const mutationId of mutationIds) {
        const row = this.evidenceRow({
          type: 'failed_outcome',
          ref: mutationId,
          // Weight defaults to 1 — the same weight other failed_outcome rows use.
          metadata: { candidateId, mutationId, ...(reason === undefined ? {} : { reason }) },
        })
        const stored = this.stores.evidence.add(row)
        if (evidence.some((ref) => ref.evidenceId === stored.id)) continue
        evidence = [...evidence, { evidenceId: stored.id, type: stored.type, ref: stored.ref, weight: stored.weight }]
        changed = true
      }
      if (changed) this.stores.candidates.save({ ...candidate, evidence, updatedAt: this.nowIso() })
    } catch (error) {
      this.logger.warn(`LearningService: failed to record rollback evidence for ${candidateId}`, error)
    }
  }

  private emptyObservation(workspaceId: string, sessionId: string): LearningObservation {
    return {
      id: `obs_${randomUUID()}`,
      sessionId,
      workspaceId,
      ts: this.nowIso(),
      execution: { tools: [], skills: [], models: [], delegated: false },
      outcome: { status: 'partial' },
      signals: { userCorrections: [], errors: [], branches: 0, interruptions: 0 },
      memory: { lessonsInjected: [], episodesRecalled: [], skillsInjected: [] },
      artifacts: { filesChanged: 0 },
    }
  }

  private latestObservation(sessionId: string): LearningObservation | null {
    try {
      const rows = this.stores.observations.listBySession(sessionId)
      return rows.length > 0 ? rows[rows.length - 1]! : null
    } catch {
      return null
    }
  }

  /** Merge `mutate` into the session's latest observation (or a fresh one). Never throws. */
  private mutateObservation(workspaceId: string, sessionId: string, mutate: (observation: LearningObservation) => void): void {
    try {
      const base = this.latestObservation(sessionId) ?? this.emptyObservation(workspaceId, sessionId)
      const next = JSON.parse(JSON.stringify(base)) as LearningObservation
      mutate(next)
      next.ts = this.nowIso()
      this.stores.observations.append(next)
    } catch (error) {
      this.logger.warn('LearningService: failed to record observation', error)
    }
  }

  private candidateDraft(input: {
    type: LearningCandidateType
    scope: LearningScope
    hypothesis: string
    evidence: EvidenceRef[]
    payload?: unknown
    modelConfidenceEstimate?: number
  }): LearningCandidate {
    const fingerprint = candidateFingerprint(
      { type: input.type, hypothesis: input.hypothesis, scope: input.scope, evidenceIds: input.evidence.map((ref) => ref.evidenceId) },
      sha256,
    )
    const ts = this.nowIso()
    return {
      id: `cand_${sha256(fingerprint).slice(0, 32)}`,
      fingerprint,
      type: input.type,
      scope: input.scope,
      hypothesis: input.hypothesis,
      payload: input.payload ?? {},
      evidence: input.evidence,
      confidence: 0,
      confidenceComponents: { ...ZERO_COMPONENTS },
      status: 'candidate',
      validation: { passes: [], promotable: false, checkedAt: ts },
      ...(input.modelConfidenceEstimate === undefined ? {} : { modelConfidenceEstimate: input.modelConfidenceEstimate }),
      createdAt: ts,
      updatedAt: ts,
    }
  }

  /** Run deterministic validation, stamp confidence + validation, persist. */
  private async validateAndStore(
    candidate: LearningCandidate,
    evidenceRows: StoredEvidence[],
  ): Promise<LearningCandidate> {
    const validation = await this.validator.validate({
      candidate,
      evidence: evidenceRows,
      workspaceRoot: this.deps.workspaceRoot,
      ...(this.deps.judge === undefined ? {} : { judge: this.deps.judge }),
    })
    const validated: LearningCandidate = {
      ...candidate,
      validation,
      updatedAt: this.nowIso(),
    }
    const components = computeConfidenceComponents({
      candidate: validated,
      evidence: evidenceRows,
      repoSignals: this.repositorySignals(),
      priorOutcomes: [],
    })
    validated.confidenceComponents = components
    validated.confidence = computeConfidence(components)
    this.stores.candidates.save(validated)
    return validated
  }

  private repositorySignals(): string[] {
    try {
      const signals = this.deps.validatorPorts.readRepositorySignals(this.deps.workspaceRoot)
      return Array.isArray(signals) ? signals : []
    } catch {
      return []
    }
  }

  private policy(): { enabled: boolean; modeFor: (kind: 'lesson' | 'skill', supersedes?: string) => 'off' | 'candidate' | 'autonomous' } {
    let policy = DEFAULT_SKILLS_LEARNING_POLICY
    try {
      const read = this.deps.validatorPorts.readSkillsLearningPolicy()
      if (read && typeof read === 'object') policy = read
    } catch (error) {
      this.logger.warn('LearningService: failed to read skills learning policy', error)
    }
    return {
      enabled: policy.enabled !== false,
      modeFor: (kind, supersedes) =>
        kind === 'skill' && supersedes ? policy.autoImprove : policy.autoCreate,
    }
  }

  private track<T>(promise: Promise<T>): Promise<T> {
    const tracked: Promise<T> = promise.finally(() => {
      this.pending.delete(tracked)
    })
    this.pending.add(tracked)
    return tracked
  }

  async whenIdle(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.allSettled([...this.pending])
    }
  }

  // -------------------------------------------------------------------------
  // Distillation seam (PRD §45 Wave 3–4)
  // -------------------------------------------------------------------------

  ingestDistilled(input: {
    workspaceId: string
    sessionId: string
    kind: 'lesson' | 'skill'
    rule?: string
    category?: string
    negative?: boolean
    scope?: LearningScope
    skill?: { slug: string; description: string; body: string; supersedes?: string }
  }): Promise<DistillIngestResult> {
    return this.track(this.ingest(input))
  }

  private async ingest(input: Parameters<LearningServicePorts['ingestDistilled']>[0]): Promise<DistillIngestResult> {
    try {
      const policy = this.policy()
      const isSkill = input.kind === 'skill'
      const supersedes = input.skill?.supersedes
      const mode = policy.modeFor(input.kind, supersedes)
      if (!policy.enabled || mode === 'off') {
        return { handled: false, promoted: false, reason: 'learning disabled' }
      }

      const scope: LearningScope = input.scope ?? 'workspace'
      const evidence = this.evidenceRow(
        isSkill
          ? { type: 'skill_usage', ref: input.skill?.slug ?? input.sessionId, weight: 1, metadata: { sessionId: input.sessionId, kind: input.kind } }
          : {
              type: input.negative === true ? 'user_correction' : 'session',
              ref: input.sessionId,
              weight: 1,
              metadata: { sessionId: input.sessionId, kind: input.kind },
            },
      )
      this.stores.evidence.add(evidence)
      const evidenceRef: EvidenceRef = {
        evidenceId: evidence.id,
        type: evidence.type,
        ref: evidence.ref,
        weight: evidence.weight,
      }

      const hypothesis = isSkill
        ? `Skill candidate '${input.skill?.slug ?? 'unknown'}': ${input.skill?.description ?? ''}`.trim()
        : (input.rule ?? '').trim() || `Distilled lesson from session ${input.sessionId}`
      const payload = isSkill
        ? {
            slug: input.skill?.slug ?? 'unknown',
            description: input.skill?.description ?? '',
            body: input.skill?.body ?? '',
            ...(supersedes === undefined ? {} : { supersedes }),
          }
        : {
            rule: input.rule,
            ...(input.category === undefined ? {} : { category: input.category }),
            ...(input.negative === undefined ? {} : { negative: input.negative }),
          }

      const fingerprint = candidateFingerprint(
        { type: isSkill ? 'skill' : 'lesson', hypothesis, scope, evidenceIds: [evidence.id] },
        sha256,
      )
      const existing = this.stores.candidates.getByFingerprint(fingerprint)
      const candidate =
        existing === null
          ? this.candidateDraft({ type: isSkill ? 'skill' : 'lesson', scope, hypothesis, payload, evidence: [evidenceRef] })
          : existing.evidence.some((ref) => ref.evidenceId === evidence.id)
            ? existing
            : { ...existing, evidence: [...existing.evidence, evidenceRef], updatedAt: this.nowIso() }

      const rows = this.stores.evidence.listByIds(candidate.evidence.map((ref) => ref.evidenceId))
      const validated = await this.validateAndStore(candidate, rows)
      const candidateId = validated.id

      if (mode === 'candidate') {
        return { handled: true, promoted: false, candidateId, reason: 'awaiting review' }
      }
      if (!validated.validation.promotable) {
        return { handled: true, promoted: false, candidateId, reason: 'not promotable' }
      }
      const result = await this.promoter.promote(validated, { approval: 'autonomous', workspaceId: input.workspaceId })
      return {
        handled: true,
        promoted: result.promoted,
        candidateId,
        ...(result.reason === undefined ? {} : { reason: result.reason }),
      }
    } catch (error) {
      this.logger.warn('LearningService: ingestDistilled failed', error)
      return { handled: false, promoted: false, reason: 'learning ingestion failed' }
    }
  }

  // -------------------------------------------------------------------------
  // Reflection (PRD §36)
  // -------------------------------------------------------------------------

  reflectSession(workspaceId: string, sessionId: string): Promise<{ candidates: LearningCandidate[] }> {
    return this.track(this.reflect(workspaceId, sessionId))
  }

  private async reflect(workspaceId: string, sessionId: string): Promise<{ candidates: LearningCandidate[] }> {
    try {
      const observation = this.latestObservation(sessionId) ?? this.emptyObservation(workspaceId, sessionId)
      const context: ReflectionContext = {
        workspaceRoot: this.deps.workspaceRoot,
        workspaceId,
        ...(observation.signals.userCorrections.length > 0 ? { userCorrections: observation.signals.userCorrections } : {}),
        ...(observation.signals.verification === undefined ? {} : { verification: observation.signals.verification }),
      }
      const result = await this.reflection.reflect({ observation, context, sessionId })
      const created: LearningCandidate[] = []
      for (const hypothesis of result.hypotheses) {
        const candidate = await this.materializeHypothesis(workspaceId, sessionId, hypothesis)
        if (candidate) created.push(candidate)
      }
      return { candidates: created }
    } catch (error) {
      this.logger.warn('LearningService: reflectSession failed', error)
      return { candidates: [] }
    }
  }

  /** Turn one reflection (or consolidation) hypothesis into a validated candidate. */
  private async materializeHypothesis(
    workspaceId: string,
    sessionId: string,
    hypothesis: ReflectionHypothesis,
  ): Promise<LearningCandidate | null> {
    const scope = hypothesis.scope
    const rows: StoredEvidence[] = hypothesis.evidenceRefs.map((ref) =>
      this.evidenceRow({
        type: ref.type,
        ref: ref.ref,
        weight: ref.weight,
        metadata: { ...(ref.metadata ?? {}), sessionId },
      }),
    )
    const evidence: EvidenceRef[] = rows.map((row) => ({
      evidenceId: row.id,
      type: row.type,
      ref: row.ref,
      weight: row.weight,
    }))
    const fingerprint = candidateFingerprint(
      { type: hypothesis.type, hypothesis: hypothesis.hypothesis, scope, evidenceIds: evidence.map((ref) => ref.evidenceId) },
      sha256,
    )
    const existing = this.stores.candidates.getByFingerprint(fingerprint)
    if (existing && existing.status === 'candidate') {
      this.stores.evidence.addMany(rows)
      return existing
    }
    this.stores.evidence.addMany(rows)
    const draft =
      existing ??
      this.candidateDraft({
        type: hypothesis.type,
        scope,
        hypothesis: hypothesis.hypothesis,
        payload:
          hypothesis.payload ?? {
            rule: hypothesis.hypothesis,
            ...(hypothesis.category === undefined ? {} : { category: hypothesis.category }),
          },
        evidence,
        ...(hypothesis.modelConfidenceEstimate === undefined ? {} : { modelConfidenceEstimate: hypothesis.modelConfidenceEstimate }),
      })
    try {
      return await this.validateAndStore(draft, rows)
    } catch (error) {
      this.logger.warn(`LearningService: failed to materialize hypothesis for ${workspaceId}`, error)
      return null
    }
  }

  // -------------------------------------------------------------------------
  // Background jobs (PRD §10-§14)
  // -------------------------------------------------------------------------

  runConsolidation(workspaceId: string): Promise<{ candidates: LearningCandidate[] }> {
    return this.track(this.consolidate(workspaceId))
  }

  private async consolidate(workspaceId: string): Promise<{ candidates: LearningCandidate[] }> {
    try {
      const drafts = this.consolidation.run({ observations: this.stores.observations.list() })
      const created: LearningCandidate[] = []
      for (const draft of drafts) {
        const sessionId = draft.pattern.sessionIds[0] ?? draft.pattern.observationIds[0] ?? 'consolidation'
        const candidate = await this.materializeHypothesis(workspaceId, sessionId, draft.hypothesis)
        if (candidate) created.push(candidate)
      }
      return { candidates: created }
    } catch (error) {
      this.logger.warn('LearningService: runConsolidation failed', error)
      return { candidates: [] }
    }
  }

  runSkillCuration(workspaceId: string): Promise<{ items: Array<{ slug: string; action: 'keep' | 'improve' | 'archive' }> }> {
    return this.track(this.curateSkills(workspaceId))
  }

  private async curateSkills(workspaceId: string): Promise<{ items: Array<{ slug: string; action: 'keep' | 'improve' | 'archive' }> }> {
    try {
      const inventory = this.skillInventory()
      const decisions = this.curation.curate({
        skills: inventory.skills,
        usage: inventory.usage,
        outcomes: this.stores.outcomes.list(),
      })
      return { items: decisions.map((decision) => ({ slug: decision.slug, action: decision.action })) }
    } catch (error) {
      this.logger.warn(`LearningService: runSkillCuration failed for ${workspaceId}`, error)
      return { items: [] }
    }
  }

  runPolicyLearning(workspaceId: string): Promise<{ policies: LearningPolicy[] }> {
    return this.track(this.learnPolicies(workspaceId))
  }

  private async learnPolicies(workspaceId: string): Promise<{ policies: LearningPolicy[] }> {
    try {
      const policies = this.policyLearner.learn({
        observations: this.stores.observations.list(),
        outcomes: this.stores.outcomes.list(),
      })
      for (const policy of policies) {
        const rows = policy.evidence.map((ref) => this.evidenceRow({ type: ref.type, ref: ref.ref, weight: ref.weight }))
        this.stores.evidence.addMany(rows)
        const evidence: EvidenceRef[] = rows.map((row) => ({
          evidenceId: row.id,
          type: row.type,
          ref: row.ref,
          weight: row.weight,
        }))
        const hypothesis = `Policy for task class '${policy.taskClass}'`
        const fingerprint = candidateFingerprint(
          { type: 'policy', hypothesis, scope: 'workspace', evidenceIds: evidence.map((ref) => ref.evidenceId) },
          sha256,
        )
        if (this.stores.candidates.getByFingerprint(fingerprint)) continue
        const payload = {
          taskClass: policy.taskClass,
          preferredSkills: policy.preferredSkills,
          verification: policy.verification,
          delegation: policy.delegation,
          ...(policy.preferredModel === undefined ? {} : { preferredModel: policy.preferredModel }),
          ...(policy.toolOrder === undefined ? {} : { toolOrder: policy.toolOrder }),
        }
        await this.validateAndStore(
          this.candidateDraft({ type: 'policy', scope: 'workspace', hypothesis, payload, evidence }),
          rows,
        )
      }
      return { policies }
    } catch (error) {
      this.logger.warn(`LearningService: runPolicyLearning failed for ${workspaceId}`, error)
      return { policies: [] }
    }
  }

  runGarbageCollection(workspaceId: string): Promise<{ archived: number }> {
    return this.track(this.collectGarbage(workspaceId))
  }

  /**
   * Produces archive recommendations (PRD §14) and applies them through the
   * collector's reversible archive port. `LearningTargetStores` (frozen) exposes
   * no archive member, so without an injected port nothing is archived — the
   * recommendations are audited instead and no data is ever deleted.
   */
  private async collectGarbage(workspaceId: string): Promise<{ archived: number }> {
    try {
      const inventory = this.skillInventory()
      const skills: GarbageSkillRow[] = inventory.skills
        .filter((skill) => skill.approved)
        .map((skill) => ({
          slug: skill.slug,
          uses: inventory.usage[skill.slug]?.used ?? 0,
          lastUsedAt: inventory.usage[skill.slug]?.lastUsedAt ?? '',
          approved: true,
        }))
      const input: GarbageInput = {
        skills,
        policies: this.stores.policies.listByStatus('rolled_back').map((policy) => ({ id: policy.id, updatedAt: policy.updatedAt })),
        now: this.clock(),
      }
      const recommendations = this.garbage.collect(input)
      for (const recommendation of recommendations) {
        this.deps.audit?.append({
          ts: this.nowIso(),
          actor: 'learning',
          action: 'garbage-collection',
          target: recommendation.targetId,
          detail: `${recommendation.targetType}:${recommendation.reason} — ${recommendation.detail}`,
        })
      }
      return { archived: this.garbage.apply(recommendations) }
    } catch (error) {
      this.logger.warn(`LearningService: runGarbageCollection failed for ${workspaceId}`, error)
      return { archived: 0 }
    }
  }

  // -------------------------------------------------------------------------
  // Outcome evaluation + automatic rollback (PRD §40)
  // -------------------------------------------------------------------------

  evaluateOutcomes(workspaceId: string): Promise<{ rolledBack: string[] }> {
    return this.track(this.evaluate(workspaceId))
  }

  private async evaluate(workspaceId: string): Promise<{ rolledBack: string[] }> {
    const rolledBack: string[] = []
    try {
      const outcomes = this.stores.outcomes.list()
      for (const candidate of this.stores.candidates.listActive()) {
        const mutations = this.stores.mutations
          .listByCandidate(candidate.id)
          .filter((mutation) => mutation.status === 'applied' || mutation.status === 'confirmed')
        if (mutations.length === 0) continue
        const since = mutations.map((mutation) => mutation.ts).sort((a, b) => a.localeCompare(b))[0]!
        const before = outcomes.filter((outcome) => outcome.ts < since)
        const after = outcomes.filter((outcome) => outcome.ts >= since)
        if (after.length === 0) continue

        const baselineSuccess = before.length === 0 ? 0 : before.filter((outcome) => outcome.status === 'success').length / before.length
        // Error-rate trigger (PRD §40): an outcome "errored" when it carries any
        // signal error. No baseline window ⇒ no trigger (mirrors the successDrop
        // path — a delta cannot be proven without one). The PRD names no number
        // for this delta, so `rollbackSuccessDrop` doubles as the error-rate
        // threshold.
        const beforeErrorRate = before.length === 0 ? 0 : before.filter((outcome) => outcome.errors.length > 0).length / before.length
        const afterErrorRate = after.filter((outcome) => outcome.errors.length > 0).length / after.length
        const errorRateIncrease = before.length === 0 ? 0 : afterErrorRate - beforeErrorRate
        const report = scoreEffectiveness({
          outcomes: after,
          usageCount: after.length,
          corrections: after.reduce((sum, outcome) => sum + (outcome.userCorrections ?? 0), 0),
          conflicts: 0,
        })
        const successDrop = baselineSuccess - report.components.successRate
        const successTrigger = successDrop > this.thresholds.rollbackSuccessDrop
        const errorRateTrigger = errorRateIncrease > this.thresholds.rollbackSuccessDrop
        const correctionTrigger = report.components.correctionRate > this.thresholds.rollbackCorrectionRate
        if (!successTrigger && !errorRateTrigger && !correctionTrigger) {
          continue
        }
        const reason = successTrigger
          ? `success rate dropped ${successDrop.toFixed(2)} below baseline`
          : errorRateTrigger
            ? `error rate increased ${errorRateIncrease.toFixed(2)} above baseline`
            : `correction rate ${report.components.correctionRate.toFixed(2)} above threshold`
        const result = this.rollback.revertCandidate(candidate.id, reason)
        if (result.reverted) {
          rolledBack.push(candidate.id)
          this.recordRollbackFailureEvidence(candidate.id, result.mutationIds, reason)
        }
      }
      return { rolledBack }
    } catch (error) {
      this.logger.warn(`LearningService: evaluateOutcomes failed for ${workspaceId}`, error)
      return { rolledBack }
    }
  }

  // -------------------------------------------------------------------------
  // RPC read surface (PRD §15)
  // -------------------------------------------------------------------------

  listCandidates(_workspaceId: string, filter?: { status?: LearningCandidateStatus }): LearningCandidate[] {
    try {
      return filter?.status ? this.stores.candidates.listByStatus(filter.status) : this.stores.candidates.list()
    } catch (error) {
      this.logger.warn('LearningService: listCandidates failed', error)
      return []
    }
  }

  getCandidate(_workspaceId: string, id: string): LearningCandidate | null {
    try {
      return this.stores.candidates.get(id)
    } catch (error) {
      this.logger.warn('LearningService: getCandidate failed', error)
      return null
    }
  }

  approveCandidate(workspaceId: string, id: string): Promise<PromotionResult> {
    return this.track(this.approve(workspaceId, id))
  }

  private async approve(workspaceId: string, id: string): Promise<PromotionResult> {
    try {
      const candidate = this.stores.candidates.get(id)
      if (!candidate) {
        return { promoted: false, status: 'rejected', mutations: [], reason: 'unknown candidate' }
      }
      return await this.promoter.promote(candidate, { approval: 'user', workspaceId })
    } catch (error) {
      this.logger.warn(`LearningService: approveCandidate failed for ${id}`, error)
      return { promoted: false, status: 'rejected', mutations: [], reason: 'promotion failed' }
    }
  }

  rejectCandidate(_workspaceId: string, id: string, reason?: string): LearningCandidate | null {
    try {
      const candidate = this.stores.candidates.get(id)
      if (!candidate) return null
      const rejected: LearningCandidate = {
        ...candidate,
        status: 'rejected',
        ...(reason === undefined ? {} : { rejectedReason: reason }),
        updatedAt: this.nowIso(),
      }
      this.stores.candidates.save(rejected)
      this.deps.audit?.append({
        ts: rejected.updatedAt,
        actor: 'learning',
        action: 'reject',
        target: id,
        ...(reason === undefined ? {} : { detail: reason }),
      })
      return rejected
    } catch (error) {
      this.logger.warn(`LearningService: rejectCandidate failed for ${id}`, error)
      return null
    }
  }

  rollbackCandidate(workspaceId: string, id: string): Promise<RollbackResult> {
    return this.track(this.revert(workspaceId, id))
  }

  private async revert(workspaceId: string, id: string): Promise<RollbackResult> {
    try {
      if (!this.stores.candidates.get(id)) {
        return { reverted: false, mutationIds: [], reason: 'unknown candidate' }
      }
      const reason = `manual rollback from ${workspaceId}`
      const result = this.rollback.revertCandidate(id, reason)
      if (result.reverted) this.recordRollbackFailureEvidence(id, result.mutationIds, reason)
      return result
    } catch (error) {
      this.logger.warn(`LearningService: rollbackCandidate failed for ${id}`, error)
      return { reverted: false, mutationIds: [], reason: 'rollback failed' }
    }
  }

  getTimeline(_workspaceId: string, limit?: number): LearningTimelineEntryDto[] {
    try {
      const entries: LearningTimelineEntryDto[] = []
      for (const observation of this.stores.observations.list()) {
        entries.push({
          ts: observation.ts,
          kind: 'observation',
          id: observation.id,
          sessionId: observation.sessionId,
          summary: `${observation.outcome.status} ${observation.sessionId}`,
          detail: observation.execution.tools.join(', '),
        })
      }
      for (const candidate of this.stores.candidates.list()) {
        entries.push({
          ts: candidate.createdAt,
          kind: 'candidate',
          id: candidate.id,
          summary: `${candidate.type} ${candidate.status}: ${candidate.hypothesis}`,
          detail: `confidence ${candidate.confidence.toFixed(2)}`,
        })
      }
      for (const mutation of this.stores.mutations.list()) {
        entries.push({
          ts: mutation.ts,
          kind: 'mutation',
          id: mutation.id,
          summary: `${mutation.targetType} ${mutation.targetId} → ${mutation.status}`,
          detail: mutation.reason,
        })
        if (mutation.status === 'reverted') {
          entries.push({
            ts: mutation.revertedAt ?? mutation.ts,
            kind: 'rollback',
            id: mutation.id,
            summary: `reverted ${mutation.targetType} ${mutation.targetId}`,
            detail: mutation.reason,
          })
        }
      }
      for (const outcome of this.stores.outcomes.list()) {
        entries.push({
          ts: outcome.ts,
          kind: 'outcome',
          id: outcome.id,
          sessionId: outcome.sessionId,
          summary: `${outcome.status} (${outcome.taskFingerprint})`,
          detail: outcome.errors.length > 0 ? outcome.errors.join('; ') : undefined,
        })
      }
      for (const experiment of this.stores.experiments.list()) {
        entries.push({
          ts: experiment.createdAt,
          kind: 'experiment',
          id: experiment.id,
          summary: `experiment ${experiment.status} (${experiment.sampleSize} samples)`,
          detail: experiment.candidateId,
        })
      }
      entries.sort((a, b) => b.ts.localeCompare(a.ts))
      return typeof limit === 'number' && Number.isFinite(limit) && limit > 0 ? entries.slice(0, limit) : entries
    } catch (error) {
      this.logger.warn('LearningService: getTimeline failed', error)
      return []
    }
  }

  getStats(_workspaceId: string): LearningStatsDto {
    try {
      const mutations = this.stores.mutations.list()
      return {
        observations: this.stores.observations.list().length,
        candidates: this.stores.candidates.list().length,
        activeCandidates: this.stores.candidates.listActive().length,
        rejectedCandidates: this.stores.candidates.listByStatus('rejected').length,
        outcomes: this.stores.outcomes.list().length,
        mutations: mutations.length,
        revertedMutations: mutations.filter((mutation) => mutation.status === 'reverted').length,
        policies: this.stores.policies.list().length,
      }
    } catch (error) {
      this.logger.warn('LearningService: getStats failed', error)
      return {
        observations: 0,
        candidates: 0,
        activeCandidates: 0,
        rejectedCandidates: 0,
        outcomes: 0,
        mutations: 0,
        revertedMutations: 0,
        policies: 0,
      }
    }
  }

  // -------------------------------------------------------------------------
  // RPC bridge surface (PRD §15) — `LearningRpcService` overrides (WP-108b).
  // Declared on the handler-side interface, never on the frozen `ports` file.
  // -------------------------------------------------------------------------

  /** Evidence rows for one candidate, or the whole workspace ledger when no candidate is addressed. */
  listEvidence(_workspaceId: string, candidateId?: string): LearningEvidence[] {
    try {
      if (candidateId === undefined) return this.stores.evidence.list()
      const candidate = this.stores.candidates.get(candidateId)
      if (!candidate) return []
      return this.stores.evidence.listByIds(candidate.evidence.map((ref) => ref.evidenceId))
    } catch (error) {
      this.logger.warn('LearningService: listEvidence failed', error)
      return []
    }
  }

  /** One recorded task outcome (PRD §19/§3.5), by id. */
  getOutcome(_workspaceId: string, id: string): TaskOutcome | null {
    try {
      return this.stores.outcomes.get(id)
    } catch (error) {
      this.logger.warn('LearningService: getOutcome failed', error)
      return null
    }
  }

  /** One A/B experiment (PRD §3.4), by id. */
  getExperiment(_workspaceId: string, id: string): LearningExperiment | null {
    try {
      return this.stores.experiments.get(id)
    } catch (error) {
      this.logger.warn('LearningService: getExperiment failed', error)
      return null
    }
  }

  /** Learned orchestration policies (PRD §3.7); the handler applies any id filter. */
  getPolicies(_workspaceId: string): LearningPolicy[] {
    try {
      return this.stores.policies.list()
    } catch (error) {
      this.logger.warn('LearningService: getPolicies failed', error)
      return []
    }
  }

  /**
   * Effectiveness report (PRD §18) for a skill slug / lesson rule / policy id.
   * Mirrors `evaluate()`'s input build: outcomes feed success/correction rates,
   * the S4 usage ledger supplies skill reuse. Unknown ids score as lessons.
   */
  getSkillEffectiveness(_workspaceId: string, targetId: string): EffectivenessReport | null {
    try {
      const inventory = this.skillInventory()
      const isSkill = inventory.skills.some((skill) => skill.slug === targetId)
      const isPolicy = !isSkill && this.stores.policies.get(targetId) !== null
      const targetType: EffectivenessReport['targetType'] = isSkill ? 'skill' : isPolicy ? 'policy' : 'lesson'
      const allOutcomes = this.stores.outcomes.list()
      const outcomes = isSkill
        ? allOutcomes.filter((outcome) => outcome.skillsUsed.includes(targetId))
        : allOutcomes
      const usageCount = isSkill
        ? Math.max(inventory.usage[targetId]?.used ?? 0, outcomes.length)
        : outcomes.length
      return scoreEffectiveness(
        {
          outcomes,
          usageCount,
          corrections: outcomes.reduce((sum, outcome) => sum + (outcome.userCorrections ?? 0), 0),
          conflicts: 0,
        },
        { targetType, targetId },
      )
    } catch (error) {
      this.logger.warn(`LearningService: getSkillEffectiveness failed for ${targetId}`, error)
      return null
    }
  }

  /** Re-runs the frozen 8-pass deterministic validation and persists the re-stamped row. */
  revalidateCandidate(workspaceId: string, id: string): Promise<LearningCandidate | null> {
    return this.track(this.revalidate(workspaceId, id))
  }

  private async revalidate(_workspaceId: string, id: string): Promise<LearningCandidate | null> {
    try {
      const candidate = this.stores.candidates.get(id)
      if (!candidate) return null
      const rows = this.stores.evidence.listByIds(candidate.evidence.map((ref) => ref.evidenceId))
      return await this.validateAndStore(candidate, rows)
    } catch (error) {
      this.logger.warn(`LearningService: revalidateCandidate failed for ${id}`, error)
      return null
    }
  }

  /** Records one task outcome (PRD §3.5), idempotent by outcome id; never throws. */
  recordOutcome(workspaceId: string, outcome: TaskOutcome): void {
    try {
      const row: TaskOutcome = outcome.workspaceId === undefined ? { ...outcome, workspaceId } : outcome
      if (!this.stores.outcomes.get(row.id)) this.stores.outcomes.append(row)
    } catch (error) {
      this.logger.warn('LearningService: recordOutcome failed', error)
    }
  }

  // -------------------------------------------------------------------------
  // Workspace skill inventory (S4 layout) — the curation/GC input adapter
  // -------------------------------------------------------------------------

  private skillInventory(): { skills: SkillCurationSkill[]; usage: SkillUsageMap } {
    const skillsRoot = join(this.deps.workspaceRoot, 'skills')
    const pendingRoot = join(skillsRoot, '.pending')
    const approved = this.listSkillDirs(skillsRoot)
    const pending = this.listSkillDirs(pendingRoot)
    const slugs = [...new Set([...approved, ...pending])].sort((a, b) => a.localeCompare(b))
    const skills: SkillCurationSkill[] = slugs.map((slug) => {
      const isApproved = approved.includes(slug)
      const isPending = pending.includes(slug)
      const body = this.readSkillBody(
        isApproved ? join(skillsRoot, slug, 'SKILL.md') : isPending ? join(pendingRoot, slug, 'SKILL.md') : '',
      )
      const pendingSince = isPending ? this.readPendingSince(join(pendingRoot, slug, '.meta.json')) : undefined
      return {
        slug,
        pending: isPending,
        approved: isApproved,
        hasBody: body.trim().length > 0,
        ...(pendingSince === undefined ? {} : { pendingSince }),
      }
    })
    return { skills, usage: this.readSkillUsage(join(skillsRoot, '.usage.jsonl')) }
  }

  private listSkillDirs(root: string): string[] {
    try {
      if (!existsSync(root)) return []
      return readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .map((entry) => entry.name)
    } catch (error) {
      this.logger.warn(`LearningService: failed to list skills under ${root}`, error)
      return []
    }
  }

  private readSkillBody(filePath: string): string {
    if (!filePath) return ''
    try {
      return existsSync(filePath) ? readFileSync(filePath, 'utf-8') : ''
    } catch (error) {
      this.logger.warn(`LearningService: failed to read ${filePath}`, error)
      return ''
    }
  }

  private readPendingSince(metaPath: string): string | undefined {
    try {
      if (!existsSync(metaPath)) return undefined
      const parsed = JSON.parse(readFileSync(metaPath, 'utf-8')) as {
        createdAt?: unknown
        source?: { ts?: unknown }
      }
      const ts = parsed.source?.ts ?? parsed.createdAt
      return typeof ts === 'string' && ts ? ts : undefined
    } catch {
      return undefined
    }
  }

  /** Aggregate the S4 usage ledger per slug; missing file → `{}`, corrupt lines skipped. */
  private readSkillUsage(filePath: string): SkillUsageMap {
    const usage: SkillUsageMap = {}
    try {
      if (!existsSync(filePath)) return usage
      for (const line of readFileSync(filePath, 'utf-8').split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) continue
        let parsed: { ts?: unknown; skills?: unknown }
        try {
          parsed = JSON.parse(trimmed) as { ts?: unknown; skills?: unknown }
        } catch {
          continue
        }
        if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.skills)) continue
        const ts = typeof parsed.ts === 'string' ? parsed.ts : ''
        for (const slug of new Set(parsed.skills.filter((item): item is string => typeof item === 'string'))) {
          const entry = usage[slug] ?? { used: 0, lastUsedAt: '' }
          entry.used += 1
          if (ts > entry.lastUsedAt) entry.lastUsedAt = ts
          usage[slug] = entry
        }
      }
      return usage
    } catch (error) {
      this.logger.warn(`LearningService: failed to read skill usage from ${filePath}`, error)
      return usage
    }
  }
}