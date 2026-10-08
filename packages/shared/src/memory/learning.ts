/**
 * Continual learning & self-improvement — shared types and pure helpers.
 *
 * PRD: docs/plans/2026-10-08-continual-learning-prd.md (§3, §34, §38).
 *
 * Norm (PRD §48): LLM-generated learning output is always a hypothesis until
 * validated by evidence. Nothing in this file writes durable state — the
 * server-core learning/ module orchestrates existing stores
 * (LessonStore / EpisodicMemory / SkillPendingQueue) on top of these types.
 *
 * Ownership follows the rest of the memory stack: an optional `owner` is
 * server-authenticated personal identity; it is never supplied by a renderer.
 */

export const LEARNING_SCHEMA_VERSION = 1

/** PRD §3.2 — where a candidate is allowed to land once promoted. */
export type LearningScope = 'global' | 'workspace' | 'project' | 'session'

export type LearningCandidateType = 'lesson' | 'skill' | 'preference' | 'policy'

export type LearningCandidateStatus =
  | 'candidate'
  | 'validating'
  | 'approved'
  | 'active'
  | 'rejected'
  | 'rolled_back'

/** PRD §3.8 — correction categories. */
export type UserCorrectionCategory =
  | 'fact'
  | 'preference'
  | 'workflow'
  | 'tool'
  | 'architecture'
  | 'style'

/** PRD §3.3 — evidence kinds. */
export type LearningEvidenceType =
  | 'session'
  | 'user_correction'
  | 'successful_outcome'
  | 'failed_outcome'
  | 'tool_trace'
  | 'git_diff'
  | 'test_result'
  | 'skill_usage'
  | 'memory_usage'
  | 'repository'
  | 'recurrence'

/** PRD §8 — lifecycle signals feeding observations. */
export type LearningObservationKind =
  | 'session_completed'
  | 'session_failed'
  | 'session_interrupted'
  | 'session_timeout'
  | 'session_branched'
  | 'user_correction'
  | 'tool_failure'
  | 'tool_result'
  | 'verification'
  | 'memory_conflict'
  | 'skill_usage'
  | 'task_outcome'

export type TaskOutcomeStatus = 'success' | 'failure' | 'partial' | 'aborted'

export interface LearningObservationExecution {
  tools: string[]
  skills: string[]
  models: string[]
  delegated: boolean
}

export interface LearningObservationSignals {
  userCorrections: UserCorrection[]
  errors: ExecutionError[]
  branches: number
  interruptions: number
  verification?: VerificationResult
}

export interface LearningObservationMemory {
  lessonsInjected: LessonUsage[]
  episodesRecalled: EpisodeUsage[]
  skillsInjected: string[]
}

export interface LearningObservationArtifacts {
  filesChanged: number
  testsPassed?: number
  testsFailed?: number
}

export interface ExecutionError {
  tool?: string
  message: string
  ts?: string
}

export interface VerificationResult {
  testsPassed?: number
  testsFailed?: number
  buildPassed?: boolean
  lintPassed?: boolean
  typecheckPassed?: boolean
}

export interface LessonUsage {
  rule: string
  scope: 'global' | 'workspace'
}

export interface EpisodeUsage {
  /** Episodic memory episode id when known; otherwise the recalled text hash. */
  id: string
  kind: 'success' | 'failure'
}

/** PRD §3.1 — raw structured signal from a session. This is telemetry, not memory. */
export interface LearningObservation {
  id: string
  sessionId: string
  workspaceId: string
  ts: string

  task?: {
    goal?: string
    category?: string
  }

  execution: LearningObservationExecution
  outcome: {
    status: TaskOutcomeStatus
    reason?: string
  }
  signals: LearningObservationSignals
  memory: LearningObservationMemory
  artifacts: LearningObservationArtifacts
  owner?: { issuer: string; subject: string }
}

/** PRD §3.8 — the highest-value learning signal. */
export interface UserCorrection {
  id: string
  sessionId: string
  workspaceId?: string
  original: string
  corrected: string
  category: UserCorrectionCategory
  /** 0..1 — a correction is strong evidence by itself. */
  confidence: number
  ts: string
  /** Observation ids that carry this correction. */
  sourceObservationIds?: string[]
  owner?: { issuer: string; subject: string }
}

/** PRD §3.3 */
export interface LearningEvidence {
  id: string
  type: LearningEvidenceType
  /** Deterministic reference — session id, file path, test name, outcome id. */
  ref: string
  /** 0..1 */
  weight: number
  metadata?: Record<string, unknown>
  ts: string
}

export interface EvidenceRef {
  evidenceId: string
  /** Snapshot of the evidence type at candidate creation time. */
  type: LearningEvidenceType
  ref: string
  weight: number
}

