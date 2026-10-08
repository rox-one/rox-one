import { describe, expect, it } from 'bun:test'
import { buildRuntimeGraph, projectRuntimeEvents } from '@rox/core/runtime-trace'
import { createRuntimeTraceFixture } from '@rox/core/runtime-trace/fixture'
import type {
  CandidateValidation,
  ConfidenceComponents,
  LearningCandidate,
  LearningCandidateType,
  LearningEvidence,
  LearningMutation,
  LearningPolicy,
  TaskOutcome,
  UserCorrection,
  ValidationPassResult,
} from '@rox/shared/memory/learning'
import {
  LEARNING_CHAIN_EDGE_KIND,
  LEARNING_CHAIN_ROLES,
  LEARNING_NODE_KINDS,
  LEARNING_NODE_REGISTRY,
  deriveLearningMap,
  isLearningNodeKind,
  learningNodeKindForCandidate,
  learningOutcomeLabel,
  learningValidationSubtitle,
  type LearningMapInput,
} from '../learning-nodes'
import { publicRuntimeMetadata } from '../public-metadata'

const CONFIDENCE: ConfidenceComponents = { recurrence: .6, evidenceQuality: .8, userSignal: .9, repositorySupport: .5, outcomeSupport: .7, consistency: .8 }
const PASSES: readonly ValidationPassResult['pass'][] = ['duplicate', 'contradiction', 'scope', 'sensitive', 'evidence_count', 'repository_evidence', 'outcome_evidence', 'consistency']

function passSet(fail: readonly ValidationPassResult['pass'][] = []): CandidateValidation {
  return { passes: PASSES.map(pass => ({ pass, ok: !fail.includes(pass) })), promotable: fail.length === 0, checkedAt: '2026-10-08T09:00:00.000Z' }
}

function candidate(overrides: Partial<LearningCandidate> & { id: string; type: LearningCandidateType }): LearningCandidate {
  return {
    fingerprint: `fp-${overrides.id}`, scope: 'workspace', hypothesis: 'Reuse the auth-debug skill when tokens expire mid-retry',
    payload: {}, evidence: [], confidence: .82, confidenceComponents: CONFIDENCE, status: 'approved', validation: passSet(),
    createdAt: '2026-10-08T08:00:00.000Z', updatedAt: '2026-10-08T09:30:00.000Z', ...overrides,
  }
}

const sessionEvidence: LearningEvidence = { id: 'ev-session', type: 'session', ref: '183', weight: .6, ts: '2026-10-08T07:00:00.000Z' }
const correctionEvidence: LearningEvidence = { id: 'ev-correction', type: 'user_correction', ref: 'corr-1', weight: .9, ts: '2026-10-08T07:05:00.000Z' }
const testEvidence: LearningEvidence = { id: 'ev-test', type: 'test_result', ref: 'auth-debug.spec.ts', weight: .8, ts: '2026-10-08T07:30:00.000Z' }
const usageEvidence: LearningEvidence = { id: 'ev-usage', type: 'skill_usage', ref: 'auth-debug', weight: .7, ts: '2026-10-08T07:40:00.000Z' }

const correction: UserCorrection = { id: 'corr-1', sessionId: '183', original: 'retry the same call', corrected: 'bisect token expiry first', category: 'workflow', confidence: .9, ts: '2026-10-08T07:05:00.000Z' }
const outcome: TaskOutcome = {
  id: 'out-1', sessionId: '183', taskFingerprint: 'ts-fix/auth', status: 'success', qualityScore: .9,
  userCorrections: 1, memoryUsed: [], skillsUsed: ['auth-debug'], errors: [], ts: '2026-10-08T08:00:00.000Z',
}
const mutation: LearningMutation = {
  id: 'mut-1', candidateId: 'cand-2', targetType: 'skill', targetId: 'auth-debug', before: {}, after: {},
  actualEffect: { successRate: .23 }, rollbackAvailable: true, status: 'applied', ts: '2026-10-08T09:10:00.000Z',
}

/** PRD §30 story: `Skill: auth-debug → Session #183 → user correction → Candidate v2 → Test validation → Success +23%`. */
const prdStory: LearningMapInput = {
  candidates: [candidate({
    id: 'cand-2', type: 'skill', rollbackOf: 'cand-1', status: 'approved',
    evidence: [
      { evidenceId: 'ev-usage', type: 'skill_usage', ref: 'auth-debug', weight: .7 },
      { evidenceId: 'ev-session', type: 'session', ref: '183', weight: .6 },
      { evidenceId: 'ev-correction', type: 'user_correction', ref: 'corr-1', weight: .9 },
      { evidenceId: 'ev-test', type: 'test_result', ref: 'auth-debug.spec.ts', weight: .8 },
    ],
  })],
  evidence: [usageEvidence, sessionEvidence, correctionEvidence, testEvidence],
  corrections: [correction],
  outcomes: [outcome],
  mutations: [mutation],
}

