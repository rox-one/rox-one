/**
 * ConsolidationEngine — PRD §10 Job 2 / §12 Job 4 (learning-consolidation).
 *
 * Reads every stored observation, detects recurring signals with the
 * deterministic `detectPatterns` (PRD §35), and turns each pattern with enough
 * independent occurrences into ONE consolidation candidate instead of one per
 * session (PRD §34 idempotency is the caller's fingerprint check).
 *
 * The engine is pure: no clock, no fs, no LLM, no hidden state — same
 * observations in, same drafts out. Persisting the candidate, resolving its
 * evidence rows and running `CandidateValidator` is the service's job.
 */
import type { LearningObservation, LearningScope, UserCorrectionCategory } from '@rox/shared/memory/learning'
import { normalizeHypothesis } from '@rox/shared/memory/learning'
import type { DetectedPattern, ReflectionHypothesis } from './learning-types'
import { detectPatterns } from './PatternDetector'

/** PRD §10 Job 2: a signal seen once is not yet a repeated pattern. */
export const DEFAULT_CONSOLIDATION_MIN_OCCURRENCES = 2

export interface ConsolidationInput {
  observations: LearningObservation[]
  /** Minimum independent observations carrying the signal (never below 2). */
  minOccurrences?: number
  /** Skip patterns whose newest occurrence is already covered by a candidate. */
  knownFingerprints?: ReadonlySet<string>
}

export interface ConsolidationDraft {
  /** Pattern the draft was derived from — kept for provenance and dedupe. */
  pattern: DetectedPattern
  hypothesis: ReflectionHypothesis
}

/** Normalized pattern key from which the candidate identity is derived. */
export function consolidationKey(pattern: DetectedPattern): string {
  return pattern.key
}

function ruleForPattern(pattern: DetectedPattern): { hypothesis: string; category?: string; negative?: boolean } {
  switch (pattern.kind) {
    case 'user_correction': {
      const corrected = pattern.exemplar.trim()
      return {
        hypothesis: `Recurring user correction (${pattern.occurrences}×): prefer "${corrected}" over the original phrasing`,
        ...(pattern.category ? { category: pattern.category } : {}),
      }
    }
    case 'tool_failure':
      return {
        hypothesis: `Tool "${pattern.exemplar.trim() || pattern.key.slice('tool_failure:'.length)}" failed in ${pattern.occurrences} independent observations; verify its preconditions before use`,
        category: 'workflow',
        negative: true,
      }
    case 'verification_failure':
      return {
        hypothesis: `Verification step "${pattern.exemplar.trim()}" failed in ${pattern.occurrences} independent observations; run it explicitly before declaring completion`,
        category: 'workflow',
      }
    case 'memory_conflict':
      return {
        hypothesis: `Stored rule "${pattern.exemplar.trim()}" was violated repeatedly (${pattern.occurrences}×); restate it unambiguously`,
        category: 'correction',
      }
  }
}

/**
 * Consolidation candidates from observations (PRD §12): repeated corrections,
 * repeated tool/verification failures and repeatedly violated rules become
 * lesson drafts carrying the occurrences' observation ids as evidence refs.
 */
export function consolidateObservations(input: ConsolidationInput): ConsolidationDraft[] {
  const requested = input.minOccurrences
  const minOccurrences =
    typeof requested === 'number' && Number.isFinite(requested)
      ? Math.max(DEFAULT_CONSOLIDATION_MIN_OCCURRENCES, Math.floor(requested))
      : DEFAULT_CONSOLIDATION_MIN_OCCURRENCES
  const drafts: ConsolidationDraft[] = []
  for (const pattern of detectPatterns(input.observations, { minOccurrences })) {
    const known = input.knownFingerprints
    if (known && known.has(pattern.key)) continue
    const rule = ruleForPattern(pattern)
    const category = pattern.category ?? rule.category
    drafts.push({
      pattern,
      hypothesis: {
        type: 'lesson',
        scope: 'workspace' as LearningScope,
        hypothesis: rule.hypothesis,
        ...(category ? { category } : {}),
        payload: {
          rule: rule.hypothesis,
          ...(category ? { category } : {}),
          ...(rule.negative ? { negative: true } : {}),
        },
        evidenceRefs: pattern.observationIds.map((id) => ({
          type: 'recurrence' as const,
          ref: id,
          weight: 1,
        })),
        modelConfidenceEstimate: Math.min(1, pattern.occurrences / 5),
      },
    })
  }
  return drafts
}

/** Implementation class so the service can inject/override the engine. */
export class ConsolidationEngine {
  private readonly minOccurrences: number

  constructor(opts: { minOccurrences?: number } = {}) {
    this.minOccurrences = Math.max(
      DEFAULT_CONSOLIDATION_MIN_OCCURRENCES,
      typeof opts.minOccurrences === 'number' && Number.isFinite(opts.minOccurrences)
        ? Math.floor(opts.minOccurrences)
        : DEFAULT_CONSOLIDATION_MIN_OCCURRENCES,
    )
  }

  run(input: ConsolidationInput): ConsolidationDraft[] {
    return consolidateObservations({ ...input, minOccurrences: this.minOccurrences })
  }
}

/** Category normalization shared with the correction pipeline (PRD §22). */
export function normalizeCorrectionCategory(category: string | undefined): UserCorrectionCategory | undefined {
  const normalized = normalizeHypothesis(category ?? '')
  const allowed: UserCorrectionCategory[] = ['fact', 'preference', 'workflow', 'tool', 'architecture', 'style']
  return allowed.find((value) => value === normalized)
}