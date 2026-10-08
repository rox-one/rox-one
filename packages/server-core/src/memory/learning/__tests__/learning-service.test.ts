/**
 * LearningService tests (WP-108c): distillation seam (PRD §45) + RPC candidate
 * lifecycle (§15/§34/§35/§39/§40). Only PORTS are faked (targets recorder,
 * skills-learning policy); every store is the real JSONL class over a temp
 * workspace, so persistence, idempotency and cross-instance determinism run for real.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { createHash } from 'crypto'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { LearningCandidate, LearningMutation, LearningPolicy, SkillsLearningPolicy } from '@rox/shared/memory/learning'
import { DEFAULT_LEARNING_THRESHOLDS, DEFAULT_SKILLS_LEARNING_POLICY, candidateFingerprint } from '@rox/shared/memory/learning'
import type { LearningTargetStores, ValidatorPorts } from '../learning-types'
import { learningDirFor } from '../learning-types'
import { CandidateStore } from '../CandidateStore'
import { EvidenceStore } from '../EvidenceStore'
import { ExperimentStore } from '../ExperimentStore'
import { LearningService } from '../LearningService'
import type { LearningServiceStores } from '../LearningService'
import { MutationStore } from '../MutationStore'
import { ObservationStore } from '../ObservationStore'
import { OutcomeStore } from '../OutcomeStore'
import { PolicyStore } from '../PolicyStore'

const NOW = Date.parse('2026-10-08T00:00:00.000Z')
const NOW_ISO = new Date(NOW).toISOString()
const WS = 'ws-1'
const SESSION = 'sess-1'
const RULE = 'Always review the diff before committing'

const sha256Hex = (text: string): string => createHash('sha256').update(text).digest('hex')
/** Mirrors LearningService.evidenceRow's deterministic id (PRD §34). */
const evidenceIdFor = (type: string, ref: string): string => `ev_${sha256Hex(`${type}\u0000${ref}`)}`
const policyOf = (over: Partial<SkillsLearningPolicy> = {}): SkillsLearningPolicy => ({ ...DEFAULT_SKILLS_LEARNING_POLICY, ...over })
/** Autonomous promotion thresholds a single user-correction may clear. */
const LOW_THRESHOLDS = { ...DEFAULT_LEARNING_THRESHOLDS, lessonMinEvidence: 1, lessonMinConfidence: 0 }

const tmpDirs: string[] = []
beforeEach(() => {
  tmpDirs.push(mkdtempSync(join(tmpdir(), 'learning-service-')))
})
afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Port fakes (the only permitted fakes) + real-store rig
// ---------------------------------------------------------------------------

interface TargetCallLog {
  addLesson: Array<Parameters<LearningTargetStores['addLesson']>[0]>
  removeLesson: Array<{ rule: string; scope: 'global' | 'workspace' }>
  enqueueSkill: Array<Parameters<LearningTargetStores['enqueueSkill']>[0]>
  removeQueuedSkill: string[]
  savePolicy: LearningPolicy[]
  removePolicy: string[]
}

function makeTargets(): { targets: LearningTargetStores; calls: TargetCallLog } {
  const calls: TargetCallLog = { addLesson: [], removeLesson: [], enqueueSkill: [], removeQueuedSkill: [], savePolicy: [], removePolicy: [] }
  const targets: LearningTargetStores = {
    addLesson: (input) => { calls.addLesson.push(input) },
    removeLesson: (rule, scope) => { calls.removeLesson.push({ rule, scope }); return true },
    enqueueSkill: (input) => { calls.enqueueSkill.push(input); return true },
    removeQueuedSkill: (slug) => { calls.removeQueuedSkill.push(slug); return true },
    readQueuedSkill: () => null,
    savePolicy: (policy) => { calls.savePolicy.push(policy) },
    removePolicy: (id) => { calls.removePolicy.push(id); return true },
  }
  return { targets, calls }
}

/** Real store family over one temp workspace (never mocked). */
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

function makeService(root: string, policy: SkillsLearningPolicy, stores: LearningServiceStores, targets: LearningTargetStores, thresholds = DEFAULT_LEARNING_THRESHOLDS): LearningService {
  const validatorPorts: ValidatorPorts = {
    listExistingRules: () => [],
    readRepositorySignals: () => [],
    listOutcomesByFingerprint: () => [],
    readSkillsLearningPolicy: () => policy,
    thresholds: DEFAULT_LEARNING_THRESHOLDS,
  }
  return new LearningService({ workspaceRoot: root, workspaceId: WS, clock: () => NOW, stores, targets, validatorPorts, thresholds })
}

