import { describe, expect, it } from 'bun:test'
import { buildRuntimeGraph, projectRuntimeEvents, type RuntimeGraph } from '@rox/core/runtime-trace'
import { createRuntimeTraceFixture } from '@rox/core/runtime-trace/fixture'
import type {
  CandidateValidation,
  ConfidenceComponents,
  EvidenceRef,
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
  LEARNING_NODE_KINDS,
  isLearningNodeKind,
  type LearningMapInput,
} from '../learning-nodes'
import {
  EMPTY_LEARNING_OVERLAY,
  learningNodeMatches,
  learningOverlay,
  loadLearningMapInput,
  mergeLearningOverlay,
  visibleLearningNodes,
  type LearningReadApi,
} from '../learning-overlay'
import { learningFlowNode, learningRowY } from '../layout/learning-flow'
import { layoutRuntimeGraph, LANE_HEIGHT } from '../layout/stable-layout'

const CONFIDENCE: ConfidenceComponents = { recurrence: .6, evidenceQuality: .8, userSignal: .9, repositorySupport: .5, outcomeSupport: .7, consistency: .8 }
const PASSES: readonly ValidationPassResult['pass'][] = ['duplicate', 'contradiction', 'scope', 'sensitive', 'evidence_count', 'repository_evidence', 'outcome_evidence', 'consistency']

function passSet(): CandidateValidation {
  return { passes: PASSES.map(pass => ({ pass, ok: true })), promotable: true, checkedAt: '2026-10-08T09:00:00.000Z' }
}

function candidate(overrides: Partial<LearningCandidate> & { id: string; type: LearningCandidateType }): LearningCandidate {
  return {
    fingerprint: `fp-${overrides.id}`, scope: 'workspace', hypothesis: 'Reuse the auth-debug skill when tokens expire mid-retry',
    payload: {}, evidence: [], confidence: .82, confidenceComponents: CONFIDENCE, status: 'approved', validation: passSet(),
    createdAt: '2026-10-08T08:00:00.000Z', updatedAt: '2026-10-08T09:30:00.000Z', ...overrides,
  }
}

function evidenceRef(evidenceId: string, type: EvidenceRef['type'], ref: string): EvidenceRef {
  return { evidenceId, type, ref, weight: .7 }
}

const sessionEvidence: LearningEvidence = { id: 'ev-session', type: 'session', ref: '183', weight: .6, ts: '2026-10-08T07:00:00.000Z' }
const correctionEvidence: LearningEvidence = { id: 'ev-correction', type: 'user_correction', ref: 'corr-1', weight: .9, ts: '2026-10-08T07:05:00.000Z' }
const testEvidence: LearningEvidence = { id: 'ev-test', type: 'test_result', ref: 'auth-debug.spec.ts', weight: .8, ts: '2026-10-08T07:30:00.000Z' }
const outcomeEvidence: LearningEvidence = { id: 'ev-out-1', type: 'successful_outcome', ref: 'out-1', weight: .8, ts: '2026-10-08T08:00:00.000Z' }
const memoryOutcomeEvidence: LearningEvidence = { id: 'ev-out-2', type: 'successful_outcome', ref: 'out-2', weight: .8, ts: '2026-10-08T08:10:00.000Z' }
const usageEvidence: LearningEvidence = { id: 'ev-usage', type: 'skill_usage', ref: 'auth-debug', weight: .7, ts: '2026-10-08T07:40:00.000Z' }
const memoryEvidence: LearningEvidence = { id: 'ev-memory', type: 'memory_usage', ref: 'auth-retry-lesson', weight: .7, ts: '2026-10-08T07:45:00.000Z' }
const memorySessionEvidence: LearningEvidence = { id: 'ev-session-184', type: 'session', ref: '184', weight: .6, ts: '2026-10-08T07:10:00.000Z' }