/** PRD §3.2 — the central new object. A candidate never becomes durable knowledge directly. */
export interface LearningCandidate {
  id: string
  /** Deterministic fingerprint (PRD §34): sha256(type + normalized hypothesis + scope + evidence ids). */
  fingerprint: string
  type: LearningCandidateType
  scope: LearningScope
  hypothesis: string
  /** Type-specific payload (lesson payload / skill patch / policy draft). */
  payload: unknown
  evidence: EvidenceRef[]
  /** ROX-computed confidence (PRD §38) — never the model's own estimate. */
  confidence: number
  /** Component scores behind `confidence`, kept for explainability (§18/§38). */
  confidenceComponents: ConfidenceComponents
  status: LearningCandidateStatus
  /** Why the validator settled on the current status (deterministic passes first). */
  validation: CandidateValidation
  /** Model's own estimate, kept for auditing but never used as `confidence`. */
  modelConfidenceEstimate?: number
  /** Rejected hypotheses retained so the same bad idea is not re-proposed (§36). */
  rejectedReason?: string
  rollbackOf?: string
  createdAt: string
  updatedAt: string
  owner?: { issuer: string; subject: string }
}

/** PRD §38 — confidence components; the product is `confidence`. */
export interface ConfidenceComponents {
  recurrence: number
  evidenceQuality: number
  userSignal: number
  repositorySupport: number
  outcomeSupport: number
  consistency: number
}

/** Deterministic validation verdicts (PRD §37). */
export interface CandidateValidation {
  passes: ValidationPassResult[]
  /** true when every deterministic pass agreed the candidate may be promoted at its policy level. */
  promotable: boolean
  /** LLM judge verdict when a judge was available; absent when deterministic-only. */
  judged?: { verdict: 'support' | 'reject' | 'inconclusive'; rationale?: string }
  checkedAt: string
}

export interface ValidationPassResult {
  pass:
    | 'duplicate'
    | 'contradiction'
    | 'scope'
    | 'sensitive'
    | 'evidence_count'
    | 'repository_evidence'
    | 'outcome_evidence'
    | 'consistency'
  ok: boolean
  detail?: string
}

/** PRD §3.4 */
export interface LearningExperiment {
  id: string
  candidateId: string
  baseline: { behavior: string; metrics: Record<string, number> }
  treatment: { behavior: string; metrics: Record<string, number> }
  sampleSize: number
  status: 'running' | 'passed' | 'failed' | 'inconclusive'
  createdAt: string
  completedAt?: string
}

/** PRD §3.5 — did it actually get better? */
export interface TaskOutcome {
  id: string
  sessionId: string
  workspaceId?: string
  /** PRD §19 — comparable-task fingerprint (taskClass + stack + complexity …). */
  taskFingerprint: string
  status: TaskOutcomeStatus
  qualityScore?: number
  durationMs?: number
  tokenUsage?: number
  verification?: VerificationResult
  userCorrections: number
  memoryUsed: string[]
  skillsUsed: string[]
  errors: string[]
  ts: string
  owner?: { issuer: string; subject: string }
}

/** PRD §3.6 — every durable change is reversible. */
export type LearningMutationTargetType = 'lesson' | 'skill' | 'policy' | 'memory'

export interface LearningMutation {
  id: string
  candidateId: string
  targetType: LearningMutationTargetType
  targetId: string
  before: unknown
  after: unknown
  expectedEffect?: Record<string, number>
  actualEffect?: Record<string, number>
  rollbackAvailable: boolean
  status: 'applied' | 'confirmed' | 'reverted'
  ts: string
  revertedAt?: string
  reason?: string
  owner?: { issuer: string; subject: string }
}

/** PRD §3.7 — learned orchestration policy (never memory; approval level 3). */
export interface LearningPolicy {
  id: string
  /** Deterministic fingerprint of task class + strategy. */
  fingerprint: string
  taskClass: string
  preferredModel?: string
  preferredSkills: string[]
  verification: string[]
  delegation: 'prefer' | 'avoid' | 'neutral'
  toolOrder?: string[]
  confidence: number
  evidence: EvidenceRef[]
  status: 'candidate' | 'active' | 'rolled_back'
  createdAt: string
  updatedAt: string
  owner?: { issuer: string; subject: string }
}

/** PRD §18 — component scores kept separate, never one opaque number. */
export interface EffectivenessComponents {
  successRate: number
  correctionRate: number
  conflictRate: number
  reuseRate: number
  confidence: number
}

export interface SkillVersionInfo {
  version: number
  parentVersion?: number
  evidence: string[]
  reason?: string
  metrics: Record<string, number>
}

/** PRD §42 — policy replacing the skills.autoCreateFromSessions boolean. */
export interface SkillsLearningPolicy {
  enabled: boolean
  autoCreate: 'off' | 'candidate' | 'autonomous'
  autoImprove: 'off' | 'candidate' | 'autonomous'
  minEvidence: number
  minConfidence: number
  requireVerification: boolean
}

