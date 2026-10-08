import { describe, expect, it } from 'bun:test'
import type {
  ConfidenceComponents,
  EvidenceRef,
  LearningCandidate,
  LearningEvidenceType,
  LearningScope,
  LearningTimelineEntryDto,
  ValidationPassResult,
} from '@rox/shared/memory/learning'
import {
  CONFIDENCE_COMPONENTS,
  LEARNING_EVIDENCE_TYPES,
  LEARNING_SCOPES,
  LEARNING_STATUSES,
  LEARNING_TYPES,
  TIMELINE_KINDS,
  approvedSkills,
  averageConfidence,
  confidenceRows,
  countCandidates,
  effectivenessBand,
  failedPasses,
  groupTimeline,
  matchesCandidateFilter,
  skillQueue,
  sortCandidates,
} from '../learning-model'

const components = (value = 0.5): ConfidenceComponents => ({
  recurrence: value, evidenceQuality: value, userSignal: value,
  repositorySupport: value, outcomeSupport: value, consistency: value,
})

const ref = (id: string, weight = 0.5): EvidenceRef => ({ evidenceId: id, type: 'session', ref: `session:${id}`, weight })

const make = (overrides: Partial<LearningCandidate> = {}): LearningCandidate => ({
  id: 'c1',
  fingerprint: 'fp-1',
  type: 'lesson',
  scope: 'workspace',
  hypothesis: 'Dry-run migrations before applying them',
  payload: {},
  evidence: [ref('e1')],
  confidence: 0.5,
  confidenceComponents: components(),
  status: 'candidate',
  validation: { passes: [], promotable: true, checkedAt: '2026-10-01T00:00:00.000Z' },
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...overrides,
})

const entry = (kind: LearningTimelineEntryDto['kind'], ts: string, id: string): LearningTimelineEntryDto =>
  ({ ts, kind, id, summary: `${kind} ${id}` })

describe('learning model enumerations', () => {
  it('declares every lifecycle status exactly once, in transition order', () => {
    expect(LEARNING_STATUSES).toEqual(['candidate', 'validating', 'approved', 'active', 'rejected', 'rolled_back'])
    expect(new Set(LEARNING_STATUSES).size).toBe(LEARNING_STATUSES.length)
    expect(LEARNING_TYPES).toEqual(['lesson', 'skill', 'preference', 'policy'])
    expect(new Set(LEARNING_TYPES).size).toBe(LEARNING_TYPES.length)
    expect(LEARNING_SCOPES).toEqual(['global', 'workspace', 'project', 'session'])
    expect(TIMELINE_KINDS).toEqual(['candidate', 'mutation', 'rollback', 'outcome', 'observation', 'experiment'])
  })

  it('lists all eleven evidence types without duplicates', () => {
    const declared: LearningEvidenceType[] = ['session', 'user_correction', 'successful_outcome', 'failed_outcome',
      'tool_trace', 'git_diff', 'test_result', 'skill_usage', 'memory_usage', 'repository', 'recurrence']
    expect([...LEARNING_EVIDENCE_TYPES].sort()).toEqual([...declared].sort())
    expect(new Set(LEARNING_EVIDENCE_TYPES).size).toBe(11)
  })

  it('names exactly the six confidence components', () => {
    expect(CONFIDENCE_COMPONENTS).toEqual(['recurrence', 'evidenceQuality', 'userSignal',
      'repositorySupport', 'outcomeSupport', 'consistency'])
    const declared: string[] = [...CONFIDENCE_COMPONENTS]
    expect(declared.sort()).toEqual(Object.keys(components()).sort())
  })
})

describe('matchesCandidateFilter', () => {
  const skill = make({ type: 'skill', scope: 'global', status: 'active', fingerprint: 'sha256-deadbeef',
    hypothesis: 'Regenerate protocol types after editing the schema' })

  it('matches every facet independently and combined', () => {
    expect(matchesCandidateFilter(skill, {})).toBe(true)
    expect(matchesCandidateFilter(skill, { status: 'active', type: 'skill', scope: 'global' })).toBe(true)
    expect(matchesCandidateFilter(skill, { status: 'candidate' })).toBe(false)
    expect(matchesCandidateFilter(skill, { type: 'lesson' })).toBe(false)
    expect(matchesCandidateFilter(skill, { scope: 'project' })).toBe(false)
  })

  it('searches hypothesis and fingerprint, case-insensitively and trimmed', () => {
    expect(matchesCandidateFilter(skill, { query: 'PROTOCOL types' })).toBe(true)
    expect(matchesCandidateFilter(skill, { query: '  deadbeef ' })).toBe(true)
    expect(matchesCandidateFilter(skill, { query: 'migrations' })).toBe(false)
  })

  it('ignores blank queries instead of matching nothing', () => {
    for (const query of ['', '   ', '\t\n']) expect(matchesCandidateFilter(skill, { query })).toBe(true)
  })

  it('treats a missing query as no filter', () => {
    expect(matchesCandidateFilter(skill, { query: undefined })).toBe(true)
  })
})

