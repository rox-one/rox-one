/**
 * Rollback signal tests (PRD §40/§41): a rollback MUST leave failure evidence
 * behind, and the error-rate increase is a first-class rollback trigger.
 *
 * Rig style mirrors learning-service.test.ts: every store is the real JSONL
 * class over a temp workspace (the target stores are the only fakes), with a
 * monotonic clock so the before/after mutation windows are unambiguous.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { createHash } from 'crypto'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { LearningPolicy, SkillsLearningPolicy } from '@rox/shared/memory/learning'
import { DEFAULT_LEARNING_THRESHOLDS, DEFAULT_SKILLS_LEARNING_POLICY } from '@rox/shared/memory/learning'
import type { LearningTargetStores, ValidatorPorts } from '../learning-types'
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
const WS = 'ws-rollback'
const SESSION = 'sess-rb'
const RULE = 'Always review the diff before committing'

const sha256Hex = (text: string): string => createHash('sha256').update(text).digest('hex')
/** Mirrors LearningService.evidenceRow's deterministic id for 'failed_outcome'. */
const failedOutcomeEvidenceId = (mutationId: string): string => `ev_${sha256Hex(`failed_outcome\u0000${mutationId}`)}`
const policyOf = (over: Partial<SkillsLearningPolicy> = {}): SkillsLearningPolicy => ({ ...DEFAULT_SKILLS_LEARNING_POLICY, ...over })
/** Autonomous promotion thresholds a single user-correction may clear. */
const LOW_THRESHOLDS = { ...DEFAULT_LEARNING_THRESHOLDS, lessonMinEvidence: 1, lessonMinConfidence: 0 }

const tmpDirs: string[] = []
beforeEach(() => {
  tmpDirs.push(mkdtempSync(join(tmpdir(), 'rollback-signal-')))
})
afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true })
})

function makeTargets(): LearningTargetStores {
  return {
    addLesson: () => {},
    removeLesson: () => true,
    enqueueSkill: () => true,
    removeQueuedSkill: () => true,
    readQueuedSkill: () => null,
    savePolicy: (_policy: LearningPolicy) => {},
    removePolicy: () => true,
  }
}

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

interface Rig {
  service: LearningService
  stores: LearningServiceStores
  nowIso: () => string
}

function makeRig(): Rig {
  const root = tmpDirs[tmpDirs.length - 1]!
  let tick = 0
  const clock = (): number => NOW + (tick += 60_000)
  const nowIso = (): string => new Date(clock()).toISOString()
  const stores = storesFor(root)
  const validatorPorts: ValidatorPorts = {
    listExistingRules: () => [],
    readRepositorySignals: () => [],
    listOutcomesByFingerprint: () => [],
    readSkillsLearningPolicy: () => policyOf({ autoCreate: 'candidate' }),
    thresholds: { ...DEFAULT_LEARNING_THRESHOLDS },
  }
  const service = new LearningService({
    workspaceRoot: root,
    workspaceId: WS,
    clock,
    stores,
    targets: makeTargets(),
    validatorPorts,
    thresholds: LOW_THRESHOLDS,
  })
  return { service, stores, nowIso }
}

type IngestInput = Parameters<LearningService['ingestDistilled']>[0]

const lessonInput = (over: Partial<IngestInput> = {}): IngestInput => ({
  workspaceId: WS, sessionId: SESSION, kind: 'lesson', rule: RULE, category: 'workflow', negative: true, ...over,
})

/** Ingest a promotable lesson and approve it — one applied mutation. */
async function promote(rig: Rig): Promise<{ candidateId: string; mutationId: string }> {
  const ingest = await rig.service.ingestDistilled(lessonInput())
  const candidateId = ingest.candidateId!
  await rig.service.approveCandidate(WS, candidateId)
  const mutation = rig.stores.mutations.listByCandidate(candidateId)[0]!
  return { candidateId, mutationId: mutation.id }
}

/** Emit one 'success' outcome that still carries an error signal. */
function emitErroredSuccess(rig: Rig, sessionId: string): void {
  rig.service.recordToolOutcome({ workspaceId: WS, sessionId, tool: 'bash', ok: false, error: 'build failed', ts: rig.nowIso() })
  rig.service.observeCompletion({ workspaceId: WS, sessionId, reason: 'complete' })
}

