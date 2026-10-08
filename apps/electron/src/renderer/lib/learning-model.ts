/**
 * Learning screen — pure derivations over the `learning:*` DTOs.
 *
 * Nothing here touches the DOM, `window.electronAPI` or i18n: the screen owns
 * presentation, this module owns counting, filtering, sorting and the
 * explainability breakdowns (confidence product, effectiveness components)
 * so they can be unit-tested without a renderer.
 *
 * PRD §26-30 (dashboard / candidate inspector / skills / timeline / help).
 */
import type {
  ConfidenceComponents,
  LearningCandidate,
  LearningCandidateStatus,
  LearningCandidateType,
  LearningEvidenceType,
  LearningScope,
  LearningTimelineEntryDto,
} from '@rox/shared/memory/learning'

export const LEARNING_STATUSES: readonly LearningCandidateStatus[] = [
  'candidate', 'validating', 'approved', 'active', 'rejected', 'rolled_back',
]

export const LEARNING_TYPES: readonly LearningCandidateType[] = ['lesson', 'skill', 'preference', 'policy']

export const LEARNING_SCOPES: readonly LearningScope[] = ['global', 'workspace', 'project', 'session']

/** Evidence kinds surfaced in the inspector (§27) — grouped, not all 11 at once. */
export const LEARNING_EVIDENCE_TYPES: readonly LearningEvidenceType[] = [
  'user_correction', 'successful_outcome', 'failed_outcome', 'recurrence',
  'tool_trace', 'git_diff', 'test_result', 'skill_usage', 'memory_usage',
  'session', 'repository',
]

export const TIMELINE_KINDS: readonly LearningTimelineEntryDto['kind'][] = [
  'candidate', 'mutation', 'rollback', 'outcome', 'observation', 'experiment',
]

/** Statuses that mean "already durable or dead" — never shown in the skills queue. */
const QUEUE_STATUSES: readonly LearningCandidateStatus[] = ['candidate', 'validating']

export type LearningView = 'dashboard' | 'candidates' | 'skills' | 'timeline' | 'help'
export type LearningSort = 'recency' | 'confidence' | 'status'

export interface LearningFilter {
  query?: string
  status?: LearningCandidateStatus
  type?: LearningCandidateType
  scope?: LearningScope
}

export function matchesCandidateFilter(candidate: LearningCandidate, filter: LearningFilter): boolean {
  if (filter.status && candidate.status !== filter.status) return false
  if (filter.type && candidate.type !== filter.type) return false
  if (filter.scope && candidate.scope !== filter.scope) return false
  const query = filter.query?.trim().toLowerCase()
  if (query && !`${candidate.hypothesis} ${candidate.fingerprint}`.toLowerCase().includes(query)) return false
  return true
}

export function sortCandidates(candidates: readonly LearningCandidate[], sort: LearningSort): LearningCandidate[] {
  const items = [...candidates]
  if (sort === 'confidence') items.sort((a, b) => b.confidence - a.confidence)
  else if (sort === 'status') {
    items.sort((a, b) =>
      LEARNING_STATUSES.indexOf(a.status) - LEARNING_STATUSES.indexOf(b.status) || b.confidence - a.confidence)
  } else items.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
  return items
}

/** The skills view keeps only skill candidates still awaiting a decision (§28). */
export function skillQueue(candidates: readonly LearningCandidate[]): LearningCandidate[] {
  return candidates.filter((candidate) => candidate.type === 'skill' && QUEUE_STATUSES.includes(candidate.status))
}

export function approvedSkills(candidates: readonly LearningCandidate[]): LearningCandidate[] {
  return candidates.filter((candidate) =>
    candidate.type === 'skill' && (candidate.status === 'approved' || candidate.status === 'active'))
}

export interface CandidateCounts {
  status: Map<LearningCandidateStatus, number>
  type: Map<LearningCandidateType, number>
  scope: Map<LearningScope, number>
}

export function countCandidates(candidates: readonly LearningCandidate[]): CandidateCounts {
  const status = new Map<LearningCandidateStatus, number>()
  const type = new Map<LearningCandidateType, number>()
  const scope = new Map<LearningScope, number>()
  for (const candidate of candidates) {
    status.set(candidate.status, (status.get(candidate.status) ?? 0) + 1)
    type.set(candidate.type, (type.get(candidate.type) ?? 0) + 1)
    scope.set(candidate.scope, (scope.get(candidate.scope) ?? 0) + 1)
  }
  return { status, type, scope }
}

/** Deterministic passes that refused promotion — the inspector shows their `detail`. */
export function failedPasses(candidate: LearningCandidate): LearningCandidate['validation']['passes'] {
  return candidate.validation.passes.filter((pass) => !pass.ok)
}

export const CONFIDENCE_COMPONENTS: readonly (keyof ConfidenceComponents)[] = [
  'recurrence', 'evidenceQuality', 'userSignal', 'repositorySupport', 'outcomeSupport', 'consistency',
]

export function confidenceRows(components: ConfidenceComponents): Array<{ key: keyof ConfidenceComponents; value: number }> {
  return CONFIDENCE_COMPONENTS.map((key) => ({ key, value: components[key] }))
}

/** 0..1 → coarse band used for colour/tone; `unknown` for missing reports. */
export function effectivenessBand(value: number | null | undefined): 'high' | 'medium' | 'low' | 'unknown' {
  if (value == null || !Number.isFinite(value)) return 'unknown'
  if (value >= 0.75) return 'high'
  if (value >= 0.45) return 'medium'
  return 'low'
}

/** Mean confidence of a candidate set; 0 for an empty set (never NaN). */
export function averageConfidence(candidates: readonly LearningCandidate[]): number {
  if (candidates.length === 0) return 0
  return candidates.reduce((sum, candidate) => sum + candidate.confidence, 0) / candidates.length
}

export interface TimelineGroup {
  kind: LearningTimelineEntryDto['kind']
  items: LearningTimelineEntryDto[]
}

/** Newest-first inside each kind; kinds in TIMELINE_KINDS order. */
export function groupTimeline(entries: readonly LearningTimelineEntryDto[]): TimelineGroup[] {
  const byKind = new Map<LearningTimelineEntryDto['kind'], LearningTimelineEntryDto[]>()
  for (const entry of entries) {
    const bucket = byKind.get(entry.kind)
    if (bucket) bucket.push(entry)
    else byKind.set(entry.kind, [entry])
  }
  const groups: TimelineGroup[] = []
  for (const kind of TIMELINE_KINDS) {
    const items = byKind.get(kind)
    if (items?.length) groups.push({ kind, items: [...items].sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts)) })
  }
  return groups
}