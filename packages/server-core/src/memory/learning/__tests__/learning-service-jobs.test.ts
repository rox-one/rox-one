/**
 * LearningService job/path tests (PRD §8/§10–§14/§36/§40/§15).
 *
 * Real store classes against a temp workspace; only the frozen ports are
 * in-memory fakes (LearningTargetStores recorder, distiller/judge stubs,
 * readSkillsLearningPolicy stub). Fixed clock, deterministic ids, no sleeps.
 */
import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { LearningMutation, LearningObservation, TaskOutcome, TaskOutcomeStatus, UserCorrection } from '@rox/shared/memory/learning'
import { DEFAULT_LEARNING_THRESHOLDS, DEFAULT_SKILLS_LEARNING_POLICY } from '@rox/shared/memory/learning'
import { LearningService, type LearningServiceDeps, type LearningServiceLogger, type LearningServiceStores } from '../LearningService'
import type { LearningTargetStores, ValidatorPorts } from '../learning-types'
import { ObservationStore } from '../ObservationStore'
import { CandidateStore } from '../CandidateStore'
import { EvidenceStore } from '../EvidenceStore'
import { OutcomeStore } from '../OutcomeStore'
import { MutationStore } from '../MutationStore'
import { ExperimentStore } from '../ExperimentStore'
import { PolicyStore } from '../PolicyStore'
import { LearningAudit } from '../LearningAudit'

const NOW = Date.parse('2026-10-08T00:00:00.000Z')
const iso = (offsetDays: number): string => new Date(NOW + offsetDays * 24 * 60 * 60 * 1000).toISOString()
const SILENT: LearningServiceLogger = { warn: () => {} }
const WORKSPACE = 'workspace-1'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'learning-jobs-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function makeStores(): LearningServiceStores {
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

/** Frozen target port as a recorder — nothing here is mocked beyond the port. */
interface TargetRecorder extends LearningTargetStores {
  lessons: Array<{ rule: string; scope: 'global' | 'workspace' }>
  removed: string[]
  policiesSeen: string[]
}

function makeTargets(): TargetRecorder {
  const recorder: TargetRecorder = {
    lessons: [],
    removed: [],
    policiesSeen: [],
    addLesson: (input) => void recorder.lessons.push({ rule: input.rule, scope: input.scope }),
    removeLesson: (rule) => (recorder.removed.push(rule), true),
    enqueueSkill: () => true,
    removeQueuedSkill: () => true,
    readQueuedSkill: () => null,
    savePolicy: (policy) => void recorder.policiesSeen.push(policy.id),
    removePolicy: (id) => (recorder.removed.push(id), true),
  }
  return recorder
}

function makeValidatorPorts(): ValidatorPorts {
  return {
    listExistingRules: () => [],
    readRepositorySignals: () => [],
    listOutcomesByFingerprint: () => [],
    readSkillsLearningPolicy: () => ({ ...DEFAULT_SKILLS_LEARNING_POLICY }),
    thresholds: { ...DEFAULT_LEARNING_THRESHOLDS },
  }
}

function makeService(overrides: Partial<LearningServiceDeps> & { stores?: LearningServiceStores } = {}): {
  service: LearningService
  stores: LearningServiceStores
  targets: TargetRecorder
} {
  const stores = overrides.stores ?? makeStores()
  const targets = makeTargets()
  const service = new LearningService({
    workspaceRoot: root,
    workspaceId: WORKSPACE,
    clock: () => NOW,
    logger: SILENT,
    audit: new LearningAudit(root),
    stores,
    targets,
    validatorPorts: makeValidatorPorts(),
    ...overrides,
  })
  return { service, stores, targets }
}

function mkOutcome(over: Partial<TaskOutcome> & Pick<TaskOutcome, 'id' | 'ts' | 'status'>): TaskOutcome {
  return { sessionId: over.sessionId ?? `sess-${over.id}`, taskFingerprint: 'fp-task', userCorrections: 0, memoryUsed: [], skillsUsed: [], errors: [], ...over }
}

function mkMutation(over: Partial<LearningMutation> & Pick<LearningMutation, 'id' | 'candidateId' | 'ts'>): LearningMutation {
  return { targetType: 'lesson', targetId: over.id, before: null, after: { rule: 'learned rule', scope: 'workspace' }, rollbackAvailable: true, status: 'applied', ...over }
}

