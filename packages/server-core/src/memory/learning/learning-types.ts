/**
 * Internal (server-core) learning contracts shared across the learning modules.
 *
 * PRD: docs/plans/2026-10-08-continual-learning-prd.md (§4 lists learning-types.ts).
 * Shared/wire-safe types live in @rox/shared/memory/learning; this file holds
 * module-crossing interfaces that never leave the server.
 *
 * Ownership: the orchestrating session owns this file. Module-local types stay
 * inside their own module files.
 */
import type {
  CandidateValidation,
  ConfidenceComponents,
  EffectivenessComponents,
  EvidenceRef,
  LearningCandidate,
  LearningCandidateStatus,
  LearningCandidateType,
  LearningEvidenceType,
  LearningMutation,
  LearningPolicy,
  LearningPromotionThresholds,
  LearningScope,
  LearningSafetyLevel,
  LearningStatsDto,
  LearningTimelineEntryDto,
  SkillsLearningPolicy,
  TaskOutcome,
  UserCorrection,
  VerificationResult,
} from '@rox/shared/memory/learning'
import { join } from 'path'

/** Canonical learning storage dir under a workspace (PRD §5). */
export function learningDirFor(workspaceRoot: string): string {
  return join(workspaceRoot, 'memory', 'learning')
}

/** One hypothesis proposed by reflection (PRD §36) — not yet a stored candidate. */
export interface ReflectionHypothesis {
  type: LearningCandidateType
  scope: LearningScope
  hypothesis: string
  /** Lesson/correction category hint when the type is lesson. */
  category?: string
  /** Type-specific draft: lesson text fragment, skill patch sketch, policy draft. */
  payload?: unknown
  evidenceRefs: Array<{ type: LearningEvidenceType; ref: string; weight: number; metadata?: Record<string, unknown> }>
  /** Model's own estimate — audited, never used as `confidence`. */
  modelConfidenceEstimate?: number
}

export interface ReflectionResult {
  hypotheses: ReflectionHypothesis[]
  /** PRD §36 — explicitly rejected hypotheses, so pollution is reduced. */
  rejectedHypotheses: Array<{ hypothesis: string; reason: string }>
}

/** Inputs beyond the transcript available to a reflection run (PRD §36). */
export interface ReflectionContext {
  workspaceRoot: string
  workspaceId: string
  projectId?: string
  /** Rendered runtime trace excerpt, when available. */
  runtimeTrace?: string
  /** Rendered tool outcome summary, when available. */
  toolOutcomes?: string
  /** Rendered git diff summary, when available. */
  gitDiffSummary?: string
  verification?: VerificationResult
  userCorrections?: UserCorrection[]
  /** Text of the session transcript window (already redacted by the caller). */
  transcript?: string
}

/** Deterministic recurrence evidence produced by PatternDetector (PRD §10 Job 2/§35). */
export interface DetectedPattern {
  /** Normalized signal key, e.g. `correction:bun install→bun add`. */
  key: string
  occurrences: number
  observationIds: string[]
  sessionIds: string[]
  firstTs: string
  lastTs: string
  /** Sanitized exemplar text (original formulation of the first occurrence). */
  exemplar: string
  kind: 'user_correction' | 'tool_failure' | 'verification_failure' | 'memory_conflict'
  /** Correction category, when the pattern is a correction. */
  category?: string
}

/** The validator's deterministic passes run in this order (PRD §37). */
export type ValidationPassId =
  | 'duplicate'
  | 'contradiction'
  | 'scope'
  | 'sensitive'
  | 'evidence_count'
  | 'repository_evidence'
  | 'outcome_evidence'
  | 'consistency'

export interface ValidatorPorts {
  /** Existing lessons (both scopes, owner-filtered) for duplicate/contradiction checks. */
  listExistingRules: () => Array<{ rule: string; scope: 'global' | 'workspace'; negative?: boolean }>
  /** Repository signals discovered under workspaceRoot (PRD §23): package manager, lockfiles, AGENTS.md. */
  readRepositorySignals: (workspaceRoot: string) => string[]
  /** Prior outcomes with the same task fingerprint (counterfactual support, PRD §19). */
  listOutcomesByFingerprint: (fingerprint: string) => TaskOutcome[]
  /** Policy settings (§42) for this workspace. */
  readSkillsLearningPolicy: () => SkillsLearningPolicy
  thresholds: LearningPromotionThresholds
}

export interface ValidateCandidateInput {
  candidate: LearningCandidate
  /** Evidence rows the candidate's refs point at. */
  evidence: Array<{ id: string; type: LearningEvidenceType; ref: string; weight: number; metadata?: Record<string, unknown> }>
  workspaceRoot: string
  /** Task fingerprint for outcome-support scoring (PRD §19). */
  taskFingerprint?: string
  /** Optional LLM judge; absent means deterministic-only. */
  judge?: (prompt: string) => Promise<string>
}

/** Result of a promotion attempt (PRD §39/§40). */
export interface PromotionResult {
  promoted: boolean
  status: LearningCandidateStatus
  /** Mutation rows written for each durable change. */
  mutations: LearningMutation[]
  /** Human-readable reason when promotion was refused. */
  reason?: string
}

/** Rollback outcome (PRD §40/§41). */
export interface RollbackResult {
  reverted: boolean
  mutationIds: string[]
  reason?: string
}

