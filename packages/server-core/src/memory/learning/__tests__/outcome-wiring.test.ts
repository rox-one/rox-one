/**
 * observeCompletion → TaskOutcome wiring (WP-113, PRD §3.5/§19/§40).
 *
 * `observeCompletion` is the sole producer of TaskOutcome rows; `evaluateOutcomes`
 * (§40) is the sole consumer. Real store classes over a temp workspace; only the
 * frozen ports (targets, skills-learning policy) are in-memory fakes.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createHash } from 'crypto'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { LearningMutation, LearningObservation } from '@rox/shared/memory/learning'
import { DEFAULT_LEARNING_THRESHOLDS, DEFAULT_SKILLS_LEARNING_POLICY } from '@rox/shared/memory/learning'
import { LearningService } from '../LearningService'
import type { LearningServiceStores } from '../LearningService'
import type { LearningTargetStores, ValidatorPorts } from '../learning-types'
import { CandidateStore } from '../CandidateStore'
import { EvidenceStore } from '../EvidenceStore'
import { ExperimentStore } from '../ExperimentStore'
import { MutationStore } from '../MutationStore'
import { ObservationStore } from '../ObservationStore'
import { OutcomeStore } from '../OutcomeStore'
import { PolicyStore } from '../PolicyStore'

const NOW = Date.parse('2026-10-08T00:00:00.000Z')
const NOW_ISO = new Date(NOW).toISOString()
const WS = 'ws-outcome'
const CATEGORY = 'refactor'
const sha256Hex = (text: string): string => createHash('sha256').update(text).digest('hex')
/** Mirrors LearningService.terminalOutcome's comparable-task fingerprint (PRD §19). */
const fingerprintFor = (category: string): string => sha256Hex(`${WS}\u0000${category}`).slice(0, 32)

const tmpDirs: string[] = []
beforeEach(() => {
  tmpDirs.push(mkdtempSync(join(tmpdir(), 'learning-outcome-')))
})
afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Real-store rig (no store is mocked) + frozen-port fakes
// ---------------------------------------------------------------------------

function storesFor(root: string): LearningServiceStores {
  return {
    observations: new ObservationStore(root),
    candidates: new CandidateStore(root),
    evidence: new EvidenceStore(root),
    outcomes: new OutcomeStore(root),
    mutations: new MutationStore(root),
    experiments: new ExperimentStore(root),
    policies: new PolicyStore(root),
  }
}

function makeTargets(): LearningTargetStores {
  return {
    addLesson: () => {},
    removeLesson: () => true,
    enqueueSkill: () => true,
    removeQueuedSkill: () => true,
    readQueuedSkill: () => null,
    savePolicy: () => {},
    removePolicy: () => true,
  }
}

function makeService(stores: LearningServiceStores, clock: () => number): LearningService {
  const validatorPorts: ValidatorPorts = {
    listExistingRules: () => [],
    readRepositorySignals: () => [],
    listOutcomesByFingerprint: () => [],
    readSkillsLearningPolicy: () => ({ ...DEFAULT_SKILLS_LEARNING_POLICY }),
    thresholds: { ...DEFAULT_LEARNING_THRESHOLDS },
  }
  return new LearningService({
    workspaceRoot: '',
    workspaceId: WS,
    clock,
    logger: { warn: () => {} },
    stores,
    targets: makeTargets(),
    validatorPorts,
    thresholds: { ...DEFAULT_LEARNING_THRESHOLDS },
  })
}

function observation(sessionId: string, over: Partial<LearningObservation> = {}): LearningObservation {
  return {
    id: `obs-${sessionId}`,
    sessionId,
    workspaceId: WS,
    ts: NOW_ISO,
    task: { category: CATEGORY },
    execution: { tools: ['bash'], skills: [], models: [], delegated: false },
    outcome: { status: 'partial' },
    signals: { userCorrections: [], errors: [], branches: 0, interruptions: 0 },
    memory: { lessonsInjected: [], episodesRecalled: [], skillsInjected: [] },
    artifacts: { filesChanged: 0 },
    ...over,
  }
}

function mutation(candidateId: string, ts: string): LearningMutation {
  return {
    id: `mut-${candidateId}`,
    candidateId,
    targetType: 'lesson',
    targetId: 'learned rule',
    before: null,
    after: { rule: 'learned rule', scope: 'workspace' },
    rollbackAvailable: true,
    status: 'applied',
    ts,
  }
}

function activeCandidate(id: string): Parameters<CandidateStore['save']>[0] {
  return {
    id,
    fingerprint: `fp-${id}`,
    type: 'lesson',
    scope: 'workspace',
    hypothesis: 'learned rule',
    payload: { rule: 'learned rule' },
    evidence: [],
    confidence: 0.8,
    confidenceComponents: { recurrence: 1, evidenceQuality: 1, userSignal: 1, repositorySupport: 1, outcomeSupport: 1, consistency: 1 },
    status: 'active',
    validation: { passes: [], promotable: true, checkedAt: NOW_ISO },
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
  }
}

// ---------------------------------------------------------------------------
// 1-3: observeCompletion records exactly one deterministic TaskOutcome
// ---------------------------------------------------------------------------

