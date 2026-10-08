/**
 * WP-105 — PolicyLearner (PRD §13 Job 5 `policy-learning`, §19 counterfactual
 * evaluation). Learns orchestration policies (skills / verification /
 * delegation) only for task groups that are BOTH comparable enough and
 * demonstrably better than the global baseline.
 *
 * Grouping key: `TaskOutcome.taskFingerprint` (PRD §19) — the producer
 * computes it with `taskFingerprint()` over {taskClass, stack, complexity,
 * skills}. The hash is one-way, so `taskClass` on the emitted policy is
 * recovered from the majority `observation.task.category` of the group's
 * contributing tasks (the same taskClass part the producer fed the hash).
 *
 * Emission gates (all deterministic):
 *   - group size ≥ max(DEFAULT_LEARNING_THRESHOLDS.policyMinEvidence, minTasks)
 *   - successRate(group) − successRate(global) ≥ 0.1
 *   - pattern consistency ≥ 0.7 (majority skill set superset, or majority
 *     delegation value)
 *
 * No LLM, no fs: same input ⇒ same output. Only `'candidate'` policies are
 * produced; activation is owned by the approval path (PRD §16–17).
 */
import {
  DEFAULT_LEARNING_THRESHOLDS,
  clamp01,
  type EvidenceRef,
  type LearningObservation,
  type LearningPolicy,
  type TaskOutcome,
  type VerificationResult,
} from '@rox/shared/memory/learning'

/** Input of `taskFingerprint` — the PRD §19 comparable-task dimensions. */
export interface TaskFingerprintInput {
  taskClass?: string
  stack?: string[]
  complexity?: 'small' | 'medium' | 'large'
  skills?: string[]
}

