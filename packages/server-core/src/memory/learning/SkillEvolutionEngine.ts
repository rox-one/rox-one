/**
 * WP-105 — SkillEvolutionEngine (PRD §11 Job 3 `skill-curation`, §18, §39).
 *
 * Pure, deterministic decision engine over existing stores: it reads a
 * curation input (installed/pending skills + the skill-usage ledger +
 * task outcomes) and returns keep/improve/archive verdicts, plus a
 * deterministic skill-patch draft for skills that keep failing.
 *
 * Storage note: usage comes from the real S4 ledger — `readUsage()`
 * (packages/server-core/src/memory/skill-usage.ts) returns
 * `SkillUsageMap = Record<slug, { used: number; lastUsedAt: string }>`.
 * Success/failure counts are not stored there; they are derived from the
 * TaskOutcome rows the caller already has (`skillsUsed` + `status`).
 *
 * No LLM, no fs, no hidden state: same input ⇒ same output.
 *
 * Redaction ownership: this engine deliberately does NOT run
 * `redactSecrets` / `SENSITIVE_RE`. The promotion/enqueue path
 * (PromotionEngine → LearningTargetStores.enqueueSkill → SkillPendingQueue,
 * mirroring MemoryService.applyResult's skill-candidate branch) owns
 * redaction of the body/description and the sensitive-content refusal, so
 * there is exactly one redaction point in the pipeline. Callers must treat
 * `buildPatchCandidate().payload.body` as unredacted draft text.
 */
import type { SkillUsageMap } from '@rox/shared/memory/types'
import {
  DEFAULT_LEARNING_THRESHOLDS,
  clamp01,
  type SkillVersionInfo,
  type TaskOutcome,
} from '@rox/shared/memory/learning'

/**
 * Structural port for the WP-101 `LearningAudit` sink (learning-audit.jsonl).
 * Declared structurally so this module has no hard dependency on the store
 * implementation; the real `LearningAudit` class satisfies it.
 */
export interface LearningAudit {
  append(entry: { ts: string; actor: string; action: string; target: string; detail?: string }): void
}

/** One entry in `SkillCurationInput.skills`. */
export interface SkillCurationSkill {
  slug: string
  /** Candidate awaiting approval in `.pending/`. */
  pending: boolean
  /** Installed (approved) skill in `skills/<slug>/`. */
  approved: boolean
  /** SKILL.md body present and non-empty. */
  hasBody: boolean
  /**
   * ISO ts the pending candidate was created (`source.ts` in `.meta.json`).
   * Used only for the stale-pending archive rule; absent ⇒ age unknown.
   */
  pendingSince?: string
}

/** PRD §11/§18 curation decisions. */
export type SkillCurationAction = 'keep' | 'improve' | 'archive'

export interface SkillCurationDecision {
  slug: string
  action: SkillCurationAction
  reason: string
  metrics: Record<string, number>
}

export interface SkillCurationInput {
  skills: SkillCurationSkill[]
  /** S4 usage ledger: spawn count + last hit per slug. */
  usage: SkillUsageMap
  /** Task outcomes carrying `skillsUsed` / `status` — success/failure evidence. */
  outcomes: TaskOutcome[]
}

/** Injectable thresholds; defaults derive from the frozen shared contract. */
export interface SkillEvolutionThresholds {
  /** Unused pending candidate older than this many days → archive. */
  stalePendingDays: number
  /** successRate below this (with enough uses) → archive. */
  archiveSuccessRate: number
  /** Minimum uses before a low successRate may archive a skill. */
  archiveMinUses: number
  /** Failures at or above this → improve. */
  improveMinFailures: number
  /** successRate below this (with enough uses) → improve. */
  improveSuccessRate: number
  /** Minimum uses before a low successRate may improve a skill. */
  improveMinUses: number
  /** Minimum failure evidence for a patch candidate (PRD §39). */
  patchMinEvidence: number
}

