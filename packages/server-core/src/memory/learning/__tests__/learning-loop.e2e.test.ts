/**
 * Continual-learning end-to-end loop (PRD §46 Definition of Done, WP-114).
 *
 * One workspace, real durable stores, real target stores (`LessonStore` +
 * `SkillPendingQueue` + `PolicyStore` via `createWorkspaceTargetStores`), a
 * monotonic clock and a deterministic distiller port stub — no engine mocks and
 * no model calls. The single test walks the twelve PRD steps in order:
 *
 *   1  task activity (tool outcomes)         7  candidate promoted ACTIVE
 *   2  user correction                       8  later sessions use the memory
 *   3  structured observation row            9  outcome measured
 *   4  reflection hypothesis + evidence     10  effectiveness improves
 *   5  repeat session confirms pattern      11  regression → automatic rollback
 *   6  candidate carries evidence           12  timeline shows the causal chain
 *
 * Deterministic validation is exercised in both directions (§37/§38): one
 * promotable rule and one weak rule that must be rejected (`outcome_evidence`
 * fails) and refused by `approveCandidate`.
 */
import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { DEFAULT_LEARNING_THRESHOLDS, DEFAULT_SKILLS_LEARNING_POLICY } from '@rox/shared/memory/learning'
import { LearningService, type LearningServiceLogger, type LearningServiceStores } from '../LearningService'
import { createWorkspaceTargetStores } from '../LearningHost'
import type { LearningTargetStores, ValidatorPorts } from '../learning-types'
import { ObservationStore } from '../ObservationStore'
import { CandidateStore } from '../CandidateStore'
import { EvidenceStore } from '../EvidenceStore'
import { OutcomeStore } from '../OutcomeStore'
import { MutationStore } from '../MutationStore'
import { ExperimentStore } from '../ExperimentStore'
import { PolicyStore } from '../PolicyStore'
import { LearningAudit } from '../LearningAudit'
import { LessonStore } from '../../LessonStore'
import { SkillPendingQueue } from '../../SkillPendingQueue'

const NOW = Date.parse('2026-10-08T00:00:00.000Z')
const WORKSPACE = 'ws-e2e'
const SILENT: LearningServiceLogger = { warn: () => {} }

/** Promotable: a strong user-correction-backed rule that also names a repo signal. */
const STRONG_RULE = 'Always run bun test before claiming a change is done'
/** Weak: a single session observation with no user correction cannot promote a lesson. */
const WEAK_RULE = 'Prefer dark mode in code reviews'

/** The exact `ValidationPassId` order the validator runs (PRD §37). */
const PASS_IDS = [
  'duplicate',
  'contradiction',
  'scope',
  'sensitive',
  'evidence_count',
  'repository_evidence',
  'outcome_evidence',
  'consistency',
] as const

const HYPOTHESES_REPLY = JSON.stringify({
  hypotheses: [
    {
      type: 'lesson',
      scope: 'workspace',
      hypothesis: STRONG_RULE,
      category: 'workflow',
      payload: { rule: STRONG_RULE, category: 'workflow' },
      evidenceRefs: [{ type: 'user_correction', ref: 'corr-1', weight: 1 }],
    },
    {
      type: 'lesson',
      scope: 'workspace',
      hypothesis: WEAK_RULE,
      evidenceRefs: [{ type: 'session', ref: 'sess-weak', weight: 0.3 }],
    },
  ],
  rejectedHypotheses: [],
})