interface Rig {
  root: string
  service: LearningService
  stores: LearningServiceStores
  targets: LearningTargetStores
  calls: TargetCallLog
}

function makeRig(over: { policy?: SkillsLearningPolicy; thresholds?: typeof DEFAULT_LEARNING_THRESHOLDS } = {}): Rig {
  const root = tmpDirs[tmpDirs.length - 1]!
  const stores = storesFor(root)
  const { targets, calls } = makeTargets()
  return { root, stores, targets, calls, service: makeService(root, over.policy ?? policyOf(), stores, targets, over.thresholds) }
}

type IngestInput = Parameters<LearningService['ingestDistilled']>[0]

const lessonInput = (over: Partial<IngestInput> = {}): IngestInput => ({
  workspaceId: WS, sessionId: SESSION, kind: 'lesson', rule: RULE, category: 'workflow', negative: true, ...over,
})
const skillInput = (over: Partial<IngestInput> = {}): IngestInput => ({
  workspaceId: WS, sessionId: SESSION, kind: 'skill',
  skill: { slug: 'review-diff', description: 'Review the diff first', body: 'Step 1: read the diff.' }, ...over,
})
const SKILL_PAYLOAD = { slug: 'review-diff', description: 'Review the diff first', body: 'Step 1: read the diff.' }

function makeCandidateRow(over: Partial<LearningCandidate> = {}): LearningCandidate {
  return {
    id: 'cand_seed_1',
    fingerprint: 'f'.repeat(64),
    type: 'skill',
    scope: 'workspace',
    hypothesis: 'seeded',
    payload: { slug: 'review-diff', description: 'Review the diff first', body: 'body' },
    evidence: [],
    confidence: 0.9,
    confidenceComponents: { recurrence: 0.9, evidenceQuality: 0.9, userSignal: 0.9, repositorySupport: 0.9, outcomeSupport: 0.9, consistency: 0.9 },
    status: 'active',
    validation: { passes: [], promotable: true, checkedAt: NOW_ISO },
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
    ...over,
  }
}

function makeMutationRow(over: Partial<LearningMutation> = {}): LearningMutation {
  return {
    id: 'mut_skill_1',
    candidateId: 'cand_seed_1',
    targetType: 'skill',
    targetId: 'review-diff',
    before: null,
    after: { slug: 'review-diff', description: 'Review the diff first' },
    rollbackAvailable: true,
    status: 'applied',
    ts: NOW_ISO,
    ...over,
  }
}

// ---------------------------------------------------------------------------
// ingestDistilled — policy modes (PRD §42/§45)
// ---------------------------------------------------------------------------