export const DEFAULT_SKILL_EVOLUTION_THRESHOLDS: SkillEvolutionThresholds = {
  stalePendingDays: 30,
  archiveSuccessRate: 0.4,
  archiveMinUses: DEFAULT_LEARNING_THRESHOLDS.skillPatchMinEvidence,
  improveMinFailures: DEFAULT_LEARNING_THRESHOLDS.skillPatchMinEvidence,
  improveSuccessRate: 0.6,
  improveMinUses: DEFAULT_LEARNING_THRESHOLDS.skillPatchMinEvidence,
  patchMinEvidence: DEFAULT_LEARNING_THRESHOLDS.skillPatchMinEvidence,
}

export interface SkillPatchCandidateInput {
  slug: string
  /** Approved SKILL.md body (without frontmatter) the patch extends. */
  currentBody: string
  /** Failed-outcome evidence rows backing the patch. */
  failures: Array<{ sessionId: string; evidence: string }>
  /** Current approved version number; the patch becomes baseVersion + 1. */
  baseVersion: number
  /**
   * Escape hatch for PRD §39 "3+ failures/corrections OR strong deterministic
   * evidence": when true, a patch may be drafted with fewer than
   * `patchMinEvidence` failures.
   */
  deterministicEvidence?: boolean
}

export interface SkillPatchCandidate {
  hypothesis: string
  payload: {
    slug: string
    body: string
    description?: string
    supersedes?: string
    versionInfo: SkillVersionInfo
  }
  evidenceRefs: Array<{ type: 'failed_outcome'; ref: string; weight: number }>
}

export interface SkillEvolutionEngineDeps {
  clock?: () => number
  /** WP-101 audit sink; best-effort, never throws. */
  auditor?: LearningAudit
  /** Partial override of the default thresholds. */
  thresholds?: Partial<SkillEvolutionThresholds>
}

const DAY_MS = 24 * 60 * 60 * 1000

interface UsageCounters {
  uses: number
  successes: number
  failures: number
  successRate: number
  observed: number
}

/** Deterministic per-slug counters from the usage ledger + task outcomes. */
function countUsage(slug: string, usage: SkillUsageMap, outcomes: TaskOutcome[]): UsageCounters {
  const uses = Math.max(0, usage[slug]?.used ?? 0)
  let successes = 0
  let failures = 0
  for (const outcome of outcomes) {
    if (!outcome.skillsUsed.includes(slug)) continue
    if (outcome.status === 'success') successes += 1
    else if (outcome.status === 'failure') failures += 1
  }
  const observed = successes + failures
  return { uses, successes, failures, observed, successRate: observed > 0 ? successes / observed : 0 }
}

export class SkillEvolutionEngine {
  private readonly clock: () => number
  private readonly auditor?: LearningAudit
  private readonly thresholds: SkillEvolutionThresholds

  constructor(deps: SkillEvolutionEngineDeps = {}) {
    this.clock = deps.clock ?? (() => Date.now())
    this.auditor = deps.auditor
    this.thresholds = { ...DEFAULT_SKILL_EVOLUTION_THRESHOLDS, ...deps.thresholds }
  }