interface Rig {
  service: LearningService
  stores: LearningServiceStores
  targets: LearningTargetStores
  lessons: Record<'global' | 'workspace', LessonStore>
  skills: SkillPendingQueue
  /** Monotonic ISO timestamp from the shared clock (strictly increasing). */
  nowIso: () => string
}

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'learning-loop-e2e-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function makeRig(): Rig {
  let tick = 0
  const clock = (): number => NOW + (tick += 60_000)
  const nowIso = (): string => new Date(clock()).toISOString()
  const stores: LearningServiceStores = {
    observations: new ObservationStore(root),
    candidates: new CandidateStore(root),
    evidence: new EvidenceStore(root),
    outcomes: new OutcomeStore(root),
    mutations: new MutationStore(root),
    experiments: new ExperimentStore(root),
    policies: new PolicyStore(root),
  }
  // Real durable target stores: promotions must land in the same lessons.jsonl /
  // skills/.pending the prompt assembler reads, not in a recorder.
  const { targets, lessons, skills } = createWorkspaceTargetStores(root, stores.policies, clock)
  const validatorPorts: ValidatorPorts = {
    listExistingRules: () => [],
    readRepositorySignals: () => ['bun', 'typescript'],
    listOutcomesByFingerprint: () => [],
    readSkillsLearningPolicy: () => ({ ...DEFAULT_SKILLS_LEARNING_POLICY }),
    thresholds: { ...DEFAULT_LEARNING_THRESHOLDS },
  }
  const service = new LearningService({
    workspaceRoot: root,
    workspaceId: WORKSPACE,
    clock,
    logger: SILENT,
    distiller: async () => HYPOTHESES_REPLY,
    audit: new LearningAudit(root),
    // One strong correction clears the evidence bar; confidence threshold 0 so
    // the walk tests the wiring, not the default 0.7 tuning.
    thresholds: { ...DEFAULT_LEARNING_THRESHOLDS, lessonMinEvidence: 1, lessonMinConfidence: 0 },
    stores,
    targets,
    validatorPorts,
  })
  return { service, stores, targets, lessons, skills, nowIso }
}

function readAuditEntries(): Array<{ action: string; target: string; detail?: string }> {
  const raw = readFileSync(join(root, 'memory', 'learning', 'learning-audit.jsonl'), 'utf8')
  return raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as { action: string; target: string; detail?: string })
}