/** Access to the existing durable stores — injected, never imported ambiently. */
export interface LearningTargetStores {
  /**
   * Add a validated lesson to the existing LessonStore (workspace or global).
   * Returns the stored rule text; throws on store failure.
   */
  addLesson: (input: {
    rule: string
    category: string
    scope: 'global' | 'workspace'
    negative?: boolean
    trigger: 'explicit' | 'distillation'
    sessionId?: string
  }) => void
  /** Remove a lesson previously added by the learning layer (exact rule match). */
  removeLesson: (rule: string, scope: 'global' | 'workspace') => boolean
  /**
   * Enqueue an agent-created skill candidate into the existing SkillPendingQueue.
   * Returns false when an entry with the same slug already exists.
   */
  enqueueSkill: (input: {
    slug: string
    description: string
    body: string
    sessionId?: string
    supersedes?: string
    versionInfo?: { version: number; parentVersion?: number; evidence: string[]; reason?: string; metrics: Record<string, number> }
  }) => boolean
  /** Remove a queued skill candidate (rollback of an un-approved promotion). */
  removeQueuedSkill: (slug: string) => boolean
  /** Update a skill's pending-queue entry with an improved version (skill patch promotion). */
  readQueuedSkill: (slug: string) => { slug: string; description: string; body: string } | null
  /** Append/update a learned policy entry. */
  savePolicy: (policy: LearningPolicy) => void
  /** Remove a learned policy (rollback). */
  removePolicy: (id: string) => boolean
}

/** Result of routing one distilled item through the learning pipeline (PRD §45 Wave 3–4, WP-110 seam). */
export interface DistillIngestResult {
  /** False when the learning layer is disabled — the caller keeps its legacy behavior. */
  handled: boolean
  promoted: boolean
  candidateId?: string
  /** Human-readable reason when not promoted. */
  reason?: string
}

/** Ports the LearningService exposes to RPC and to MemoryService (PRD §15/§31). */
export interface LearningServicePorts {
  observeCompletion: (evt: {
    workspaceId: string
    sessionId: string
    reason: 'complete' | 'interrupted' | 'error' | 'timeout' | 'branch'
  }) => void
  recordCorrection: (correction: UserCorrection) => void
  recordToolOutcome: (input: { workspaceId: string; sessionId: string; tool: string; ok: boolean; error?: string; ts: string }) => void
  recordContextUsage: (input: { workspaceId: string; sessionId: string; lessons: Array<{ rule: string; scope: 'global' | 'workspace' }>; skills: string[] }) => void
  /**
   * MemoryService seam (PRD §31/§45 Wave 3–4): route one distilled lesson/skill draft
   * through repeat-evidence → validation → promotion. `handled=false` tells the caller
   * to keep its legacy behavior (learning disabled / out of scope).
   */
  ingestDistilled: (input: {
    workspaceId: string
    sessionId: string
    kind: 'lesson' | 'skill'
    /** Lesson rule text (kind 'lesson'). */
    rule?: string
    category?: string
    negative?: boolean
    /** Scope override; defaults to the workspace scope for the candidate type. */
    scope?: LearningScope
    /** Skill draft (kind 'skill'). */
    skill?: { slug: string; description: string; body: string; supersedes?: string }
  }) => Promise<DistillIngestResult>
  /** Force a reflection pass for one session (RPC learning:forceReflect). */
  reflectSession: (workspaceId: string, sessionId: string) => Promise<{ candidates: LearningCandidate[] }>
  /** Background jobs (§10-14). */
  runConsolidation: (workspaceId: string) => Promise<{ candidates: LearningCandidate[] }>
  runSkillCuration: (workspaceId: string) => Promise<{ items: Array<{ slug: string; action: 'keep' | 'improve' | 'archive' }> }>
  runPolicyLearning: (workspaceId: string) => Promise<{ policies: LearningPolicy[] }>
  runGarbageCollection: (workspaceId: string) => Promise<{ archived: number }>
  /** Outcome evaluation + automatic rollback (§40). */
  evaluateOutcomes: (workspaceId: string) => Promise<{ rolledBack: string[] }>
  /** RPC read surface. */
  listCandidates: (workspaceId: string, filter?: { status?: LearningCandidateStatus }) => LearningCandidate[]
  getCandidate: (workspaceId: string, id: string) => LearningCandidate | null
  approveCandidate: (workspaceId: string, id: string) => Promise<PromotionResult>
  rejectCandidate: (workspaceId: string, id: string, reason?: string) => LearningCandidate | null
  rollbackCandidate: (workspaceId: string, id: string) => Promise<RollbackResult>
  getTimeline: (workspaceId: string, limit?: number) => LearningTimelineEntryDto[]
  getStats: (workspaceId: string) => LearningStatsDto
  /** Test/drain seam, mirroring MemoryService.whenIdle. */
  whenIdle: () => Promise<void>
}

/** Evidence row shape stored in evidence.jsonl. */
export interface StoredEvidence {
  id: string
  type: LearningEvidenceType
  ref: string
  weight: number
  metadata?: Record<string, unknown>
  ts: string
}

/** Effectiveness report for one target (skill slug / lesson rule / policy id). */
export interface EffectivenessReport {
  targetType: 'skill' | 'lesson' | 'policy'
  targetId: string
  components: EffectivenessComponents
  effectiveness: number
  sampleSize: number
  computedAt: string
}

export type { CandidateValidation, ConfidenceComponents, EvidenceRef, LearningSafetyLevel }