function mkCorrection(id: string, over: Partial<UserCorrection> = {}): UserCorrection {
  return { id, sessionId: 'session-1', original: 'use npm install', corrected: 'use pnpm add', category: 'workflow', confidence: 0.9, ts: iso(0), ...over }
}

function mkObservation(id: string, sessionId: string, over: Partial<LearningObservation> = {}): LearningObservation {
  return {
    id, sessionId, workspaceId: WORKSPACE, ts: iso(0),
    execution: { tools: [], skills: [], models: [], delegated: false },
    outcome: { status: 'success' },
    signals: { userCorrections: [], errors: [], branches: 0, interruptions: 0 },
    memory: { lessonsInjected: [], episodesRecalled: [], skillsInjected: [] },
    artifacts: { filesChanged: 0 },
    ...over,
  }
}

const HYPOTHESIS_REPLY = JSON.stringify({
  hypotheses: [
    {
      type: 'lesson',
      scope: 'workspace',
      hypothesis: 'Always run bun test before claiming a change is done',
      category: 'workflow',
      payload: { rule: 'Run bun test before done' },
      evidenceRefs: [{ type: 'user_correction', ref: 'corr-1', weight: 1 }],
      confidence_estimate: 0.9,
    },
  ],
  rejectedHypotheses: [],
})

describe('LearningService event paths', () => {
  it('observeCompletion persists an observation row and maps every reason', () => {
    const { service, stores } = makeService()
    const cases: Array<[Parameters<LearningService['observeCompletion']>[0]['reason'], TaskOutcomeStatus, string | undefined]> = [
      ['complete', 'success', undefined],
      ['error', 'failure', 'error'],
      ['timeout', 'aborted', 'timeout'],
      ['interrupted', 'aborted', 'interrupted'],
      ['branch', 'partial', undefined],
    ]

    for (const [reason, status, why] of cases) {
      const sessionId = `sess-${reason}`
      service.observeCompletion({ workspaceId: WORKSPACE, sessionId, reason })
      const rows = stores.observations.listBySession(sessionId)
      expect(rows).toHaveLength(1)
      expect(rows[0]!.outcome.status).toBe(status)
      expect(rows[0]!.outcome.reason).toBe(why)
      expect(rows[0]!.signals.interruptions).toBe(reason === 'interrupted' ? 1 : 0)
      expect(rows[0]!.signals.branches).toBe(reason === 'branch' ? 1 : 0)
    }
  })

  it('recordCorrection, recordToolOutcome and recordContextUsage merge into one row', () => {
    const { service, stores } = makeService()
    const sessionId = 'session-merge'

    service.recordCorrection(mkCorrection('corr-1', { sessionId }))
    service.recordCorrection(mkCorrection('corr-1', { sessionId })) // duplicate id is not re-added
    service.recordToolOutcome({ workspaceId: WORKSPACE, sessionId, tool: 'bash', ok: false, error: 'exit 1', ts: iso(1) })
    service.recordToolOutcome({ workspaceId: WORKSPACE, sessionId, tool: 'read', ok: true, ts: iso(1) })
    service.recordContextUsage({
      workspaceId: WORKSPACE,
      sessionId,
      lessons: [{ rule: 'run tests', scope: 'workspace' }],
      skills: ['tdd'],
    })

    const rows = stores.observations.listBySession(sessionId)
    const last = rows.at(-1)!
    expect(last.signals.userCorrections).toHaveLength(1)
    expect(last.execution.tools).toEqual(['bash', 'read'])
    expect(last.signals.errors).toEqual([{ tool: 'bash', message: 'exit 1', ts: iso(1) }])
    expect(last.memory.lessonsInjected).toEqual([{ rule: 'run tests', scope: 'workspace' }])
    expect(last.memory.skillsInjected).toEqual(['tdd'])
  })
})

describe('LearningService.reflectSession', () => {
  it('creates candidates from a distiller hypothesis reply', async () => {
    const { service, stores } = makeService({ distiller: async () => HYPOTHESIS_REPLY })

    const result = await service.reflectSession(WORKSPACE, 'session-1')

    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]!.type).toBe('lesson')
    expect(result.candidates[0]!.hypothesis).toBe('Always run bun test before claiming a change is done')
    expect(stores.candidates.list()).toHaveLength(1)
  })

  it('yields no candidates and never throws without a distiller', async () => {
    const { service, stores } = makeService()

    const result = await service.reflectSession(WORKSPACE, 'session-1')

    expect(result).toEqual({ candidates: [] })
    expect(stores.candidates.list()).toHaveLength(0)
  })
})