describe('rollback failure evidence (PRD §40/§41)', () => {
  it('manual rollback writes one deterministic failed_outcome row attached to the candidate (idempotent)', async () => {
    const rig = makeRig()
    const { candidateId, mutationId } = await promote(rig)

    const result = await rig.service.rollbackCandidate(WS, candidateId)
    expect(result.reverted).toBe(true)
    expect(result.mutationIds).toEqual([mutationId])

    const failed = rig.service.listEvidence(WS, candidateId).filter((row) => row.type === 'failed_outcome')
    expect(failed).toHaveLength(1)
    expect(failed[0]!.id).toBe(failedOutcomeEvidenceId(mutationId))
    expect(failed[0]!.ref).toBe(mutationId)
    expect(failed[0]!.weight).toBe(1)
    expect(failed[0]!.metadata).toMatchObject({ candidateId, mutationId, reason: `manual rollback from ${WS}` })

    const candidate = rig.service.getCandidate(WS, candidateId)!
    expect(candidate.status).toBe('rolled_back')
    expect(candidate.evidence.some((ref) => ref.evidenceId === failed[0]!.id)).toBe(true)

    // Idempotent: RollbackManager refuses the second rollback and no row is duplicated.
    const before = rig.service.listEvidence(WS, candidateId).length
    const second = await rig.service.rollbackCandidate(WS, candidateId)
    expect(second.reverted).toBe(false)
    expect(rig.service.listEvidence(WS, candidateId)).toHaveLength(before)
    expect(rig.service.getCandidate(WS, candidateId)!.evidence.filter((ref) => ref.evidenceId === failed[0]!.id)).toHaveLength(1)
  })

  it('auto-rolls back when only the error rate rises above baseline', async () => {
    const rig = makeRig()
    const ingest = await rig.service.ingestDistilled(lessonInput())
    const candidateId = ingest.candidateId!

    // Baseline window: one clean success strictly before the mutation.
    rig.service.observeCompletion({ workspaceId: WS, sessionId: 'base-ok', reason: 'complete' })

    await rig.service.approveCandidate(WS, candidateId)
    const mutation = rig.stores.mutations.listByCandidate(candidateId)[0]!
    expect(rig.stores.mutations.get(mutation.id)!.status).toBe('applied')

    // After window: 'success' every time, yet each outcome carries an error signal —
    // successRate is flat while the error rate jumps to 1.
    for (const sessionId of ['err-1', 'err-2', 'err-3']) emitErroredSuccess(rig, sessionId)

    const beforeWindow = rig.stores.outcomes.list().filter((outcome) => outcome.ts < mutation.ts)
    const afterWindow = rig.stores.outcomes.list().filter((outcome) => outcome.ts >= mutation.ts)
    expect(beforeWindow).toHaveLength(1)
    expect(beforeWindow.every((outcome) => outcome.errors.length === 0)).toBe(true)
    expect(afterWindow).toHaveLength(3)
    expect(afterWindow.every((outcome) => outcome.status === 'success' && outcome.errors.length > 0)).toBe(true)

    const { rolledBack } = await rig.service.evaluateOutcomes(WS)
    expect(rolledBack).toContain(candidateId)

    const reverted = rig.stores.mutations.get(mutation.id)!
    expect(reverted.status).toBe('reverted')
    expect(reverted.reason).toContain('error rate')
    expect(rig.service.getCandidate(WS, candidateId)!.status).toBe('rolled_back')

    const failed = rig.service.listEvidence(WS, candidateId).filter((row) => row.type === 'failed_outcome')
    expect(failed).toHaveLength(1)
    expect(failed[0]!.ref).toBe(mutation.id)
  })

  it('does not trigger on error rate without a baseline window (guard: before.length === 0)', async () => {
    const rig = makeRig()
    const { candidateId, mutationId } = await promote(rig)

    // No outcome predates the mutation ⇒ no provable delta.
    for (const sessionId of ['err-1', 'err-2', 'err-3']) emitErroredSuccess(rig, sessionId)
    expect(rig.stores.outcomes.list().filter((outcome) => outcome.ts < rig.stores.mutations.get(mutationId)!.ts)).toHaveLength(0)

    const { rolledBack } = await rig.service.evaluateOutcomes(WS)
    expect(rolledBack).toEqual([])
    expect(rig.service.getCandidate(WS, candidateId)!.status).toBe('active')
    expect(rig.stores.mutations.get(mutationId)!.status).toBe('applied')
    expect(rig.service.listEvidence(WS, candidateId).filter((row) => row.type === 'failed_outcome')).toHaveLength(0)
  })

  it('prefers the success-rate drop in the reason when both success and error triggers fire', async () => {
    const rig = makeRig()
    const ingest = await rig.service.ingestDistilled(lessonInput())
    const candidateId = ingest.candidateId!

    rig.service.observeCompletion({ workspaceId: WS, sessionId: 'base-ok', reason: 'complete' })
    await rig.service.approveCandidate(WS, candidateId)
    const mutation = rig.stores.mutations.listByCandidate(candidateId)[0]!

    // Failures that also carry errors: both deltas exceed the threshold.
    for (const sessionId of ['reg-1', 'reg-2', 'reg-3']) {
      rig.service.recordToolOutcome({ workspaceId: WS, sessionId, tool: 'bash', ok: false, error: 'build failed', ts: rig.nowIso() })
      rig.service.observeCompletion({ workspaceId: WS, sessionId, reason: 'error' })
    }

    const { rolledBack } = await rig.service.evaluateOutcomes(WS)
    expect(rolledBack).toContain(candidateId)
    const reason = rig.stores.mutations.get(mutation.id)!.reason!
    expect(reason).toContain('success rate dropped')
    expect(reason).not.toContain('error rate')
  })
})