describe('LearningService.ingestDistilled', () => {
  it("treats autoCreate 'off' as unhandled so the caller keeps its legacy write path", async () => {
    const rig = makeRig({ policy: policyOf({ autoCreate: 'off' }) })

    const result = await rig.service.ingestDistilled(lessonInput())

    expect(result).toEqual({ handled: false, promoted: false, reason: 'learning disabled' })
    expect(rig.stores.candidates.list()).toHaveLength(0)
    expect(rig.stores.evidence.list()).toHaveLength(0)
  })

  it('treats a disabled policy as unhandled', async () => {
    const rig = makeRig({ policy: policyOf({ enabled: false }) })
    const result = await rig.service.ingestDistilled(skillInput())
    expect(result.handled).toBe(false)
    expect(result.reason).toBe('learning disabled')
  })

  it("stops at 'awaiting review' for a lesson under autoCreate 'candidate'", async () => {
    const rig = makeRig({ policy: policyOf({ autoCreate: 'candidate' }) })

    const result = await rig.service.ingestDistilled(lessonInput())

    expect(result.handled).toBe(true)
    expect(result.promoted).toBe(false)
    expect(result.reason).toBe('awaiting review')
    expect(result.candidateId).toBeDefined()
    const stored = rig.stores.candidates.get(result.candidateId!)!
    expect(stored.status).toBe('candidate')
    expect(stored.scope).toBe('workspace')
    expect(rig.calls.addLesson).toHaveLength(0)
  })

  it("keeps a skill payload intact under autoImprove 'candidate'", async () => {
    const rig = makeRig({ policy: policyOf({ autoImprove: 'candidate' }) })

    const result = await rig.service.ingestDistilled(skillInput({ skill: { ...SKILL_PAYLOAD, supersedes: 'old-diff' } }))

    expect(result).toEqual({ handled: true, promoted: false, candidateId: result.candidateId!, reason: 'awaiting review' })
    const stored = rig.stores.candidates.get(result.candidateId!)!
    expect(stored.type).toBe('skill')
    expect(stored.payload).toEqual({ ...SKILL_PAYLOAD, supersedes: 'old-diff' })
    expect(rig.calls.enqueueSkill).toHaveLength(0)
  })

  it('refuses autonomous promotion when the deterministic thresholds are not met', async () => {
    const rig = makeRig({ policy: policyOf({ autoCreate: 'autonomous' }) })

    const result = await rig.service.ingestDistilled(lessonInput())

    expect(result).toEqual({ handled: true, promoted: false, candidateId: result.candidateId!, reason: 'not promotable' })
    expect(rig.calls.addLesson).toHaveLength(0)
    const stored = rig.stores.candidates.get(result.candidateId!)!
    expect(stored.validation.passes).toHaveLength(8)
    expect(stored.validation.promotable).toBe(false)
  })

  it('promotes an autonomous lesson meeting the thresholds and writes the exact payload', async () => {
    const rig = makeRig({ policy: policyOf({ autoCreate: 'autonomous' }), thresholds: LOW_THRESHOLDS })

    const result = await rig.service.ingestDistilled(lessonInput())

    expect(result.handled).toBe(true)
    expect(result.promoted).toBe(true)
    expect(result.reason).toBeUndefined()
    expect(rig.calls.addLesson).toEqual([{ rule: RULE, category: 'workflow', scope: 'workspace', trigger: 'distillation', negative: true }])
    const stored = rig.stores.candidates.get(result.candidateId!)!
    expect(stored.status).toBe('active')
    const mutations = rig.stores.mutations.listByCandidate(stored.id)
    expect(mutations).toHaveLength(1)
    expect(mutations[0]!.targetType).toBe('lesson')
    expect(mutations[0]!.targetId).toBe(RULE)
    expect(mutations[0]!.status).toBe('applied')
    expect(mutations[0]!.rollbackAvailable).toBe(true)
  })

  it('never autonomously queues a skill from ingest evidence (real behavior)', async () => {
    const rig = makeRig({ policy: policyOf({ autoCreate: 'autonomous' }), thresholds: LOW_THRESHOLDS })

    const result = await rig.service.ingestDistilled(skillInput())

    expect(result).toEqual({ handled: true, promoted: false, candidateId: result.candidateId!, reason: 'not promotable' })
    expect(rig.calls.enqueueSkill).toHaveLength(0)
    const stored = rig.stores.candidates.get(result.candidateId!)!
    expect(stored.validation.passes.find((pass) => pass.pass === 'outcome_evidence')!.ok).toBe(false)
    // The skill draft itself is preserved verbatim on the candidate.
    expect(stored.payload).toEqual(SKILL_PAYLOAD)
  })

  it('reuses one candidate for a repeated identical ingest (idempotency, PRD §34)', async () => {
    const rig = makeRig({ policy: policyOf({ autoCreate: 'candidate' }) })

    const first = await rig.service.ingestDistilled(lessonInput())
    const second = await rig.service.ingestDistilled(lessonInput())

    expect(second.candidateId).toBe(first.candidateId!)
    expect(rig.stores.candidates.list()).toHaveLength(1)
    expect(rig.stores.evidence.list()).toHaveLength(1)
    const stored = rig.stores.candidates.get(first.candidateId!)!
    expect(stored.evidence.map((ref) => ref.evidenceId)).toEqual([evidenceIdFor('user_correction', SESSION)])
    const expected = candidateFingerprint(
      { type: 'lesson', hypothesis: RULE, scope: 'workspace', evidenceIds: [evidenceIdFor('user_correction', SESSION)] },
      sha256Hex,
    )
    expect(stored.fingerprint).toBe(expected)
  })

  it('mints evidence ids deterministically across service instances over the same dir', async () => {
    const rig = makeRig({ policy: policyOf({ autoCreate: 'candidate' }) })
    const second = makeService(rig.root, policyOf({ autoCreate: 'candidate' }), storesFor(rig.root), makeTargets().targets)

    const a = await rig.service.ingestDistilled(lessonInput())
    const b = await second.ingestDistilled(lessonInput())

    expect(b.candidateId).toBe(a.candidateId!)
    expect(rig.stores.evidence.list()[0]!.id).toBe(evidenceIdFor('user_correction', SESSION))
    expect(new EvidenceStore(rig.root).filePath).toBe(join(learningDirFor(rig.root), 'evidence.jsonl'))
    expect(rig.service.getStats(WS).candidates).toBe(1)
    expect(second.getStats(WS).candidates).toBe(1)
  })

  it('drains fire-and-forget ingest through whenIdle()', async () => {
    const rig = makeRig({ policy: policyOf({ autoCreate: 'candidate' }) })

    const pending = rig.service.ingestDistilled(lessonInput({ sessionId: 'sess-a' }))
    void rig.service.ingestDistilled(skillInput({ sessionId: 'sess-b' }))

    await rig.service.whenIdle()
    await pending

    expect(rig.stores.candidates.list()).toHaveLength(2)
    await expect(rig.service.whenIdle()).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// approve / reject (PRD §17/§39)
// ---------------------------------------------------------------------------

describe('LearningService.approveCandidate / rejectCandidate', () => {
  it('promotes an awaiting candidate to active and records one mutation', async () => {
    const rig = makeRig({ policy: policyOf({ autoCreate: 'candidate' }), thresholds: LOW_THRESHOLDS })
    const ingest = await rig.service.ingestDistilled(lessonInput())
    expect(rig.service.getCandidate(WS, ingest.candidateId!)!.status).toBe('candidate')

    const result = await rig.service.approveCandidate(WS, ingest.candidateId!)

    expect(result.promoted).toBe(true)
    expect(result.status).toBe('active')
    expect(result.mutations).toHaveLength(1)
    expect(rig.calls.addLesson).toEqual([{ rule: RULE, category: 'workflow', scope: 'workspace', trigger: 'distillation', negative: true }])
    expect(rig.service.getCandidate(WS, ingest.candidateId!)!.status).toBe('active')
    expect(rig.stores.mutations.listByCandidate(ingest.candidateId!)).toHaveLength(1)
  })

  it('keeps a rejected candidate with the supplied reason', async () => {
    const rig = makeRig({ policy: policyOf({ autoCreate: 'candidate' }) })
    const ingest = await rig.service.ingestDistilled(lessonInput())

    const rejected = rig.service.rejectCandidate(WS, ingest.candidateId!, 'not general enough')

    expect(rejected!.status).toBe('rejected')
    expect(rejected!.rejectedReason).toBe('not general enough')
    expect(rig.service.getCandidate(WS, ingest.candidateId!)!.status).toBe('rejected')
    expect(rig.calls.addLesson).toHaveLength(0)
  })

  it('answers unknown ids safely (real behavior)', async () => {
    const rig = makeRig()

    expect(await rig.service.approveCandidate(WS, 'cand_missing')).toEqual({ promoted: false, status: 'rejected', mutations: [], reason: 'unknown candidate' })
    expect(rig.service.rejectCandidate(WS, 'cand_missing', 'nope')).toBeNull()
    expect(await rig.service.rollbackCandidate(WS, 'cand_missing')).toEqual({ reverted: false, mutationIds: [], reason: 'unknown candidate' })
  })
})

// ---------------------------------------------------------------------------
// rollbackCandidate (PRD §40/§41) — through RollbackManager
// ---------------------------------------------------------------------------

describe('LearningService.rollbackCandidate', () => {
  it('removes a promoted lesson and flips the candidate to rolled_back', async () => {
    const rig = makeRig({ policy: policyOf({ autoCreate: 'candidate' }), thresholds: LOW_THRESHOLDS })
    const ingest = await rig.service.ingestDistilled(lessonInput())
    await rig.service.approveCandidate(WS, ingest.candidateId!)

    const result = await rig.service.rollbackCandidate(WS, ingest.candidateId!)

    expect(result.reverted).toBe(true)
    expect(result.mutationIds).toHaveLength(1)
    expect(rig.calls.removeLesson).toEqual([{ rule: RULE, scope: 'workspace' }])
    expect(rig.service.getCandidate(WS, ingest.candidateId!)!.status).toBe('rolled_back')
    expect(rig.stores.mutations.get(result.mutationIds[0]!)!.status).toBe('reverted')
  })

  it("refuses to rip out an already-approved skill ('skill already approved')", async () => {
    const rig = makeRig()
    rig.targets.removeQueuedSkill = (slug) => {
      rig.calls.removeQueuedSkill.push(slug)
      return false
    }
    rig.stores.candidates.save(makeCandidateRow({ id: 'cand_seed_1', status: 'active' }))
    rig.stores.mutations.save(makeMutationRow({ candidateId: 'cand_seed_1' }))

    const result = await rig.service.rollbackCandidate(WS, 'cand_seed_1')

    expect(result).toEqual({ reverted: false, mutationIds: [], reason: 'skill already approved' })
    expect(rig.calls.removeQueuedSkill).toEqual(['review-diff'])
    expect(rig.service.getCandidate(WS, 'cand_seed_1')!.status).toBe('active')
  })
})

// ---------------------------------------------------------------------------
// revalidateCandidate (PRD §37/§38)
// ---------------------------------------------------------------------------

describe('LearningService.revalidateCandidate', () => {
  it('re-stamps validation from a mutated evidence store and keeps the status', async () => {
    const rig = makeRig({ policy: policyOf({ autoCreate: 'candidate' }) })
    const ingest = await rig.service.ingestDistilled(lessonInput())
    expect(rig.stores.candidates.get(ingest.candidateId!)!.confidenceComponents.evidenceQuality).toBe(1)

    const row = rig.stores.evidence.get(evidenceIdFor('user_correction', SESSION))!
    rig.stores.evidence.save({ ...row, weight: 0.1, metadata: { ...row.metadata, edited: true } })

    const revalidated = await rig.service.revalidateCandidate(WS, ingest.candidateId!)

    expect(revalidated!.status).toBe('candidate')
    expect(revalidated!.updatedAt).toBe(NOW_ISO)
    expect(revalidated!.confidenceComponents.evidenceQuality).toBe(0.1)
    expect(revalidated!.validation.passes).toHaveLength(8)
    expect(rig.stores.candidates.get(ingest.candidateId!)!.confidenceComponents.evidenceQuality).toBe(0.1)
  })

  it('returns null for an unknown candidate id', async () => {
    const rig = makeRig()
    expect(await rig.service.revalidateCandidate(WS, 'cand_missing')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// RPC read surface: outcomes, evidence, policies (PRD §15/§19)
// ---------------------------------------------------------------------------

describe('LearningService RPC read/write surface', () => {
  it('appends outcomes idempotently by outcome id and round-trips them', () => {
    const rig = makeRig()
    const outcome = {
      id: 'out_1',
      sessionId: SESSION,
      taskFingerprint: 'fp-1',
      status: 'success' as const,
      userCorrections: 0,
      memoryUsed: [],
      skillsUsed: [],
      errors: [],
      ts: NOW_ISO,
    }

    rig.service.recordOutcome(WS, outcome)
    rig.service.recordOutcome(WS, outcome)
    rig.service.recordOutcome(WS, { ...outcome, id: 'out_2', status: 'failure' })

    expect(rig.stores.outcomes.list()).toHaveLength(2)
    expect(rig.service.getOutcome(WS, 'out_1')).toEqual({ ...outcome, workspaceId: WS })
    expect(rig.service.getOutcome(WS, 'out_2')!.status).toBe('failure')
    expect(rig.service.getOutcome(WS, 'out_missing')).toBeNull()
  })

  it('lists the evidence rows a candidate actually references', async () => {
    const rig = makeRig({ policy: policyOf({ autoCreate: 'candidate' }) })
    const ingest = await rig.service.ingestDistilled(lessonInput())

    const rows = rig.service.listEvidence(WS, ingest.candidateId!)

    expect(rows).toHaveLength(1)
    expect(rows[0]!.id).toBe(evidenceIdFor('user_correction', SESSION))
    expect(rows[0]!.type).toBe('user_correction')
    expect(rows[0]!.ref).toBe(SESSION)
    expect(rig.service.listEvidence(WS, 'cand_missing')).toEqual([])
    expect(rig.service.listEvidence(WS)).toHaveLength(1)
  })

  it('returns the PolicyStore rows from getPolicies', () => {
    const rig = makeRig()
    const policy: LearningPolicy = {
      id: 'pol_1',
      fingerprint: 'p'.repeat(64),
      taskClass: 'bugfix',
      preferredSkills: ['review-diff'],
      verification: ['bun test'],
      delegation: 'prefer',
      confidence: 0.8,
      evidence: [],
      status: 'active',
      createdAt: NOW_ISO,
      updatedAt: NOW_ISO,
    }
    rig.stores.policies.save(policy)

    expect(rig.service.getPolicies(WS)).toEqual([policy])
  })
})