  /**
   * Curate every skill in the input (PRD §11). Decision order per skill:
   * archive (stale unused pending, or sustained low success) → improve
   * (repeated failures, or weak success) → keep.
   */
  curate(input: SkillCurationInput): SkillCurationDecision[] {
    const now = this.clock()
    const decisions: SkillCurationDecision[] = []
    for (const skill of input.skills) {
      const counters = countUsage(skill.slug, input.usage, input.outcomes)
      const pendingAgeDays = skill.pending && skill.pendingSince
        ? (now - Date.parse(skill.pendingSince)) / DAY_MS
        : -1
      const metrics: Record<string, number> = {
        uses: counters.uses,
        successes: counters.successes,
        failures: counters.failures,
        successRate: counters.successRate,
        pendingAgeDays,
        hasBody: skill.hasBody ? 1 : 0,
      }

      let action: SkillCurationAction = 'keep'
      let reason = 'usage and success rate within policy'

      if (
        skill.pending &&
        counters.uses === 0 &&
        pendingAgeDays >= 0 &&
        pendingAgeDays >= this.thresholds.stalePendingDays
      ) {
        action = 'archive'
        reason = `pending ${Math.floor(pendingAgeDays)} days with no usage (threshold ${this.thresholds.stalePendingDays})`
      } else if (counters.uses >= this.thresholds.archiveMinUses && counters.successRate < this.thresholds.archiveSuccessRate) {
        action = 'archive'
        reason = `successRate ${counters.successRate.toFixed(2)} below ${this.thresholds.archiveSuccessRate} over ${counters.uses} uses`
      } else if (counters.failures >= this.thresholds.improveMinFailures) {
        action = 'improve'
        reason = `${counters.failures} failed outcomes (threshold ${this.thresholds.improveMinFailures})`
      } else if (
        counters.uses >= this.thresholds.improveMinUses &&
        counters.successRate < this.thresholds.improveSuccessRate
      ) {
        action = 'improve'
        reason = `successRate ${counters.successRate.toFixed(2)} below ${this.thresholds.improveSuccessRate} over ${counters.uses} uses`
      }

      decisions.push({ slug: skill.slug, action, reason, metrics })
      this.audit('skill-curation', action, skill.slug, reason)
    }
    return decisions
  }

  /**
   * Draft a deterministic skill patch candidate (PRD §39, Wave 4). Refuses
   * (throws) when the failure evidence is insufficient and no deterministic
   * evidence flag was passed — the caller turns that into a non-promotion.
   *
   * `body` is an unredacted draft: the promotion/enqueue path owns
   * redaction (see the module header).
   */
  buildPatchCandidate(input: SkillPatchCandidateInput): SkillPatchCandidate {
    const minFailures = this.thresholds.patchMinEvidence
    if (input.failures.length < minFailures && input.deterministicEvidence !== true) {
      throw new Error(
        `Skill patch for '${input.slug}' refused: ${input.failures.length} failed outcomes < ${minFailures} and no deterministic evidence flag`,
      )
    }
    const failures = input.failures
      .map(f => ({ sessionId: f.sessionId, evidence: typeof f.evidence === 'string' ? f.evidence.trim() : '' }))
      .filter(f => f.sessionId.length > 0)

    const version = input.baseVersion + 1
    const evidenceRefs = failures.map(f => ({
      type: 'failed_outcome' as const,
      ref: f.sessionId,
      // EvidenceRef.weight is 0..1 by contract; failures carry full weight.
      weight: clamp01(1),
    }))

    const guardrails = failures
      .map(f => `- Session \`${f.sessionId}\` failed: ${f.evidence || 'no evidence recorded'}`)
      .join('\n')
    const trimmed = input.currentBody.replace(/\s*$/, '')
    const body = `${trimmed}\n\n## Guardrails (learned)\n\n${guardrails}\n`

    const hypothesis = `Skill '${input.slug}' fails repeatedly; add guardrails from ${failures.length} failed outcomes as v${version}`

    const candidate: SkillPatchCandidate = {
      hypothesis,
      payload: {
        slug: input.slug,
        body,
        description: `Improvement for ${input.slug}: guardrails from ${failures.length} failed outcomes`,
        supersedes: input.slug,
        versionInfo: {
          version,
          parentVersion: input.baseVersion,
          evidence: evidenceRefs.map(r => r.ref),
          reason: hypothesis,
          // Effectiveness metrics belong to the outcome loop (WP-111); the
          // patch is proposed before any measurement exists.
          metrics: {},
        },
      },
      evidenceRefs,
    }
    this.audit('skill-patch', 'candidate', input.slug, hypothesis)
    return candidate
  }

  /** Best-effort audit; a failing sink never breaks curation. */
  private audit(action: string, verdict: string, target: string, detail: string): void {
    if (!this.auditor) return
    try {
      this.auditor.append({
        ts: new Date(this.clock()).toISOString(),
        actor: 'automation',
        action,
        target,
        detail: `${verdict}: ${detail}`,
      })
    } catch {
      // auditing is best-effort by contract
    }
  }
}