describe('sortCandidates', () => {
  const old = make({ id: 'old', confidence: 0.9, status: 'candidate', updatedAt: '2026-09-01T00:00:00.000Z' })
  const recent = make({ id: 'recent', confidence: 0.1, status: 'active', updatedAt: '2026-10-05T00:00:00.000Z' })
  const middle = make({ id: 'middle', confidence: 0.5, status: 'rejected', updatedAt: '2026-10-02T00:00:00.000Z' })
  const items = [old, recent, middle]

  it('sorts by recency by default, newest updated first', () => {
    expect(sortCandidates(items, 'recency').map((c) => c.id)).toEqual(['recent', 'middle', 'old'])
  })

  it('sorts by confidence, highest first', () => {
    expect(sortCandidates(items, 'confidence').map((c) => c.id)).toEqual(['old', 'middle', 'recent'])
  })

  it('sorts by lifecycle position and breaks ties with confidence', () => {
    const sameStatusA = make({ id: 'a', status: 'active', confidence: 0.2, updatedAt: '2026-10-01T00:00:00.000Z' })
    const sameStatusB = make({ id: 'b', status: 'active', confidence: 0.8, updatedAt: '2026-10-01T00:00:00.000Z' })
    const rejected = make({ id: 'r', status: 'rejected', confidence: 1, updatedAt: '2026-10-09T00:00:00.000Z' })
    expect(sortCandidates([rejected, sameStatusA, sameStatusB, old], 'status').map((c) => c.id))
      .toEqual(['old', 'b', 'a', 'r'])
  })

  it('returns a fresh array and never mutates the input', () => {
    const input = [...items]
    const sorted = sortCandidates(input, 'confidence')
    expect(sorted).not.toBe(input)
    expect(input.map((c) => c.id)).toEqual(['old', 'recent', 'middle'])
  })

  it('handles empty and single-element inputs', () => {
    expect(sortCandidates([], 'recency')).toEqual([])
    expect(sortCandidates([old], 'status')).toEqual([old])
  })
})

describe('skillQueue and approvedSkills', () => {
  const pending = make({ id: 'pending', type: 'skill', status: 'validating' })
  const fresh = make({ id: 'fresh', type: 'skill', status: 'candidate' })
  const active = make({ id: 'active', type: 'skill', status: 'active' })
  const approved = make({ id: 'approved', type: 'skill', status: 'approved' })
  const rejected = make({ id: 'rejected', type: 'skill', status: 'rejected' })
  const lesson = make({ id: 'lesson', type: 'lesson', status: 'candidate' })
  const all = [pending, fresh, active, approved, rejected, lesson, make({ id: 'policyOnly', type: 'policy', status: 'active' })]

  it('keeps only undecided skill candidates in the queue', () => {
    expect(skillQueue(all).map((c) => c.id)).toEqual(['pending', 'fresh'])
  })

  it('keeps only durable skills once approved', () => {
    expect(approvedSkills(all).map((c) => c.id)).toEqual(['active', 'approved'])
  })

  it('never mixes the two views and tolerates empty input', () => {
    expect(skillQueue([])).toEqual([])
    expect(approvedSkills([])).toEqual([])
    expect(skillQueue(all).some((c) => c.status === 'active')).toBe(false)
    expect(approvedSkills(all).some((c) => c.status === 'validating')).toBe(false)
  })
})

describe('countCandidates', () => {
  it('counts status, type and scope independently', () => {
    const counts = countCandidates([
      make({ status: 'candidate', type: 'skill', scope: 'workspace' }),
      make({ status: 'candidate', type: 'lesson', scope: 'workspace' }),
      make({ status: 'active', type: 'skill', scope: 'global' }),
    ])
    expect(counts.status.get('candidate')).toBe(2)
    expect(counts.status.get('active')).toBe(1)
    expect(counts.status.get('rejected')).toBeUndefined()
    expect(counts.type.get('skill')).toBe(2)
    expect(counts.type.get('lesson')).toBe(1)
    expect(counts.scope.get('workspace')).toBe(2)
    expect(counts.scope.get('global')).toBe(1)
  })

  it('returns empty maps for an empty set', () => {
    const counts = countCandidates([])
    expect(counts.status.size).toBe(0)
    expect(counts.type.size).toBe(0)
    expect(counts.scope.size).toBe(0)
  })

  it('counts every declared scope without inventing buckets', () => {
    const counts = countCandidates(LEARNING_SCOPES.map((scope, index) => make({ id: `s${index}`, scope })))
    expect([...counts.scope.keys()].sort()).toEqual([...LEARNING_SCOPES].sort())
    for (const scope of LEARNING_SCOPES) expect(counts.scope.get(scope)).toBe(1)
  })
})