const correction: UserCorrection = { id: 'corr-1', sessionId: '183', original: 'retry the same call', corrected: 'bisect token expiry first', category: 'workflow', confidence: .9, ts: '2026-10-08T07:05:00.000Z' }
const outcome: TaskOutcome = {
  id: 'out-1', sessionId: '183', taskFingerprint: 'ts-fix/auth', status: 'success', qualityScore: .9,
  userCorrections: 1, memoryUsed: [], skillsUsed: ['auth-debug'], errors: [], ts: '2026-10-08T08:00:00.000Z',
}
const memoryOutcome: TaskOutcome = {
  id: 'out-2', sessionId: '184', taskFingerprint: 'ts-fix/auth-memory', status: 'success', qualityScore: .8,
  userCorrections: 0, memoryUsed: ['auth-retry-lesson'], skillsUsed: [], errors: [], ts: '2026-10-08T08:10:00.000Z',
}
const mutation: LearningMutation = {
  id: 'mut-1', candidateId: 'cand-2', targetType: 'skill', targetId: 'auth-debug', before: {}, after: {},
  actualEffect: { successRate: .23 }, rollbackAvailable: true, status: 'applied', ts: '2026-10-08T09:10:00.000Z',
}
const policy: LearningPolicy = {
  id: 'cand-pol', fingerprint: 'fp-cand-pol', taskClass: 'auth-retry', preferredSkills: [], verification: [], delegation: 'neutral',
  confidence: .7, evidence: [evidenceRef('ev-session-185', 'session', '185')], status: 'active',
  createdAt: '2026-10-08T08:20:00.000Z', updatedAt: '2026-10-08T09:20:00.000Z',
}

/** PRD §30 story: `Skill: auth-debug → Session #183 → user correction → Candidate v2 → Test validation → Success +23%`. */
const prdStory: LearningMapInput = {
  candidates: [candidate({
    id: 'cand-2', type: 'skill', rollbackOf: 'cand-1', status: 'approved',
    evidence: [
      evidenceRef('ev-usage', 'skill_usage', 'auth-debug'),
      evidenceRef('ev-session', 'session', '183'),
      evidenceRef('ev-correction', 'user_correction', 'corr-1'),
      evidenceRef('ev-test', 'test_result', 'auth-debug.spec.ts'),
      evidenceRef('ev-out-1', 'successful_outcome', 'out-1'),
    ],
  })],
  evidence: [usageEvidence, sessionEvidence, correctionEvidence, testEvidence, outcomeEvidence],
  corrections: [correction],
  outcomes: [outcome],
  mutations: [mutation],
}

/**
 * Three candidates covering all five kinds at once: the PRD §30 skill chain plus a
 * lesson (Memory) chain and a policy chain.
 */
const spreadStory: LearningMapInput = {
  candidates: [
    ...prdStory.candidates,
    candidate({
      id: 'cand-mem', type: 'lesson', status: 'approved',
      evidence: [evidenceRef('ev-memory', 'memory_usage', 'auth-retry-lesson'), evidenceRef('ev-session-184', 'session', '184'), evidenceRef('ev-out-2', 'successful_outcome', 'out-2')],
    }),
    candidate({ id: 'cand-pol', type: 'policy', status: 'approved', evidence: [evidenceRef('ev-session-185', 'session', '185')] }),
  ],
  evidence: [...prdStory.evidence!, memoryEvidence, memorySessionEvidence, memoryOutcomeEvidence],
  corrections: [correction],
  outcomes: [outcome, memoryOutcome],
  mutations: [mutation],
  policies: [policy],
}

function fixtureGraph(): RuntimeGraph {
  return buildRuntimeGraph(projectRuntimeEvents(createRuntimeTraceFixture()))
}

function supportedApi(overrides: Partial<LearningReadApi> = {}): Partial<LearningReadApi> {
  return {
    listLearningCandidates: async () => spreadStory.candidates as LearningCandidate[],
    listLearningEvidence: async () => [...spreadStory.evidence!],
    getLearningOutcome: async (_workspaceId, id) => [outcome, memoryOutcome].find(item => item.id === id) ?? null,
    getLearningPolicy: async () => [policy],
    ...overrides,
  }
}