describe('PRD §30 learning node kinds', () => {
  it('registers exactly Memory, Skill, Policy, Evidence and Outcome with code-constant labels', () => {
    expect([...LEARNING_NODE_KINDS]).toEqual(['memory', 'skill', 'policy', 'evidence', 'outcome'])
    expect(LEARNING_NODE_KINDS.map(kind => LEARNING_NODE_REGISTRY[kind].label)).toEqual(['Memory', 'Skill', 'Policy', 'Evidence', 'Outcome'])
    for (const kind of LEARNING_NODE_KINDS) {
      expect(LEARNING_NODE_REGISTRY[kind].kind).toBe(kind)
      expect(LEARNING_NODE_REGISTRY[kind].description.length).toBeGreaterThan(0)
      expect(isLearningNodeKind(kind)).toBe(true)
    }
    expect(isLearningNodeKind('experiment')).toBe(false)
    expect(LEARNING_CHAIN_ROLES).toEqual(['durable', 'session', 'correction', 'candidate', 'validation', 'outcome'])
  })

  it('maps the four candidate types onto the five kinds (lesson/preference share Memory)', () => {
    expect(learningNodeKindForCandidate('lesson')).toBe('memory')
    expect(learningNodeKindForCandidate('preference')).toBe('memory')
    expect(learningNodeKindForCandidate('skill')).toBe('skill')
    expect(learningNodeKindForCandidate('policy')).toBe('policy')
  })

  it('derives the documented Skill → Session → correction → Candidate v2 → validation → Outcome chain', () => {
    const map = deriveLearningMap(prdStory)
    expect(map.nodes).toEqual([
      { id: 'learning:skill:auth-debug', kind: 'skill', role: 'durable', label: 'Skill: auth-debug', subtitle: 'Applied · skill', provenance: { candidateId: 'cand-2' } },
      { id: 'learning:evidence:session:183', kind: 'evidence', role: 'session', label: 'Session #183', subtitle: sessionEvidence.ts, provenance: { candidateId: 'cand-2', evidenceId: 'ev-session' } },
      { id: 'learning:evidence:correction:corr-1', kind: 'evidence', role: 'correction', label: 'user correction', subtitle: 'workflow · 90%', provenance: { candidateId: 'cand-2', evidenceId: 'ev-correction' } },
      { id: 'learning:candidate:cand-2', kind: 'skill', role: 'candidate', label: 'Candidate v2', subtitle: 'Skill · approved · 82%', provenance: { candidateId: 'cand-2' } },
      { id: 'learning:evidence:validation:cand-2', kind: 'evidence', role: 'validation', label: 'Test validation', subtitle: '8/8 passes · promotable', provenance: { candidateId: 'cand-2' } },
      { id: 'learning:outcome:out-1', kind: 'outcome', role: 'outcome', label: 'Success +23%', subtitle: 'ts-fix/auth', provenance: { candidateId: 'cand-2', outcomeId: 'out-1' } },
    ])
    expect(map.edges.map(edge => [edge.id, edge.source, edge.target, edge.kind])).toEqual([
      ['learning-edge:learning:skill:auth-debug->learning:evidence:session:183', 'learning:skill:auth-debug', 'learning:evidence:session:183', LEARNING_CHAIN_EDGE_KIND],
      ['learning-edge:learning:evidence:session:183->learning:evidence:correction:corr-1', 'learning:evidence:session:183', 'learning:evidence:correction:corr-1', LEARNING_CHAIN_EDGE_KIND],
      ['learning-edge:learning:evidence:correction:corr-1->learning:candidate:cand-2', 'learning:evidence:correction:corr-1', 'learning:candidate:cand-2', LEARNING_CHAIN_EDGE_KIND],
      ['learning-edge:learning:candidate:cand-2->learning:evidence:validation:cand-2', 'learning:candidate:cand-2', 'learning:evidence:validation:cand-2', LEARNING_CHAIN_EDGE_KIND],
      ['learning-edge:learning:evidence:validation:cand-2->learning:outcome:out-1', 'learning:evidence:validation:cand-2', 'learning:outcome:out-1', LEARNING_CHAIN_EDGE_KIND],
    ])
    expect(map.nodes.every(node => isLearningNodeKind(node.kind))).toBe(true)
    expect([...new Set(map.nodes.map(node => node.kind))]).toEqual(['skill', 'evidence', 'outcome'])
  })

  it('is deterministic: input order does not change node or edge output', () => {
    const reordered: LearningMapInput = { ...prdStory, candidates: [...prdStory.candidates], evidence: [...prdStory.evidence!].reverse() }
    const twice = deriveLearningMap({ ...prdStory, evidence: [...prdStory.evidence!] })
    expect(deriveLearningMap(reordered)).toEqual(twice)
  })

  it('keeps one durable node per entity and numbers re-proposals so a rollback candidate is never v1', () => {
    const map = deriveLearningMap({
      ...prdStory,
      candidates: [
        candidate({ id: 'cand-1', type: 'skill', createdAt: '2026-10-08T07:00:00.000Z', evidence: [{ evidenceId: 'ev-usage', type: 'skill_usage', ref: 'auth-debug', weight: .7 }] }),
        candidate({ id: 'cand-2', type: 'skill', rollbackOf: 'cand-1', evidence: [{ evidenceId: 'ev-usage', type: 'skill_usage', ref: 'auth-debug', weight: .7 }] }),
      ],
    })
    expect(map.nodes.filter(node => node.role === 'durable')).toHaveLength(1)
    expect(map.nodes.filter(node => node.role === 'candidate').map(node => node.label)).toEqual(['Candidate v1', 'Candidate v2'])
  })

  it('skips chain steps without evidence instead of fabricating a session, correction or outcome', () => {
    const policy: LearningPolicy = {
      id: 'pol-1', fingerprint: 'fp-cand-pol', taskClass: 'ts-fix/auth', preferredSkills: ['auth-debug'], verification: ['typecheck'],
      delegation: 'prefer', confidence: .7, evidence: [], status: 'candidate', createdAt: '2026-10-08T08:00:00.000Z', updatedAt: '2026-10-08T08:00:00.000Z',
    }
    const map = deriveLearningMap({ candidates: [candidate({ id: 'cand-pol', type: 'policy' })], policies: [policy] })
    expect(map.nodes.map(node => [node.id, node.kind, node.role])).toEqual([
      ['learning:policy:pol-1', 'policy', 'durable'],
      ['learning:candidate:cand-pol', 'policy', 'candidate'],
      ['learning:evidence:validation:cand-pol', 'evidence', 'validation'],
    ])
    expect(map.edges.map(edge => [edge.source, edge.target])).toEqual([
      ['learning:policy:pol-1', 'learning:candidate:cand-pol'],
      ['learning:candidate:cand-pol', 'learning:evidence:validation:cand-pol'],
    ])
  })

  it('covers Memory candidates and labels the outcome from the recorded effect', () => {
    const map = deriveLearningMap({
      candidates: [candidate({ id: 'cand-mem', type: 'lesson', evidence: [{ evidenceId: 'ev-mem', type: 'memory_usage', ref: 'mem-77', weight: .5 }, { evidenceId: 'ev-session', type: 'session', ref: '184', weight: .6 }] })],
      evidence: [{ id: 'ev-mem', type: 'memory_usage', ref: 'mem-77', weight: .5, ts: '2026-10-08T07:00:00.000Z' }, sessionEvidence],
      outcomes: [{ ...outcome, id: 'out-2', sessionId: '184', skillsUsed: [], memoryUsed: ['mem-77'], status: 'partial' }],
    })
    expect(map.nodes.map(node => [node.kind, node.role, node.label])).toEqual([
      ['memory', 'durable', 'Memory: mem-77'],
      ['evidence', 'session', 'Session #184'],
      ['memory', 'candidate', 'Candidate v1'],
      ['evidence', 'validation', 'Test validation'],
      ['outcome', 'outcome', 'Partial'],
    ])
    expect(learningOutcomeLabel({ ...outcome, status: 'success' }, mutation)).toBe('Success +23%')
    expect(learningOutcomeLabel({ ...outcome, status: 'success' })).toBe('Success')
    expect(learningValidationSubtitle(candidate({ id: 'x', type: 'skill', validation: passSet(['outcome_evidence']) }))).toBe('7/8 passes · failed: outcome_evidence')
  })

  it('PRD §30 limitation: all five kinds have a learning DTO surface, but the live canvas is event-only, so the kinds are registered while no runtime node carries them yet', () => {
    const graph = buildRuntimeGraph(projectRuntimeEvents(createRuntimeTraceFixture()))
    for (const kind of LEARNING_NODE_KINDS) {
      const probe = graph.nodes.map((node, index) => index === 0 ? { ...node, kind } : node)
      expect(publicRuntimeMetadata({ ...graph, nodes: probe }, { state: 'complete', source: 'runtime', missing: [] }).nodes[0]!.kind).toBe(kind)
    }
    const unregistered = graph.nodes.map((node, index) => index === 0 ? { ...node, kind: 'experiment' } : node)
    expect(publicRuntimeMetadata({ ...graph, nodes: unregistered }, { state: 'complete', source: 'runtime', missing: [] }).nodes[0]!.kind).toBe('unknown')
  })
})