function seedActiveCandidate(stores: LearningServiceStores, id: string): void {
  stores.candidates.save({
    id, fingerprint: `fp-${id}`, type: 'lesson', scope: 'workspace', hypothesis: 'learned rule',
    payload: { rule: 'learned rule' }, evidence: [], confidence: 0.8,
    confidenceComponents: { recurrence: 1, evidenceQuality: 1, userSignal: 1, repositorySupport: 1, outcomeSupport: 1, consistency: 1 },
    status: 'active', validation: { passes: [], promotable: true, checkedAt: iso(0) }, createdAt: iso(-2), updatedAt: iso(0),
  })
}

describe('LearningService background jobs', () => {
  it('runConsolidation turns repeated corrections into candidates', async () => {
    const { service, stores } = makeService()
    stores.observations.append(mkObservation('obs-1', 's1', {
      signals: { userCorrections: [mkCorrection('c1')], errors: [], branches: 0, interruptions: 0 },
    }))
    stores.observations.append(mkObservation('obs-2', 's2', {
      signals: { userCorrections: [mkCorrection('c2')], errors: [], branches: 0, interruptions: 0 },
    }))

    const result = await service.runConsolidation(WORKSPACE)
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]!.type).toBe('lesson')
    expect(stores.candidates.list()).toHaveLength(1)
  })

  it('runSkillCuration reads the real workspace skill inventory', async () => {
    const { service } = makeService()
    mkdirSync(join(root, 'skills', 'tdd'), { recursive: true })
    writeFileSync(join(root, 'skills', 'tdd', 'SKILL.md'), '# TDD\n\nWrite tests first.\n')

    const result = await service.runSkillCuration(WORKSPACE)
    expect(result).toEqual({ items: [{ slug: 'tdd', action: 'keep' }] })
  })

  it('runPolicyLearning returns [] with no outcomes and learns a policy with repeated evidence', async () => {
    const empty = makeService()
    expect(await empty.service.runPolicyLearning(WORKSPACE)).toEqual({ policies: [] })

    const { service, stores } = makeService()
    for (let i = 0; i < 10; i += 1) {
      const sessionId = `s${i}`
      stores.outcomes.append(mkOutcome({ id: `out-a-${i}`, sessionId, ts: iso(0), status: 'success', taskFingerprint: 'fp-A' }))
      stores.observations.append(mkObservation(`obs-a-${i}`, sessionId, {
        execution: { tools: [], skills: [], models: [], delegated: true },
        task: { category: 'refactor' },
      }))
      stores.outcomes.append(mkOutcome({ id: `out-b-${i}`, sessionId: `t${i}`, ts: iso(0), status: 'failure', taskFingerprint: 'fp-B' }))
    }

    const result = await service.runPolicyLearning(WORKSPACE)
    expect(result.policies).toHaveLength(1)
    expect(result.policies[0]!.taskClass).toBe('refactor')
    expect(result.policies[0]!.status).toBe('candidate')
    expect(stores.candidates.listByStatus('candidate').some((candidate) => candidate.type === 'policy')).toBe(true)
  })

  it('runGarbageCollection returns an archived count', async () => {
    const { service } = makeService()
    expect(await service.runGarbageCollection(WORKSPACE)).toEqual({ archived: 0 })
  })
})