describe('PRD §30 learning overlay in the runtime map', () => {
  it('merges the derived chain into the map node set without touching the event-derived graph', () => {
    const graph = fixtureGraph()
    expect(graph.nodes.length).toBeGreaterThan(0)
    const learning = learningOverlay(prdStory)
    const merged = mergeLearningOverlay(graph, learning)

    expect(merged.graph).toBe(graph)
    expect(merged.nodes.slice(0, graph.nodes.length)).toEqual(graph.nodes.map(node => ({ id: node.id, kind: node.kind, origin: 'runtime' })))
    expect(merged.nodes.slice(graph.nodes.length)).toEqual(learning.nodes.map(node => ({ id: node.id, kind: node.kind, origin: 'learning', label: node.label })))
    for (const id of [
      'learning:skill:auth-debug',
      'learning:evidence:session:183',
      'learning:evidence:correction:corr-1',
      'learning:candidate:cand-2',
      'learning:evidence:validation:cand-2',
      'learning:outcome:out-1',
    ]) expect(merged.nodes.some(node => node.id === id && node.origin === 'learning')).toBe(true)
  })

  it('keeps runtime nodes first and every effective id unique, so focus-latest stays a trace node', () => {
    const graph = fixtureGraph()
    const merged = mergeLearningOverlay(graph, learningOverlay(spreadStory))
    const ids = merged.nodes.map(node => node.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.slice(0, graph.nodes.length)).toEqual(graph.nodes.map(node => node.id))
    expect(merged.nodes.at(-1)!.origin).toBe('learning')
    expect(merged.nodes.slice(0, graph.nodes.length).every(node => node.origin === 'runtime')).toBe(true)
  })

  it('carries all five PRD §30 kinds across a representative workspace and keeps every chain edge inside the effective set', () => {
    const graph = fixtureGraph()
    const learning = learningOverlay(spreadStory)
    const kinds = [...new Set(learning.nodes.map(node => node.kind))]
    expect(kinds.sort()).toEqual(['evidence', 'memory', 'outcome', 'policy', 'skill'])
    for (const kind of LEARNING_NODE_KINDS) expect(kinds).toContain(kind)
    expect(learning.nodes.every(node => isLearningNodeKind(node.kind))).toBe(true)

    const effective = new Set(mergeLearningOverlay(graph, learning).nodes.map(node => node.id))
    expect(learning.edges.length).toBeGreaterThan(0)
    expect(learning.edges.every(edge => effective.has(edge.source) && effective.has(edge.target))).toBe(true)
  })

  it('projects each effective learning node into a canvas flow node with geometry, no selection and no fabrication', () => {
    const graph = fixtureGraph()
    const layout = layoutRuntimeGraph(graph)
    const rowY = learningRowY(layout)
    const laneYs = [...layout.lanes.values()].map(position => position.y)
    expect(laneYs.length).toBeGreaterThan(0)
    expect(rowY).toBe(Math.max(...laneYs, 44) + LANE_HEIGHT + 32)

    const learning = learningOverlay(prdStory)
    const t = ((key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key) as Parameters<typeof learningFlowNode>[2]
    const flow = learning.nodes.map((node, index) => learningFlowNode(node, index, t, false, rowY))
    expect(flow.map(node => node.id)).toEqual(learning.nodes.map(node => node.id))
    expect(flow.map(node => [node.type, node.position.y])).toEqual(learning.nodes.map((_, index) => ['learning', rowY]))
    expect(flow.map(node => node.position.x)).toEqual(learning.nodes.map((_, index) => index * 302))
    expect(flow.every(node => node.data.learning && node.selectable === false && node.draggable === false && node.focusable === false)).toBe(true)
    expect(flow.every(node => node.initialWidth === 268 && node.initialHeight === 128)).toBe(true)
  })
})

describe('learning overlay data source', () => {
  it('adds nothing when there is no learning API, no workspace or no workspace learning service', async () => {
    expect(await loadLearningMapInput('ws-1', {})).toBeUndefined()
    expect(await loadLearningMapInput('ws-1', undefined)).toBeUndefined()
    expect(await loadLearningMapInput(undefined, supportedApi())).toBeUndefined()
    expect(await loadLearningMapInput('ws-1', { listLearningCandidates: async () => { throw Object.assign(new Error('no learning service'), { code: 'UNSUPPORTED_OPERATION' }) } })).toBeUndefined()
    expect(await loadLearningMapInput('ws-1', { listLearningCandidates: async () => { throw new Error('transport down') } })).toBeUndefined()
  })

  it('degrades a failing evidence, policy or outcome read to the fields that did load, never throwing', async () => {
    const input = await loadLearningMapInput('ws-1', supportedApi({
      listLearningEvidence: async () => { throw new Error('evidence read failed') },
      getLearningPolicy: async () => { throw new Error('policy read failed') },
      getLearningOutcome: async () => { throw new Error('outcome read failed') },
    }))
    expect(input?.candidates.length).toBe(3)
    expect(input?.evidence).toEqual([])
    expect(input?.policies).toEqual([])
    expect(input?.outcomes).toEqual([])
    expect(learningOverlay(input).nodes.length).toBeGreaterThan(0)
  })

  it('leaves the map node set exactly the runtime nodes when the overlay is empty', () => {
    const graph = fixtureGraph()
    expect(mergeLearningOverlay(graph, EMPTY_LEARNING_OVERLAY).nodes).toEqual(graph.nodes.map(node => ({ id: node.id, kind: node.kind, origin: 'runtime' })))
    expect(learningOverlay(undefined)).toBe(EMPTY_LEARNING_OVERLAY)
    expect(learningOverlay({ candidates: [] })).toBe(EMPTY_LEARNING_OVERLAY)
  })

  it('loads the read-only learning surface into a derivable chain on a supported host', async () => {
    const graph = fixtureGraph()
    const input = await loadLearningMapInput('ws-1', supportedApi())
    expect(input?.evidence?.length).toBe(spreadStory.evidence!.length)
    expect(input?.policies).toEqual([policy])
    expect(input?.outcomes?.map(item => item.id)).toEqual(['out-1', 'out-2'])
    expect(visibleLearningNodes(graph, learningOverlay(input), { query: '', filter: 'all', context: false }).length).toBe(learningOverlay(input).nodes.length)
  })
})

describe('learning overlay participation in the map', () => {
  const graph = fixtureGraph()
  const overlay = learningOverlay(spreadStory)

  it('joins the map only when the trace is present and the mode is not context', () => {
    expect(visibleLearningNodes(graph, overlay, { query: '', filter: 'all', context: false }).length).toBe(overlay.nodes.length)
    expect(visibleLearningNodes(graph, overlay, { query: '', filter: 'all', context: true })).toEqual([])
    expect(visibleLearningNodes(buildRuntimeGraph(projectRuntimeEvents([])), overlay, { query: '', filter: 'all', context: false })).toEqual([])
  })

  it('honours the toolbar kind filter and the text query', () => {
    expect(visibleLearningNodes(graph, overlay, { query: '', filter: 'policy', context: false }).every(node => node.kind === 'policy')).toBe(true)
    expect(visibleLearningNodes(graph, overlay, { query: '', filter: 'waiting', context: false })).toEqual([])
    expect(visibleLearningNodes(graph, overlay, { query: 'auth-retry-lesson', filter: 'all', context: false }).map(node => node.id)).toContain('learning:memory:auth-retry-lesson')
    expect(learningNodeMatches(overlay.nodes[0]!, 'no-such-text-anywhere', 'all')).toBe(false)
  })
})