describe('failedPasses and confidenceRows', () => {
  const passes: ValidationPassResult[] = [
    { pass: 'duplicate', ok: true },
    { pass: 'evidence_count', ok: false, detail: 'needs 3 evidence refs' },
    { pass: 'consistency', ok: false, detail: 'contradicts L-42' },
  ]

  it('returns only the deterministic passes that refused promotion', () => {
    const failed = failedPasses(make({ validation: { passes, promotable: false, checkedAt: '2026-10-01T00:00:00.000Z' } }))
    expect(failed.map((p) => p.pass)).toEqual(['evidence_count', 'consistency'])
    expect(failed.map((p) => p.detail)).toEqual(['needs 3 evidence refs', 'contradicts L-42'])
  })

  it('returns nothing when promotion was allowed', () => {
    expect(failedPasses(make())).toEqual([])
  })

  it('projects confidence components in canonical order with their values', () => {
    const rows = confidenceRows({ recurrence: 0.1, evidenceQuality: 0.2, userSignal: 0.3,
      repositorySupport: 0.4, outcomeSupport: 0.5, consistency: 0.6 })
    expect(rows.map((row) => row.key)).toEqual([...CONFIDENCE_COMPONENTS])
    expect(rows.map((row) => row.value)).toEqual([0.1, 0.2, 0.3, 0.4, 0.5, 0.6])
  })
})

describe('effectivenessBand', () => {
  it('bands a 0..1 score with inclusive thresholds', () => {
    expect(effectivenessBand(1)).toBe('high')
    expect(effectivenessBand(0.75)).toBe('high')
    expect(effectivenessBand(0.749)).toBe('medium')
    expect(effectivenessBand(0.45)).toBe('medium')
    expect(effectivenessBand(0.449)).toBe('low')
    expect(effectivenessBand(0)).toBe('low')
  })

  it('labels missing or non-finite reports as unknown instead of guessing', () => {
    expect(effectivenessBand(null)).toBe('unknown')
    expect(effectivenessBand(undefined)).toBe('unknown')
    expect(effectivenessBand(Number.NaN)).toBe('unknown')
    expect(effectivenessBand(Number.POSITIVE_INFINITY)).toBe('unknown')
  })
})

describe('averageConfidence', () => {
  it('averages confidence across the set', () => {
    expect(averageConfidence([make({ confidence: 0.5 }), make({ confidence: 1 })])).toBe(0.75)
    expect(averageConfidence([make({ confidence: 0.25 })])).toBe(0.25)
  })

  it('never returns NaN for an empty set', () => {
    const average = averageConfidence([])
    expect(average).toBe(0)
    expect(Number.isFinite(average)).toBe(true)
  })

  it('includes every candidate regardless of status', () => {
    expect(averageConfidence([
      make({ status: 'rejected', confidence: 0 }),
      make({ status: 'active', confidence: 1 }),
      make({ status: 'validating', confidence: 0.5 }),
    ])).toBe(0.5)
  })
})

describe('groupTimeline', () => {
  const entries = [
    entry('mutation', '2026-10-02T00:00:00.000Z', 'm2'),
    entry('candidate', '2026-10-01T00:00:00.000Z', 'c1'),
    entry('mutation', '2026-10-04T00:00:00.000Z', 'm3'),
    entry('observation', '2026-10-03T00:00:00.000Z', 'o1'),
    entry('candidate', '2026-10-05T00:00:00.000Z', 'c2'),
    entry('rollback', '2026-10-06T00:00:00.000Z', 'r1'),
    entry('experiment', '2026-10-07T00:00:00.000Z', 'x1'),
    entry('outcome', '2026-10-08T00:00:00.000Z', 't1'),
  ]

  it('emits groups in TIMELINE_KINDS order', () => {
    expect(groupTimeline(entries).map((group) => group.kind)).toEqual([...TIMELINE_KINDS])
  })

  it('sorts newest-first inside each kind and keeps entry identity', () => {
    const groups = groupTimeline(entries)
    const byKind = new Map(groups.map((group) => [group.kind, group.items]))
    expect(byKind.get('mutation')!.map((item) => item.id)).toEqual(['m3', 'm2'])
    expect(byKind.get('candidate')!.map((item) => item.id)).toEqual(['c2', 'c1'])
    expect(byKind.get('observation')!.map((item) => item.id)).toEqual(['o1'])
    expect(byKind.get('outcome')!.map((item) => item.id)).toEqual(['t1'])
  })

  it('omits empty kinds instead of rendering blank sections', () => {
    const only = groupTimeline([entry('rollback', '2026-10-06T00:00:00.000Z', 'r1')])
    expect(only).toHaveLength(1)
    expect(only[0]!.kind).toBe('rollback')
  })

  it('handles an empty timeline', () => {
    expect(groupTimeline([])).toEqual([])
  })

  it('does not mutate the entry list', () => {
    const input = [...entries]
    groupTimeline(input)
    expect(input.map((item) => item.id)).toEqual(entries.map((item) => item.id))
  })
})