export const DEFAULT_SKILLS_LEARNING_POLICY: SkillsLearningPolicy = {
  enabled: true,
  autoCreate: 'off',
  autoImprove: 'candidate',
  minEvidence: 3,
  minConfidence: 0.85,
  requireVerification: true,
}

/**
 * PRD §43 — backward-compatible migration of skills.autoCreateFromSessions:
 * false → 'off', true → 'candidate'. The new 'autonomous' mode only ever
 * turns on explicitly.
 */
export function migrateAutoCreateFromSessions(legacy: boolean | undefined): SkillsLearningPolicy {
  if (legacy === undefined) return { ...DEFAULT_SKILLS_LEARNING_POLICY }
  return { ...DEFAULT_SKILLS_LEARNING_POLICY, autoCreate: legacy === true ? 'candidate' : 'off' }
}

/** PRD §39 — per-type promotion thresholds (configurable via skills.learning). */
export interface LearningPromotionThresholds {
  /** lesson: 3 repeated independent observations OR 1 strong user correction. */
  lessonMinEvidence: number
  lessonMinConfidence: number
  /** skill: 2+ instances of the same reusable workflow + successful completion evidence. */
  skillMinEvidence: number
  skillMinConfidence: number
  /** skill patch: 3+ failures/corrections or strong deterministic evidence. */
  skillPatchMinEvidence: number
  skillPatchMinConfidence: number
  /** policy: ≥10 comparable tasks. */
  policyMinEvidence: number
  policyMinConfidence: number
  /** PRD §40 — auto-rollback when success drops more than this under baseline. */
  rollbackSuccessDrop: number
  /** Auto-rollback when correction rate exceeds this. */
  rollbackCorrectionRate: number
}

export const DEFAULT_LEARNING_THRESHOLDS: LearningPromotionThresholds = {
  lessonMinEvidence: 3,
  lessonMinConfidence: 0.7,
  skillMinEvidence: 2,
  skillMinConfidence: 0.75,
  skillPatchMinEvidence: 3,
  skillPatchMinConfidence: 0.75,
  policyMinEvidence: 10,
  policyMinConfidence: 0.85,
  rollbackSuccessDrop: 0.1,
  rollbackCorrectionRate: 0.25,
}

/** PRD §17 — safety levels 0-3 gating what may happen without review. */
export type LearningSafetyLevel = 0 | 1 | 2 | 3

/** Minimal DTO surface for the `learning:*` RPC namespace (PRD §15). */
export interface LearningStatsDto {
  observations: number
  candidates: number
  activeCandidates: number
  rejectedCandidates: number
  outcomes: number
  mutations: number
  revertedMutations: number
  policies: number
}

export interface LearningTimelineEntryDto {
  ts: string
  kind: 'observation' | 'candidate' | 'mutation' | 'outcome' | 'rollback' | 'experiment'
  id: string
  sessionId?: string
  summary: string
  detail?: string
}

// ---------------------------------------------------------------------------
// Pure helpers (shared by server-core and, later, the renderer).
// ---------------------------------------------------------------------------

/** Whitespace/case-normalized hypothesis (PRD §34). */
export function normalizeHypothesis(hypothesis: string): string {
  return hypothesis.trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * Deterministic candidate identity (PRD §34):
 * sha256(type + normalized hypothesis + scope + sorted evidence ids).
 * Same evidence set must never yield two candidates for the same hypothesis.
 * `hash` is injectable so callers can share one crypto implementation.
 */
export function candidateFingerprint(
  input: { type: LearningCandidateType; hypothesis: string; scope: LearningScope; evidenceIds: string[] },
  hash: (text: string) => string,
): string {
  const payload = [
    input.type,
    normalizeHypothesis(input.hypothesis),
    input.scope,
    [...input.evidenceIds].sort().join(','),
  ].join('\u0000')
  return hash(payload)
}

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}

/**
 * PRD §38 — the confidence product. The model's own estimate is never used;
 * every component is computed by ROX from stored evidence.
 */
export function computeConfidence(components: ConfidenceComponents): number {
  const product =
    clamp01(components.recurrence) *
    clamp01(components.evidenceQuality) *
    clamp01(components.userSignal) *
    clamp01(components.repositorySupport) *
    clamp01(components.outcomeSupport) *
    clamp01(components.consistency)
  return clamp01(product)
}

/** PRD §18 — effectiveness from component scores (kept separate for explainability). */
export function computeEffectiveness(components: EffectivenessComponents): number {
  const base =
    0.5 * clamp01(components.successRate) +
    0.2 * clamp01(components.reuseRate) +
    0.15 * clamp01(components.confidence) +
    0.15 * (1 - clamp01(components.correctionRate))
  const penalty = 0.5 * clamp01(components.conflictRate)
  return clamp01(base - penalty)
}