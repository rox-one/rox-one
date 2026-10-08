/**
 * RollbackManager tests (WP-104) — PRD §40/§41: per-target rollback, refusal to
 * pull an already-approved skill out of the pending queue, mutation/candidate
 * bookkeeping, the `rollback` audit line, and multi-mutation revertCandidate.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { LearningCandidate, LearningMutation, LearningPolicy } from '@rox/shared/memory/learning'
import type { LearningTargetStores } from '../learning-types'
import { CandidateStore } from '../CandidateStore'
import { LearningAudit } from '../LearningAudit'
import { MutationStore } from '../MutationStore'
import { RollbackManager } from '../RollbackManager'

const NOW = Date.parse('2026-10-08T00:00:00.000Z')
const NOW_ISO = new Date(NOW).toISOString()
const RULE = 'run tests before committing'

let dir: string
let candidateStore: CandidateStore
let mutationStore: MutationStore
let audit: LearningAudit

const tmpDirs: string[] = []

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rollback-manager-'))
  tmpDirs.push(dir)
  candidateStore = new CandidateStore(dir)
  mutationStore = new MutationStore(dir)
  audit = new LearningAudit(dir)
})

afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true })
})

interface TargetCallLog {
  removeLesson: Array<{ rule: string; scope: 'global' | 'workspace' }>
  removeQueuedSkill: string[]
  removePolicy: string[]
  savePolicy: LearningPolicy[]
}

function makeTargets(overrides: Partial<LearningTargetStores> = {}): { targets: LearningTargetStores; calls: TargetCallLog } {
  const calls: TargetCallLog = { removeLesson: [], removeQueuedSkill: [], removePolicy: [], savePolicy: [] }
  const targets: LearningTargetStores = {
    addLesson: () => {},
    removeLesson: (rule, scope) => {
      calls.removeLesson.push({ rule, scope })
      return true
    },
    enqueueSkill: () => true,
    removeQueuedSkill: (slug) => {
      calls.removeQueuedSkill.push(slug)
      return true
    },
    readQueuedSkill: () => null,
    savePolicy: (policy) => {
      calls.savePolicy.push(policy)
    },
    removePolicy: (id) => {
      calls.removePolicy.push(id)
      return true
    },
    ...overrides,
  }
  return { targets, calls }
}

function makeManager(targets: LearningTargetStores, withCandidateStore = true): RollbackManager {
  return new RollbackManager({
    targets,
    mutationStore,
    ...(withCandidateStore ? { candidateStore } : {}),
    audit,
    clock: () => NOW,
  })
}

function makeCandidate(over: Partial<LearningCandidate> = {}): LearningCandidate {
  return {
    id: 'cand_1',
    fingerprint: 'a'.repeat(64),
    type: 'lesson',
    scope: 'workspace',
    hypothesis: RULE,
    payload: { rule: RULE },
    evidence: [],
    confidence: 0.9,
    confidenceComponents: {
      recurrence: 0.9,
      evidenceQuality: 0.9,
      userSignal: 0.9,
      repositorySupport: 0.9,
      outcomeSupport: 0.9,
      consistency: 0.9,
    },
    status: 'active',
    validation: { passes: [], promotable: true, checkedAt: NOW_ISO },
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
    ...over,
  }
}

function makeMutation(over: Partial<LearningMutation> = {}): LearningMutation {
  return {
    id: 'mut_1',
    candidateId: 'cand_1',
    targetType: 'lesson',
    targetId: RULE,
    before: null,
    after: { rule: RULE, scope: 'workspace' },
    rollbackAvailable: true,
    status: 'applied',
    ts: NOW_ISO,
    ...over,
  }
}

function auditEntries(): Array<{ ts: string; actor: string; action: string; target: string; detail?: string }> {
  try {
    return readFileSync(audit.filePath, 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line))
  } catch {
    return []
  }
}

describe('RollbackManager', () => {
  it('rolls back a lesson mutation and flips the candidate to rolled_back', () => {
    candidateStore.save(makeCandidate())
    mutationStore.save(makeMutation())
    const { targets, calls } = makeTargets()

    const result = makeManager(targets).revert('mut_1', 'lesson contradicted by later outcome')

    expect(result).toEqual({ reverted: true, mutationIds: ['mut_1'] })
    expect(calls.removeLesson).toEqual([{ rule: RULE, scope: 'workspace' }])
    const stored = mutationStore.get('mut_1')!
    expect(stored.status).toBe('reverted')
    expect(stored.revertedAt).toBe(NOW_ISO)
    expect(stored.reason).toBe('lesson contradicted by later outcome')
    expect(candidateStore.get('cand_1')!.status).toBe('rolled_back')
    const entry = auditEntries().find((row) => row.action === 'rollback')
    expect(entry?.target).toBe(RULE)
    expect(entry?.actor).toBe('learning')
    expect(entry?.detail).toContain('mut_1')
  })

  it('rolls back a global lesson with the global scope from the mutation', () => {
    mutationStore.save(makeMutation({ after: { rule: RULE, scope: 'global' } }))
    const { targets, calls } = makeTargets()

    const result = makeManager(targets, false).revert('mut_1')

    expect(result.reverted).toBe(true)
    expect(calls.removeLesson).toEqual([{ rule: RULE, scope: 'global' }])
  })

  it('rolls back a skill mutation by removing its queued entry', () => {
    candidateStore.save(makeCandidate({ id: 'cand_skill' }))
    mutationStore.save(
      makeMutation({
        id: 'mut_skill',
        candidateId: 'cand_skill',
        targetType: 'skill',
        targetId: 'release-checklist',
        after: { slug: 'release-checklist', description: 'Run the release checklist' },
      }),
    )
    const { targets, calls } = makeTargets()

    const result = makeManager(targets).revert('mut_skill')

    expect(result.reverted).toBe(true)
    expect(calls.removeQueuedSkill).toEqual(['release-checklist'])
    expect(mutationStore.get('mut_skill')!.status).toBe('reverted')
    expect(candidateStore.get('cand_skill')!.status).toBe('rolled_back')
  })

  it('refuses to roll back a skill whose queue entry was already approved', () => {
    candidateStore.save(makeCandidate({ id: 'cand_skill' }))
    mutationStore.save(
      makeMutation({ id: 'mut_skill', candidateId: 'cand_skill', targetType: 'skill', targetId: 'release-checklist' }),
    )
    const { targets } = makeTargets({ removeQueuedSkill: () => false })

    const result = makeManager(targets).revert('mut_skill')

    expect(result.reverted).toBe(false)
    expect(result.reason).toBe('skill already approved')
    expect(result.mutationIds).toEqual([])
    expect(mutationStore.get('mut_skill')!.status).toBe('applied')
    expect(candidateStore.get('cand_skill')!.status).toBe('active')
    expect(auditEntries()).toHaveLength(0)
  })

  it('rolls back a policy mutation', () => {
    candidateStore.save(makeCandidate({ id: 'cand_pol' }))
    mutationStore.save(
      makeMutation({
        id: 'mut_pol',
        candidateId: 'cand_pol',
        targetType: 'policy',
        targetId: 'pol_abc',
        after: { id: 'pol_abc', fingerprint: 'c'.repeat(64), taskClass: 'refactor' },
      }),
    )
    const { targets, calls } = makeTargets()

    const result = makeManager(targets).revert('mut_pol')

    expect(result.reverted).toBe(true)
    expect(calls.removePolicy).toEqual(['pol_abc'])
    expect(candidateStore.get('cand_pol')!.status).toBe('rolled_back')
  })

  it('refuses unknown, already reverted and non-rollbackable mutations', () => {
    mutationStore.save(makeMutation({ id: 'mut_done', status: 'reverted', revertedAt: NOW_ISO }))
    mutationStore.save(makeMutation({ id: 'mut_manual', rollbackAvailable: false }))
    const { targets, calls } = makeTargets()
    const manager = makeManager(targets)

    expect(manager.revert('missing')).toEqual({ reverted: false, mutationIds: [], reason: 'unknown mutation' })
    expect(manager.revert('mut_done').reason).toBe('already reverted')
    expect(manager.revert('mut_manual').reason).toBe('rollback unavailable')
    expect(calls.removeLesson).toHaveLength(0)
  })

  it('refuses memory targets that have no rollback implementation', () => {
    mutationStore.save(makeMutation({ id: 'mut_mem', targetType: 'memory', targetId: 'some-memory', after: null }))
    const { targets, calls } = makeTargets()

    const result = makeManager(targets).revert('mut_mem')

    expect(result).toEqual({ reverted: false, mutationIds: [], reason: 'unsupported target' })
    expect(calls.removeLesson).toHaveLength(0)
  })

  it('revertCandidate reverts every applied mutation of the candidate', () => {
    candidateStore.save(makeCandidate({ id: 'cand_multi' }))
    candidateStore.save(makeCandidate({ id: 'cand_other' }))
    mutationStore.save(makeMutation({ id: 'mut_a', candidateId: 'cand_multi' }))
    mutationStore.save(
      makeMutation({
        id: 'mut_b',
        candidateId: 'cand_multi',
        targetType: 'policy',
        targetId: 'pol_1',
        after: { id: 'pol_1', fingerprint: 'c'.repeat(64), taskClass: 'refactor' },
      }),
    )
    mutationStore.save(makeMutation({ id: 'mut_other', candidateId: 'cand_other' }))
    mutationStore.save(makeMutation({ id: 'mut_done', candidateId: 'cand_multi', status: 'reverted', revertedAt: NOW_ISO }))
    const { targets, calls } = makeTargets()

    const result = makeManager(targets).revertCandidate('cand_multi', 'effectiveness dropped')

    expect(result.reverted).toBe(true)
    expect(result.mutationIds.sort()).toEqual(['mut_a', 'mut_b'])
    expect(result.reason).toBeUndefined()
    expect(mutationStore.get('mut_a')!.status).toBe('reverted')
    expect(mutationStore.get('mut_b')!.status).toBe('reverted')
    expect(mutationStore.get('mut_other')!.status).toBe('applied')
    expect(calls.removeLesson).toEqual([{ rule: RULE, scope: 'workspace' }])
    expect(calls.removePolicy).toEqual(['pol_1'])
    expect(candidateStore.get('cand_multi')!.status).toBe('rolled_back')
    expect(candidateStore.get('cand_other')!.status).toBe('active')
  })

  it('revertCandidate keeps going and reports the first refusal on partial failure', () => {
    candidateStore.save(makeCandidate({ id: 'cand_multi' }))
    mutationStore.save(makeMutation({ id: 'mut_a', candidateId: 'cand_multi' }))
    mutationStore.save(
      makeMutation({ id: 'mut_b', candidateId: 'cand_multi', targetType: 'skill', targetId: 'release-checklist' }),
    )
    const { targets, calls } = makeTargets({ removeQueuedSkill: () => false })

    const result = makeManager(targets).revertCandidate('cand_multi')

    expect(result.reverted).toBe(true)
    expect(result.mutationIds).toEqual(['mut_a'])
    expect(result.reason).toBe('skill already approved')
    expect(mutationStore.get('mut_a')!.status).toBe('reverted')
    expect(mutationStore.get('mut_b')!.status).toBe('applied')
    expect(calls.removePolicy).toHaveLength(0)
  })

  it('revertCandidate refuses when the candidate has nothing to revert', () => {
    const { targets } = makeTargets()

    const result = makeManager(targets).revertCandidate('cand_none')

    expect(result).toEqual({ reverted: false, mutationIds: [], reason: 'no revertible mutations' })
  })
})