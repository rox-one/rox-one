/**
 * PatternDetector — deterministic recurrence detection over stored learning
 * observations (PRD §10 Job 2 / §35).
 *
 * A signal that shows up across independent observations is recurrence
 * evidence; accumulation is what lets the consolidation job create one
 * candidate instead of one per session.
 *
 * Pure and clock-free: timestamps come from `observation.ts`. The frozen
 * LearningObservationSignals contract carries no lesson-conflict field, so
 * conflicts are read defensively (see `lessonConflictRules`).
 */
import type { LearningObservation, LearningObservationSignals } from '@rox/shared/memory/learning'
import { normalizeHypothesis } from '@rox/shared/memory/learning'
import type { DetectedPattern } from './learning-types'

/** A signal seen once is not yet a pattern (PRD §10 Job 2). */
const DEFAULT_MIN_OCCURRENCES = 2

interface PatternSignal {
  key: string
  kind: DetectedPattern['kind']
  /** Original text of this occurrence; the earliest occurrence wins as the exemplar. */
  exemplar: string
  category?: string
}

interface PatternAccumulator {
  kind: DetectedPattern['kind']
  occurrences: number
  observationIds: string[]
  sessionIds: string[]
  firstTs: string
  lastTs: string
  exemplar: string
  category?: string
}

/**
 * Detect recurring signals across stored observations.
 *
 * `occurrences` counts observations, not raw entries: the same tool failing
 * twice inside one observation is still one occurrence of the pattern.
 */
export function detectPatterns(
  observations: LearningObservation[],
  opts: { minOccurrences?: number } = {},
): DetectedPattern[] {
  const requested = opts.minOccurrences
  const minOccurrences =
    typeof requested === 'number' && Number.isFinite(requested)
      ? Math.max(1, Math.floor(requested))
      : DEFAULT_MIN_OCCURRENCES
  const accumulated = new Map<string, PatternAccumulator>()

  for (const observation of observations) {
    for (const signal of signalsFor(observation)) {
      accumulate(accumulated, observation, signal)
    }
  }

  const patterns: DetectedPattern[] = []
  for (const [key, pattern] of accumulated) {
    if (pattern.occurrences < minOccurrences) continue
    patterns.push({
      key,
      kind: pattern.kind,
      occurrences: pattern.occurrences,
      observationIds: pattern.observationIds,
      sessionIds: pattern.sessionIds,
      firstTs: pattern.firstTs,
      lastTs: pattern.lastTs,
      exemplar: pattern.exemplar,
      ...(pattern.category !== undefined ? { category: pattern.category } : {}),
    })
  }
  return patterns.sort(comparePatterns)
}

/** One observation's distinct contribution per pattern key (duplicates collapse). */
function signalsFor(observation: LearningObservation): PatternSignal[] {
  const signals: PatternSignal[] = []
  const seen = new Set<string>()
  const push = (signal: PatternSignal): void => {
    if (seen.has(signal.key)) return
    seen.add(signal.key)
    signals.push(signal)
  }

  const observationSignals: LearningObservationSignals | undefined = observation.signals

  const corrections = observationSignals?.userCorrections
  for (const correction of Array.isArray(corrections) ? corrections : []) {
    push({
      // Same correction phrased with different case/whitespace merges (PRD §35).
      key: `correction:${normalizeHypothesis(`${correction.original}→${correction.corrected}`)}`,
      kind: 'user_correction',
      exemplar: correction.original,
      category: correction.category,
    })
  }

  const errors = observationSignals?.errors
  for (const error of Array.isArray(errors) ? errors : []) {
    const tool = error.tool?.trim() || 'unknown'
    push({ key: `tool_failure:${tool}`, kind: 'tool_failure', exemplar: error.message })
  }

  const verification = observationSignals?.verification
  if (verification) {
    if (typeof verification.testsFailed === 'number' && verification.testsFailed > 0) {
      push({ key: 'verify:tests', kind: 'verification_failure', exemplar: `tests failed (${verification.testsFailed})` })
    }
    if (verification.buildPassed === false) {
      push({ key: 'verify:build', kind: 'verification_failure', exemplar: 'build failed' })
    }
    if (verification.lintPassed === false) {
      push({ key: 'verify:lint', kind: 'verification_failure', exemplar: 'lint failed' })
    }
    if (verification.typecheckPassed === false) {
      push({ key: 'verify:typecheck', kind: 'verification_failure', exemplar: 'typecheck failed' })
    }
  }

  for (const rule of lessonConflictRules(observationSignals)) {
    push({ key: `conflict:${rule}`, kind: 'memory_conflict', exemplar: rule })
  }

  return signals
}

function accumulate(
  accumulated: Map<string, PatternAccumulator>,
  observation: LearningObservation,
  signal: PatternSignal,
): void {
  const existing = accumulated.get(signal.key)
  if (!existing) {
    const entry: PatternAccumulator = {
      kind: signal.kind,
      occurrences: 1,
      observationIds: [observation.id],
      sessionIds: [observation.sessionId],
      firstTs: observation.ts,
      lastTs: observation.ts,
      exemplar: signal.exemplar,
    }
    if (signal.category !== undefined) entry.category = signal.category
    accumulated.set(signal.key, entry)
    return
  }

  existing.occurrences += 1
  if (!existing.observationIds.includes(observation.id)) existing.observationIds.push(observation.id)
  if (!existing.sessionIds.includes(observation.sessionId)) existing.sessionIds.push(observation.sessionId)

  // The exemplar and category always describe the earliest occurrence.
  if (compareTs(observation.ts, existing.firstTs) < 0) {
    existing.firstTs = observation.ts
    existing.exemplar = signal.exemplar
    if (signal.category === undefined) delete existing.category
    else existing.category = signal.category
  }
  if (compareTs(observation.ts, existing.lastTs) > 0) existing.lastTs = observation.ts
}

/**
 * Lesson conflicts are not part of the frozen LearningObservationSignals
 * contract yet; tolerate producers that attach them under a plausible key
 * instead of inventing a field in the shared type.
 */
function lessonConflictRules(signals: LearningObservationSignals | undefined): string[] {
  if (!signals) return []
  // The frozen contract does not declare conflict lists yet; `in` keeps the
  // reads checked instead of asserting a fabricated shape.
  const raw: unknown =
    'lessonConflicts' in signals
      ? signals.lessonConflicts
      : 'memoryConflicts' in signals
        ? signals.memoryConflicts
        : 'conflicts' in signals
          ? signals.conflicts
          : undefined
  if (!Array.isArray(raw)) return []

  const rules: string[] = []
  for (const entry of raw) {
    const candidate: unknown =
      typeof entry === 'string'
        ? entry
        : entry !== null && typeof entry === 'object' && 'rule' in entry
          ? entry.rule
          : undefined
    if (typeof candidate === 'string' && candidate.trim().length > 0) rules.push(candidate.trim())
  }
  return rules
}

function compareTs(a: string, b: string): number {
  const aMs = Date.parse(a)
  const bMs = Date.parse(b)
  if (Number.isFinite(aMs) && Number.isFinite(bMs) && aMs !== bMs) return aMs - bMs
  if (a === b) return 0
  return a < b ? -1 : 1
}

function comparePatterns(a: DetectedPattern, b: DetectedPattern): number {
  if (a.occurrences !== b.occurrences) return b.occurrences - a.occurrences
  const byRecency = compareTs(b.lastTs, a.lastTs)
  if (byRecency !== 0) return byRecency
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
}