describe('observeCompletion → TaskOutcome', () => {
  it("records one success row per terminal session with a stable comparable-task fingerprint", () => {
    const root = tmpDirs[tmpDirs.length - 1]!
    const stores = storesFor(root)
    const service = makeService(stores, () => NOW)
    stores.observations.append(observation('sess-a', { artifacts: { filesChanged: 0, testsPassed: 3, testsFailed: 1 }, memory: { lessonsInjected: [{ rule: 'rule-1', scope: 'workspace' }], episodesRecalled: [], skillsInjected: ['skill-x'] } }))

    service.observeCompletion({ workspaceId: WS, sessionId: 'sess-a', reason: 'complete' })

    expect(stores.outcomes.list()).toHaveLength(1)
    const row = service.getOutcome(WS, 'out_sess-a')!
    expect(row.id).toBe('out_sess-a')
    expect(row.sessionId).toBe('sess-a')
    expect(row.workspaceId).toBe(WS)
    expect(row.status).toBe('success')
    expect(row.taskFingerprint).toBe(fingerprintFor(CATEGORY))
    expect(row.taskFingerprint).toHaveLength(32)
    expect(row.qualityScore).toBe(0.75)
    expect(row.userCorrections).toBe(0)
    expect(row.memoryUsed).toEqual(['rule-1'])
    expect(row.skillsUsed).toEqual(['skill-x'])
    expect(row.errors).toEqual([])
    // No source → no fabrication.
    expect(row.durationMs).toBeUndefined()
    expect(row.tokenUsage).toBeUndefined()
    expect(row.verification).toBeUndefined()

    // A second session in the same workspace + category yields the same fingerprint.
    stores.observations.append(observation('sess-b'))
    service.observeCompletion({ workspaceId: WS, sessionId: 'sess-b', reason: 'complete' })
    expect(stores.outcomes.list()).toHaveLength(2)
    expect(service.getOutcome(WS, 'out_sess-b')!.taskFingerprint).toBe(row.taskFingerprint)
    // Without test artifacts the quality score is omitted.
    expect(service.getOutcome(WS, 'out_sess-b')!.qualityScore).toBeUndefined()
  })

  it('is idempotent for a repeated identical terminal event (replay-safe id)', () => {
    const root = tmpDirs[tmpDirs.length - 1]!
    const stores = storesFor(root)
    const service = makeService(stores, () => NOW)
    const evt = { workspaceId: WS, sessionId: 'sess-replay', reason: 'complete' as const }

    service.observeCompletion(evt)
    service.observeCompletion(evt)
    service.observeCompletion(evt)

    expect(stores.outcomes.list()).toHaveLength(1)
    expect(service.getOutcome(WS, 'out_sess-replay')!.status).toBe('success')
  })

  it("maps reason → status and writes no outcome for 'branch'", () => {
    const root = tmpDirs[tmpDirs.length - 1]!
    const stores = storesFor(root)
    const service = makeService(stores, () => NOW)
    const cases = [
      { reason: 'error', status: 'failure' },
      { reason: 'timeout', status: 'aborted' },
      { reason: 'interrupted', status: 'aborted' },
    ] as const

    for (const { reason, status } of cases) {
      service.observeCompletion({ workspaceId: WS, sessionId: `sess-${reason}`, reason })
      expect(service.getOutcome(WS, `out_sess-${reason}`)!.status).toBe(status)
    }
    service.observeCompletion({ workspaceId: WS, sessionId: 'sess-branch', reason: 'branch' })

    expect(stores.outcomes.list()).toHaveLength(3)
    expect(service.getOutcome(WS, 'out_sess-branch')).toBeNull()
    // The branch is still recorded on the observation, just not as an outcome.
    expect(stores.observations.listBySession('sess-branch')[0]!.signals.branches).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// 4: wired outcomes actually drive automatic rollback (PRD §40)
// ---------------------------------------------------------------------------

describe('observeCompletion outcomes drive evaluateOutcomes rollback', () => {
  it('reverts an applied mutation when a later failure outcome drops success below baseline', async () => {
    const root = tmpDirs[tmpDirs.length - 1]!
    const stores = storesFor(root)
    let clockMs = NOW
    const service = makeService(stores, () => clockMs)

    // Baseline: one success outcome before the mutation.
    stores.observations.append(observation('sess-base'))
    service.observeCompletion({ workspaceId: WS, sessionId: 'sess-base', reason: 'complete' })
    expect(service.getOutcome(WS, 'out_sess-base')!.status).toBe('success')

    // Mutation applied after the baseline observation.
    clockMs = NOW + 60_000
    stores.candidates.save(activeCandidate('cand-drop'))
    stores.mutations.save(mutation('cand-drop', new Date(clockMs).toISOString()))

    // A real failure outcome recorded through observeCompletion after the mutation.
    clockMs = NOW + 120_000
    stores.observations.append(observation('sess-fail'))
    service.observeCompletion({ workspaceId: WS, sessionId: 'sess-fail', reason: 'error' })
    expect(service.getOutcome(WS, 'out_sess-fail')!.status).toBe('failure')
    expect(stores.candidates.get('cand-drop')!.status).toBe('active')

    const result = await service.evaluateOutcomes(WS)

    expect(result.rolledBack).toEqual(['cand-drop'])
    expect(stores.candidates.get('cand-drop')!.status).toBe('rolled_back')
    expect(stores.mutations.get('mut-cand-drop')!.status).toBe('reverted')
  })
})