describe('LearningService.evaluateOutcomes', () => {
  function seed(stores: LearningServiceStores, candidateId: string): void {
    seedActiveCandidate(stores, candidateId)
    stores.mutations.save(mkMutation({ id: `mut-${candidateId}`, candidateId, ts: iso(0) }))
  }

  it('does not roll back when neither threshold is crossed', async () => {
    const { service, stores } = makeService()
    seed(stores, 'cand-ok')
    stores.outcomes.append(mkOutcome({ id: 'before-1', ts: iso(-1), status: 'success' }))
    stores.outcomes.append(mkOutcome({ id: 'before-2', ts: iso(-1), status: 'success' }))
    stores.outcomes.append(mkOutcome({ id: 'after-1', ts: iso(0), status: 'success' }))
    stores.outcomes.append(mkOutcome({ id: 'after-2', ts: iso(0), status: 'success' }))

    expect(await service.evaluateOutcomes(WORKSPACE)).toEqual({ rolledBack: [] })
    expect(stores.candidates.get('cand-ok')!.status).toBe('active')
  })

  it('rolls back when the success rate drops more than 0.1 below baseline', async () => {
    const { service, stores } = makeService()
    seed(stores, 'cand-drop')
    stores.outcomes.append(mkOutcome({ id: 'before-1', ts: iso(-1), status: 'success' }))
    stores.outcomes.append(mkOutcome({ id: 'before-2', ts: iso(-1), status: 'success' }))
    stores.outcomes.append(mkOutcome({ id: 'after-1', ts: iso(0), status: 'failure' }))
    stores.outcomes.append(mkOutcome({ id: 'after-2', ts: iso(0), status: 'failure' }))

    const result = await service.evaluateOutcomes(WORKSPACE)
    expect(result.rolledBack).toEqual(['cand-drop'])
    expect(stores.candidates.get('cand-drop')!.status).toBe('rolled_back')
    expect(stores.mutations.get('mut-cand-drop')!.status).toBe('reverted')
  })

  it('rolls back on a correction rate above 0.25 even with a stable success rate', async () => {
    const { service, stores } = makeService()
    seed(stores, 'cand-corr')
    stores.outcomes.append(mkOutcome({ id: 'before-1', ts: iso(-1), status: 'success' }))
    stores.outcomes.append(mkOutcome({ id: 'before-2', ts: iso(-1), status: 'success' }))
    for (let i = 0; i < 4; i += 1) {
      stores.outcomes.append(mkOutcome({ id: `after-${i}`, ts: iso(0), status: 'success', userCorrections: i < 2 ? 1 : 0 }))
    }

    const result = await service.evaluateOutcomes(WORKSPACE)
    expect(result.rolledBack).toEqual(['cand-corr'])
    expect(stores.mutations.get('mut-cand-corr')!.reason).toContain('correction rate')
  })
})

describe('LearningService read surface', () => {
  it('getStats counts rows from the same stores', () => {
    const { service, stores } = makeService()
    stores.observations.append(mkObservation('obs-1', 's1'))
    seedActiveCandidate(stores, 'cand-1')
    stores.mutations.save(mkMutation({ id: 'mut-1', candidateId: 'cand-1', ts: iso(0), status: 'reverted' }))
    stores.outcomes.append(mkOutcome({ id: 'out-1', ts: iso(0), status: 'success' }))

    expect(service.getStats(WORKSPACE)).toEqual({
      observations: 1, candidates: 1, activeCandidates: 1, rejectedCandidates: 0,
      outcomes: 1, mutations: 1, revertedMutations: 1, policies: 0,
    })
  })

  it('getTimeline merges every kind newest-first and links entries to their ids', () => {
    const { service, stores } = makeService()
    stores.observations.append(mkObservation('obs-1', 's1', { ts: iso(-3) }))
    seedActiveCandidate(stores, 'cand-1')
    stores.mutations.save(mkMutation({ id: 'mut-1', candidateId: 'cand-1', ts: iso(0), status: 'reverted', revertedAt: iso(1) }))
    stores.outcomes.append(mkOutcome({ id: 'out-1', ts: iso(-1), status: 'success' }))
    stores.experiments.save({
      id: 'exp-1', candidateId: 'cand-1', baseline: { behavior: 'b', metrics: {} },
      treatment: { behavior: 't', metrics: {} }, sampleSize: 5, status: 'running', createdAt: iso(-2),
    })

    const entries = service.getTimeline(WORKSPACE)
    for (const kind of ['observation', 'candidate', 'mutation', 'rollback', 'outcome', 'experiment'] as const) {
      expect(entries.some((entry) => entry.kind === kind)).toBe(true)
    }
    expect(entries.map((entry) => entry.ts)).toEqual([...entries.map((entry) => entry.ts)].sort().reverse())
    expect(entries.find((entry) => entry.kind === 'candidate')?.id).toBe('cand-1')
    expect(entries.find((entry) => entry.kind === 'mutation')?.id).toBe('mut-1')
    expect(entries.find((entry) => entry.kind === 'experiment')?.detail).toBe('cand-1')

    const limited = service.getTimeline(WORKSPACE, 2)
    expect(limited).toHaveLength(2)
    expect(limited).toEqual(entries.slice(0, 2))
  })
})