describe('continual-learning loop (PRD §46 DoD)', () => {
  it('observes → reflects → validates → promotes → measures → rolls back → narrates', async () => {
    const rig = makeRig()
    const { service, stores, lessons } = rig

    // ── Steps 1–3: activity, correction, structured observation ──────────────
    service.recordToolOutcome({
      workspaceId: WORKSPACE, sessionId: 'session-1', tool: 'bash', ok: true, ts: rig.nowIso(),
    })
    service.recordToolOutcome({
      workspaceId: WORKSPACE, sessionId: 'session-1', tool: 'edit', ok: true, ts: rig.nowIso(),
    })
    service.recordCorrection({
      id: 'corr-1', sessionId: 'session-1', original: 'used npm test', corrected: 'use bun test',
      category: 'workflow', confidence: 0.9, ts: rig.nowIso(),
    })
    service.observeCompletion({ workspaceId: WORKSPACE, sessionId: 'session-1', reason: 'complete' })

    const observation = stores.observations.listBySession('session-1').at(-1)!
    expect(observation.execution.tools).toEqual(['bash', 'edit'])
    expect(observation.signals.userCorrections.map((c) => c.id)).toEqual(['corr-1'])
    expect(observation.outcome.status).toBe('success')

    // The terminal session also produced its TaskOutcome row (real producer).
    const session1Outcome = stores.outcomes.get('out_session-1')!
    expect(session1Outcome.status).toBe('success')
    expect(session1Outcome.userCorrections).toBe(1)
    expect(session1Outcome.workspaceId).toBe(WORKSPACE)

    // ── Step 4: reflection turns the correction into hypotheses + evidence ────
    const { candidates } = await service.reflectSession(WORKSPACE, 'session-1')
    expect(candidates).toHaveLength(2)
    const strong = candidates.find((c) => c.hypothesis === STRONG_RULE)!
    const weak = candidates.find((c) => c.hypothesis === WEAK_RULE)!
    expect(strong).toBeDefined()
    expect(weak).toBeDefined()

    // Deterministic validation: all eight passes ran, in order, and passed.
    expect(strong.validation.passes.map((p) => p.pass)).toEqual([...PASS_IDS])
    expect(strong.validation.passes.every((p) => p.ok)).toBe(true)
    expect(strong.validation.promotable).toBe(true)
    expect(strong.validation.passes.find((p) => p.pass === 'repository_evidence')?.detail).toContain('bun')

    // ── Step 6: the candidate carries concrete evidence ───────────────────────
    const strongEvidence = service.listEvidence(WORKSPACE, strong.id)
    expect(strongEvidence).toHaveLength(1)
    expect(strongEvidence[0]!.type).toBe('user_correction')
    expect(strongEvidence[0]!.ref).toBe('corr-1')
    expect(strongEvidence[0]!.metadata?.sessionId).toBe('session-1')

    // Negative direction (§37/§38): the weak rule is NOT promotable.
    expect(weak.validation.promotable).toBe(false)
    const outcomePass = weak.validation.passes.find((p) => p.pass === 'outcome_evidence')!
    expect(outcomePass.ok).toBe(false)
    expect(outcomePass.detail).toContain('user_correction')
    await expect(service.approveCandidate(WORKSPACE, weak.id)).resolves.toMatchObject({
      promoted: false, reason: 'not validated',
    })
    expect(service.rejectCandidate(WORKSPACE, weak.id, 'insufficient evidence')?.status).toBe('rejected')

    // ── Step 5: a repeat session confirms the same pattern (no new candidate) ─
    service.recordCorrection({
      id: 'corr-1', sessionId: 'session-2', original: 'used npm test', corrected: 'use bun test',
      category: 'workflow', confidence: 0.9, ts: rig.nowIso(),
    })
    service.observeCompletion({ workspaceId: WORKSPACE, sessionId: 'session-2', reason: 'complete' })
    const recurrence = (await service.reflectSession(WORKSPACE, 'session-2')).candidates
      .find((c) => c.hypothesis === STRONG_RULE)!
    expect(recurrence.id).toBe(strong.id)
    expect(service.listCandidates(WORKSPACE)).toHaveLength(2)

    // Baseline for the before/after mutation split (evaluateOutcomes §40).
    service.observeCompletion({ workspaceId: WORKSPACE, sessionId: 'base-1', reason: 'complete' })
    service.observeCompletion({ workspaceId: WORKSPACE, sessionId: 'base-2', reason: 'error' })

    // ── Step 7: promotion writes a durable lesson and an applied mutation ─────
    const promotion = await service.approveCandidate(WORKSPACE, strong.id)
    expect(promotion.promoted).toBe(true)
    expect(promotion.mutations).toHaveLength(1)
    const mutation = promotion.mutations[0]!
    expect(mutation.status).toBe('applied')
    expect(mutation.targetType).toBe('lesson')
    expect(mutation.rollbackAvailable).toBe(true)
    expect(service.getCandidate(WORKSPACE, strong.id)?.status).toBe('active')
    expect(lessons.workspace.list().map((l) => l.rule)).toContain(STRONG_RULE)

    // Baseline = successes strictly before the mutation timestamp.
    const beforeMutation = stores.outcomes.list().filter((o) => o.ts < mutation.ts)
    const baselineSuccess = beforeMutation.filter((o) => o.status === 'success').length / beforeMutation.length
    expect(baselineSuccess).toBeCloseTo(0.75)

    // ── Step 8: later sessions use the newly promoted memory ─────────────────
    service.recordContextUsage({
      workspaceId: WORKSPACE, sessionId: 'post-1', lessons: [{ rule: STRONG_RULE, scope: 'workspace' }], skills: [],
    })
    service.recordToolOutcome({
      workspaceId: WORKSPACE, sessionId: 'post-1', tool: 'bash', ok: true, ts: rig.nowIso(),
    })
    service.observeCompletion({ workspaceId: WORKSPACE, sessionId: 'post-1', reason: 'complete' })
    service.observeCompletion({ workspaceId: WORKSPACE, sessionId: 'post-2', reason: 'complete' })

    const postObservation = stores.observations.listBySession('post-1').at(-1)!
    expect(postObservation.memory.lessonsInjected.map((l) => l.rule)).toContain(STRONG_RULE)
    expect(stores.outcomes.get('out_post-1')!.memoryUsed).toContain(STRONG_RULE)

    // ── Steps 9–10: outcomes measured; effectiveness improves ────────────────
    const improved = service.getSkillEffectiveness(WORKSPACE, STRONG_RULE)!
    expect(improved.sampleSize).toBeGreaterThan(0)
    // 6 outcomes so far (session-1/2, base-1/2, post-1/2): 5 successes, 1 failure.
    expect(improved.components.successRate).toBeCloseTo(5 / 6)
    expect(improved.components.successRate).toBeGreaterThan(baselineSuccess)
    // No regression yet — the evaluator leaves the candidate active.
    expect((await service.evaluateOutcomes(WORKSPACE)).rolledBack).toEqual([])
    expect(service.getCandidate(WORKSPACE, strong.id)?.status).toBe('active')

    // ── Step 11: a regression drops success below baseline → auto-rollback ────
    service.recordCorrection({
      id: 'corr-reg', sessionId: 'reg-1', original: 'shipped with a failing build',
      corrected: 'fix the build before finishing', category: 'workflow', confidence: 0.8, ts: rig.nowIso(),
    })
    for (const sessionId of ['reg-1', 'reg-2', 'reg-3']) {
      service.recordToolOutcome({
        workspaceId: WORKSPACE, sessionId, tool: 'bash', ok: false, error: 'build failed', ts: rig.nowIso(),
      })
      service.observeCompletion({ workspaceId: WORKSPACE, sessionId, reason: 'error' })
    }

    const evidenceBeforeRollback = service.listEvidence(WORKSPACE, strong.id)
    const regression = service.getSkillEffectiveness(WORKSPACE, STRONG_RULE)!
    expect(regression.components.successRate).toBeLessThan(baselineSuccess)

    const { rolledBack } = await service.evaluateOutcomes(WORKSPACE)
    expect(rolledBack).toContain(strong.id)
    const reverted = stores.mutations.list().find((m) => m.id === mutation.id)!
    expect(reverted.status).toBe('reverted')
    expect(reverted.reason).toContain('success rate dropped')
    expect(service.getCandidate(WORKSPACE, strong.id)?.status).toBe('rolled_back')
    // Durable target change was undone.
    expect(lessons.workspace.list().map((l) => l.rule)).not.toContain(STRONG_RULE)

    // Audit trail contains the promote and the rollback (§34).
    const audit = readAuditEntries()
    expect(audit.some((e) => e.action === 'promote')).toBe(true)
    const rollbackEntry = audit.find((e) => e.action === 'rollback')!
    expect(rollbackEntry.target).toBe(STRONG_RULE)
    expect(rollbackEntry.detail).toContain(mutation.id)

    // PRD §40/§41: the rollback leaves failure evidence behind — one
    // deterministic 'failed_outcome' row, attached to the owning candidate.
    const rollbackEvidence = service.listEvidence(WORKSPACE, strong.id)
    expect(rollbackEvidence).toHaveLength(evidenceBeforeRollback.length + 1)
    const failureRow = rollbackEvidence.find((row) => row.type === 'failed_outcome')!
    expect(failureRow).toBeDefined()
    expect(failureRow.ref).toBe(mutation.id)
    expect(service.getCandidate(WORKSPACE, strong.id)?.evidence.some((ref) => ref.evidenceId === failureRow.id)).toBe(true)

    // ── Step 12: the timeline narrates the causal chain ──────────────────────
    const timeline = service.getTimeline(WORKSPACE)
    const kinds = timeline.map((e) => e.kind)
    for (const kind of ['observation', 'candidate', 'mutation', 'outcome', 'rollback'] as const) {
      expect(kinds).toContain(kind)
    }
    const timestamps = (kind: string): string => timeline.find((e) => e.kind === kind)!.ts
    expect(timestamps('candidate') <= timestamps('mutation')).toBe(true)
    expect(timestamps('mutation') <= timestamps('rollback')).toBe(true)
    const observationEntry = timeline.find((e) => e.kind === 'observation' && e.sessionId === 'session-1')!
    expect(observationEntry.ts < timestamps('candidate')).toBe(true)

    const stats = service.getStats(WORKSPACE)
    expect(stats.mutations).toBe(1)
    expect(stats.revertedMutations).toBe(1)
    expect(stats.rejectedCandidates).toBe(1)
    expect(stats.activeCandidates).toBe(0)
    expect(stats.outcomes).toBe(stores.outcomes.list().length)
  })
})