/** Whitespace/case-normalized fingerprint part. */
function normalizePart(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

function normalizeList(values: string[] | undefined): string {
  if (!values || values.length === 0) return ''
  const normalized = [...new Set(values.map(normalizePart).filter(v => v.length > 0))]
  normalized.sort((a, b) => a.localeCompare(b))
  return normalized.join(',')
}

/**
 * Deterministic task fingerprint (PRD §19), mirroring `candidateFingerprint`:
 * normalized parts joined with NUL and hashed by the injected implementation.
 * Lists are deduped + sorted so ordering never changes the fingerprint.
 */
export function taskFingerprint(input: TaskFingerprintInput, hash: (text: string) => string): string {
  const payload = [
    normalizePart(input.taskClass ?? ''),
    normalizeList(input.stack),
    input.complexity ?? '',
    normalizeList(input.skills),
  ].join('\u0000')
  return hash(payload)
}

export interface PolicyLearnerInput {
  observations: LearningObservation[]
  outcomes: TaskOutcome[]
  /** Override for the minimum comparable tasks; never lowers the default 10. */
  minTasks?: number
}

export interface PolicyLearnerDeps {
  clock?: () => number
}

/** Success rate over a task set: success / all outcomes (failures, partials, aborts included). */
function successRate(outcomes: TaskOutcome[]): number {
  if (outcomes.length === 0) return 0
  let successes = 0
  for (const outcome of outcomes) if (outcome.status === 'success') successes += 1
  return successes / outcomes.length
}

/** Verified aspects of one verification record, in a fixed canonical order. */
function verifiedAspects(verification: VerificationResult): string[] {
  const aspects: string[] = []
  if ((verification.testsPassed ?? 0) > 0 || (verification.testsFailed ?? 0) > 0) aspects.push('tests')
  if (verification.buildPassed === true) aspects.push('build')
  if (verification.lintPassed === true) aspects.push('lint')
  if (verification.typecheckPassed === true) aspects.push('typecheck')
  return aspects
}

/** Deterministic majority value: ties resolve to the lexicographically first key. */
function majorityOf<T extends string | number>(values: T[]): { value: T; count: number } | null {
  if (values.length === 0) return null
  const counts = new Map<T, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  let best: T | null = null
  let bestCount = -1
  for (const value of [...counts.keys()].sort((a, b) => String(a).localeCompare(String(b)))) {
    const count = counts.get(value) ?? 0
    if (count > bestCount) {
      best = value
      bestCount = count
    }
  }
  return best === null ? null : { value: best, count: bestCount }
}

export class PolicyLearner {
  private readonly clock: () => number

  constructor(deps: PolicyLearnerDeps = {}) {
    this.clock = deps.clock ?? (() => Date.now())
  }

  /** Learn candidate policies from observed task outcomes (PRD §13/§19). */
  learn(input: PolicyLearnerInput): LearningPolicy[] {
    const outcomes = input.outcomes.filter(o => typeof o.taskFingerprint === 'string' && o.taskFingerprint.length > 0)
    if (outcomes.length === 0) return []
    const requiredTasks = Math.max(DEFAULT_LEARNING_THRESHOLDS.policyMinEvidence, input.minTasks ?? 0)
    const baseline = successRate(outcomes)

    const groups = new Map<string, TaskOutcome[]>()
    for (const outcome of outcomes) {
      const group = groups.get(outcome.taskFingerprint)
      if (group) group.push(outcome)
      else groups.set(outcome.taskFingerprint, [outcome])
    }

    const nowIso = new Date(this.clock()).toISOString()
    const policies: LearningPolicy[] = []
    let counter = 0
    for (const fingerprint of [...groups.keys()].sort((a, b) => a.localeCompare(b))) {
      const group = groups.get(fingerprint) as TaskOutcome[]
      if (group.length < requiredTasks) continue
      const groupRate = successRate(group)
      if (groupRate - baseline < 0.1) continue

      const sessionIds = new Set(group.map(o => o.sessionId))
      const observations = this.pickObservations(input.observations, sessionIds)
      const pattern = this.analyzePattern(observations)
      if (pattern.consistency < 0.7) continue

      counter += 1
      const taskClass = majorityOf(
        observations.map(o => (o.task?.category ?? '').trim()).filter(c => c.length > 0),
      )
      const evidence: EvidenceRef[] = group.map(outcome => ({
        evidenceId: outcome.id,
        type: outcome.status === 'success' ? 'successful_outcome' : 'failed_outcome',
        ref: outcome.id,
        weight: 1,
      }))
      policies.push({
        id: `pol_${fingerprint.slice(0, 12)}_${counter}`,
        fingerprint,
        taskClass: taskClass?.value ?? 'unknown',
        preferredSkills: pattern.preferredSkills,
        verification: pattern.verification,
        delegation: pattern.delegation,
        confidence: clamp01(groupRate * pattern.consistency),
        evidence,
        status: 'candidate',
        createdAt: nowIso,
        updatedAt: nowIso,
      })
    }
    return policies
  }

  /**
   * One observation per contributing session: the latest by ts (ties by id),
   * sorted by id — so pattern analysis never double-counts a task and stays
   * independent of input ordering.
   */
  private pickObservations(observations: LearningObservation[], sessionIds: Set<string>): LearningObservation[] {
    const bySession = new Map<string, LearningObservation>()
    for (const observation of observations) {
      if (!sessionIds.has(observation.sessionId)) continue
      const previous = bySession.get(observation.sessionId)
      if (
        !previous ||
        observation.ts > previous.ts ||
        (observation.ts === previous.ts && observation.id > previous.id)
      ) {
        bySession.set(observation.sessionId, observation)
      }
    }
    return [...bySession.values()].sort((a, b) => a.id.localeCompare(b.id))
  }

  /**
   * Majority pattern of the group's tasks: a preferred-skill set carried by
   * ≥70% of tasks (superset test), the majority delegation value, and the
   * verification aspects present in ≥70% of verification records.
   */
  private analyzePattern(observations: LearningObservation[]): {
    consistency: number
    preferredSkills: string[]
    verification: string[]
    delegation: LearningPolicy['delegation']
  } {
    if (observations.length === 0) {
      return { consistency: 0, preferredSkills: [], verification: [], delegation: 'neutral' }
    }

    // Preferred skills: each skill present in ≥70% of tasks; ≥50% when no
    // skill clears 70%. Tasks match when their skill set contains all of them.
    const skillSets = observations.map(o => new Set(o.execution.skills.map(s => s.trim()).filter(s => s.length > 0)))
    const presence = new Map<string, number>()
    for (const set of skillSets) {
      for (const slug of set) presence.set(slug, (presence.get(slug) ?? 0) + 1)
    }
    const threshold70 = 0.7 * observations.length
    let preferredSkills = [...presence.entries()]
      .filter(([, count]) => count >= threshold70)
      .map(([slug]) => slug)
      .sort((a, b) => a.localeCompare(b))
    if (preferredSkills.length === 0) {
      preferredSkills = [...presence.entries()]
        .filter(([, count]) => count > observations.length / 2)
        .map(([slug]) => slug)
        .sort((a, b) => a.localeCompare(b))
    }
    let skillConsistency = 0
    if (preferredSkills.length > 0) {
      const matching = skillSets.filter(set => preferredSkills.every(slug => set.has(slug))).length
      skillConsistency = matching / observations.length
    }

    // Delegation majority.
    const delegated = majorityOf(observations.map(o => (o.execution.delegated ? 1 : 0) as 0 | 1))
    const delegationFraction = delegated ? delegated.count / observations.length : 0
    const delegation: LearningPolicy['delegation'] =
      delegated === null || delegated.count * 2 === observations.length
        ? 'neutral'
        : delegated.value === 1
          ? 'prefer'
          : 'avoid'

    // Verification: aspects present in ≥70% of the available verification records.
    const verificationValues: string[][] = []
    for (const observation of observations) {
      const verification = observation.signals?.verification
      if (verification) verificationValues.push(verifiedAspects(verification))
    }
    let verification: string[] = []
    if (verificationValues.length > 0) {
      const aspectCounts = new Map<string, number>()
      for (const aspects of verificationValues) {
        for (const aspect of aspects) aspectCounts.set(aspect, (aspectCounts.get(aspect) ?? 0) + 1)
      }
      verification = [...aspectCounts.entries()]
        .filter(([, count]) => count >= 0.7 * verificationValues.length)
        .map(([aspect]) => aspect)
        .sort((a, b) => a.localeCompare(b))
    }

    return {
      consistency: Math.max(skillConsistency, delegationFraction),
      preferredSkills,
      verification,
      delegation,
    }
  }
}