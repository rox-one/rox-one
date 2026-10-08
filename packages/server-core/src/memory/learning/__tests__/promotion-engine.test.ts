/**
 * PromotionEngine tests (WP-104) — PRD §17 approval gates, refusal paths that
 * touch nothing, per-type promotion with LearningMutation rows, and rollback of
 * already-applied target changes when a later write fails.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { LearningCandidate, LearningPolicy } from '@rox/shared/memory/learning'
import type { LearningTargetStores } from '../learning-types'
import { CandidateStore } from '../CandidateStore'
import { EvidenceStore } from '../EvidenceStore'
import { LearningAudit } from '../LearningAudit'
import { MutationStore } from '../MutationStore'
import { PromotionEngine } from '../PromotionEngine'

const NOW = Date.parse('2026-10-08T00:00:00.000Z')
const NOW_ISO = new Date(NOW).toISOString()
const RULE = 'run tests before committing'

let dir: string
let candidateStore: CandidateStore
let mutationStore: MutationStore
let evidenceStore: EvidenceStore
let audit: LearningAudit

const tmpDirs: string[] = []

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'promotion-engine-'))
  tmpDirs.push(dir)
  candidateStore = new CandidateStore(dir)
  mutationStore = new MutationStore(dir)
  evidenceStore = new EvidenceStore(dir)
  audit = new LearningAudit(dir)
})

afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true })
})

interface TargetCallLog {
  addLesson: Array<Parameters<LearningTargetStores['addLesson']>[0]>
  removeLesson: Array<{ rule: string; scope: 'global' | 'workspace' }>
  enqueueSkill: Array<Parameters<LearningTargetStores['enqueueSkill']>[0]>
  removeQueuedSkill: string[]
  savePolicy: LearningPolicy[]
  removePolicy: string[]
}

function makeTargets(overrides: Partial<LearningTargetStores> = {}): { targets: LearningTargetStores; calls: TargetCallLog } {
  const calls: TargetCallLog = {
    addLesson: [],
    removeLesson: [],
    enqueueSkill: [],
    removeQueuedSkill: [],
    savePolicy: [],
    removePolicy: [],
  }
  const targets: LearningTargetStores = {
    addLesson: (input) => {
      calls.addLesson.push(input)
    },
    removeLesson: (rule, scope) => {
      calls.removeLesson.push({ rule, scope })
      return true
    },
    enqueueSkill: (input) => {
      calls.enqueueSkill.push(input)
      return true
    },
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

function makeEngine(targets: LearningTargetStores): PromotionEngine {
  return new PromotionEngine({ targets, mutationStore, candidateStore, evidenceStore, audit, clock: () => NOW })
}

function makeCandidate(over: Partial<LearningCandidate> = {}): LearningCandidate {
  return {
    id: 'cand_1',
    fingerprint: 'a'.repeat(64),
    type: 'lesson',
    scope: 'workspace',
    hypothesis: RULE,
    payload: { rule: RULE, category: 'workflow' },
    evidence: [{ evidenceId: 'ev_1', type: 'successful_outcome', ref: 'task-1', weight: 1 }],
    confidence: 0.9,
    confidenceComponents: {
      recurrence: 0.9,
      evidenceQuality: 0.9,
      userSignal: 0.9,
      repositorySupport: 0.9,
      outcomeSupport: 0.9,
      consistency: 0.9,
    },
    status: 'approved',
    validation: { passes: [{ pass: 'evidence_count', ok: true }], promotable: true, checkedAt: NOW_ISO },
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
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

describe('PromotionEngine', () => {
  it('refuses global-scope candidates under autonomous approval', async () => {
    const candidate = makeCandidate({ scope: 'global' })
    candidateStore.save(candidate)
    const { targets, calls } = makeTargets()

    const result = await makeEngine(targets).promote(candidate, { approval: 'autonomous', workspaceId: dir })

    expect(result.promoted).toBe(false)
    expect(result.reason).toBe('requires review')
    expect(result.status).toBe('approved')
    expect(result.mutations).toEqual([])
    expect(calls.addLesson).toHaveLength(0)
    expect(mutationStore.list()).toHaveLength(0)
    expect(candidateStore.get('cand_1')!.status).toBe('approved')
  })

  it('refuses policy candidates under autonomous approval but allows user approval', async () => {
    const candidate = makeCandidate({
      type: 'policy',
      payload: { taskClass: 'refactor', preferredSkills: [], verification: [], delegation: 'neutral' },
    })
    candidateStore.save(candidate)
    const { targets, calls } = makeTargets()
    const engine = makeEngine(targets)

    const refused = await engine.promote(candidate, { approval: 'autonomous', workspaceId: dir })
    expect(refused.promoted).toBe(false)
    expect(refused.reason).toBe('requires review')
    expect(calls.savePolicy).toHaveLength(0)

    const allowed = await engine.promote(candidate, { approval: 'user', workspaceId: dir })
    expect(allowed.promoted).toBe(true)
    expect(allowed.status).toBe('active')
  })

  it('refuses non-promotable candidates without touching any store', async () => {
    const failing = makeCandidate({
      validation: { passes: [{ pass: 'evidence_count', ok: false }], promotable: false, checkedAt: NOW_ISO },
    })
    candidateStore.save(failing)
    const { targets, calls } = makeTargets()

    const result = await makeEngine(targets).promote(failing, { approval: 'autonomous', workspaceId: dir })
    expect(result.promoted).toBe(false)
    expect(result.reason).toBe('not validated')
    expect(calls.addLesson).toHaveLength(0)
    expect(mutationStore.list()).toHaveLength(0)
    expect(candidateStore.get('cand_1')!.status).toBe('approved')
  })

  it('refuses candidates that carry no validation at all', async () => {
    const candidate = { ...makeCandidate(), validation: undefined } as unknown as LearningCandidate
    const { targets } = makeTargets()

    const result = await makeEngine(targets).promote(candidate, { approval: 'user', workspaceId: dir })
    expect(result.promoted).toBe(false)
    expect(result.reason).toBe('not validated')
  })

  it('refuses candidates whose status is not promotable', async () => {
    const candidate = makeCandidate({ status: 'active' })
    const { targets } = makeTargets()

    const result = await makeEngine(targets).promote(candidate, { approval: 'user', workspaceId: dir })
    expect(result.promoted).toBe(false)
    expect(result.reason).toBe("status 'active' is not promotable")
  })

  it('promotes a workspace lesson and records the mutation and audit trail', async () => {
    const candidate = makeCandidate()
    candidateStore.save(candidate)
    evidenceStore.add({ id: 'ev_1', type: 'successful_outcome', ref: 'task-1', weight: 1, ts: NOW_ISO })
    const { targets, calls } = makeTargets()
    const emitted: Array<{ workspaceId: string; kind: string; id: string }> = []
    const engine = new PromotionEngine({
      targets,
      mutationStore,
      candidateStore,
      evidenceStore,
      audit,
      clock: () => NOW,
      emit: (evt) => emitted.push(evt),
    })

    const result = await engine.promote(candidate, { approval: 'autonomous', workspaceId: dir })

    expect(result.promoted).toBe(true)
    expect(result.status).toBe('active')
    expect(calls.addLesson).toEqual([{ rule: RULE, category: 'workflow', scope: 'workspace', trigger: 'distillation' }])
    expect(result.mutations).toHaveLength(1)
    const mutation = result.mutations[0]!
    expect(mutation.targetType).toBe('lesson')
    expect(mutation.targetId).toBe(RULE)
    expect(mutation.candidateId).toBe('cand_1')
    expect(mutation.before).toBeNull()
    expect(mutation.after).toEqual({ rule: RULE, scope: 'workspace' })
    expect(mutation.rollbackAvailable).toBe(true)
    expect(mutation.status).toBe('applied')
    expect(mutation.ts).toBe(NOW_ISO)
    expect(mutationStore.get(mutation.id)!.status).toBe('applied')
    expect(candidateStore.get('cand_1')!.status).toBe('active')
    expect(candidateStore.get('cand_1')!.updatedAt).toBe(NOW_ISO)
    const promoted = auditEntries().find((entry) => entry.action === 'promote')
    expect(promoted?.target).toBe(RULE)
    expect(promoted?.actor).toBe('learning')
    expect(promoted?.detail).toContain('evidence=1/1')
    expect(emitted).toEqual([{ workspaceId: dir, kind: 'promotion', id: 'cand_1' }])
  })

  it('promotes a project-scope preference as a workspace lesson with category preference', async () => {
    const candidate = makeCandidate({
      id: 'cand_pref',
      type: 'preference',
      scope: 'project',
      hypothesis: 'prefers concise answers',
      payload: { rule: 'prefers concise answers', negative: false },
    })
    const { targets, calls } = makeTargets()

    const result = await makeEngine(targets).promote(candidate, { approval: 'autonomous', workspaceId: dir })

    expect(result.promoted).toBe(true)
    expect(calls.addLesson).toEqual([
      { rule: 'prefers concise answers', category: 'preference', scope: 'workspace', trigger: 'distillation' },
    ])
    expect(result.mutations[0]!.after).toEqual({ rule: 'prefers concise answers', scope: 'workspace' })
  })

  it('promotes a skill by enqueueing it', async () => {
    const candidate = makeCandidate({
      id: 'cand_skill',
      type: 'skill',
      fingerprint: 'b'.repeat(64),
      payload: { slug: 'release-checklist', description: 'Run the release checklist', body: '1. bump version' },
    })
    const { targets, calls } = makeTargets()

    const result = await makeEngine(targets).promote(candidate, { approval: 'autonomous', workspaceId: dir })

    expect(result.promoted).toBe(true)
    expect(calls.enqueueSkill).toEqual([
      { slug: 'release-checklist', description: 'Run the release checklist', body: '1. bump version' },
    ])
    expect(result.mutations[0]!.targetType).toBe('skill')
    expect(result.mutations[0]!.targetId).toBe('release-checklist')
    expect(candidateStore.get('cand_skill')!.status).toBe('active')
  })

  it('refuses a skill whose queue entry already exists', async () => {
    const candidate = makeCandidate({
      id: 'cand_skill',
      type: 'skill',
      payload: { slug: 'release-checklist', description: 'Run the release checklist', body: '1. bump version' },
    })
    const { targets } = makeTargets({ enqueueSkill: () => false })

    const result = await makeEngine(targets).promote(candidate, { approval: 'autonomous', workspaceId: dir })

    expect(result.promoted).toBe(false)
    expect(result.reason).toBe("skill 'release-checklist' already queued")
    expect(mutationStore.list()).toHaveLength(0)
  })

  it('promotes a policy with user approval and builds the full LearningPolicy', async () => {
    const candidate = makeCandidate({
      id: 'cand_pol',
      type: 'policy',
      fingerprint: 'c'.repeat(64),
      payload: {
        taskClass: 'refactor',
        preferredModel: 'gpt-5',
        preferredSkills: ['code-review'],
        verification: ['bun test'],
        delegation: 'prefer',
        toolOrder: ['rg'],
      },
    })
    const { targets, calls } = makeTargets()

    const result = await makeEngine(targets).promote(candidate, { approval: 'user', workspaceId: dir })

    expect(result.promoted).toBe(true)
    const policy = calls.savePolicy[0]!
    expect(policy.taskClass).toBe('refactor')
    expect(policy.preferredModel).toBe('gpt-5')
    expect(policy.preferredSkills).toEqual(['code-review'])
    expect(policy.verification).toEqual(['bun test'])
    expect(policy.delegation).toBe('prefer')
    expect(policy.toolOrder).toEqual(['rg'])
    expect(policy.fingerprint).toBe(candidate.fingerprint)
    expect(policy.confidence).toBe(0.9)
    expect(policy.evidence).toEqual(candidate.evidence)
    expect(policy.status).toBe('active')
    expect(policy.createdAt).toBe(NOW_ISO)
    expect(policy.updatedAt).toBe(NOW_ISO)
    expect(result.mutations[0]!.targetType).toBe('policy')
    expect(result.mutations[0]!.targetId).toBe(policy.id)
    expect(candidateStore.get('cand_pol')!.status).toBe('active')
  })

  it('refuses a policy payload without taskClass', async () => {
    const candidate = makeCandidate({ type: 'policy', payload: { preferredSkills: [] } })
    const { targets, calls } = makeTargets()

    const result = await makeEngine(targets).promote(candidate, { approval: 'user', workspaceId: dir })
    expect(result.promoted).toBe(false)
    expect(result.reason).toBe('policy payload requires taskClass')
    expect(calls.savePolicy).toHaveLength(0)
  })

  it('refuses when the target write throws and leaves no active candidate behind', async () => {
    const candidate = makeCandidate({ id: 'cand_throw' })
    candidateStore.save(candidate)
    const { targets } = makeTargets({
      addLesson: () => {
        throw new Error('lesson store offline')
      },
    })

    const result = await makeEngine(targets).promote(candidate, { approval: 'autonomous', workspaceId: dir })

    expect(result.promoted).toBe(false)
    expect(result.reason).toBe('lesson store offline')
    expect(result.mutations).toEqual([])
    expect(mutationStore.list()).toHaveLength(0)
    expect(candidateStore.listActive()).toHaveLength(0)
    expect(candidateStore.get('cand_throw')!.status).toBe('approved')
  })

  it('reverts an applied target when a later write fails and keeps the candidate non-active', async () => {
    const candidate = makeCandidate({ id: 'cand_fail' })
    candidateStore.save(candidate)
    const { targets, calls } = makeTargets()
    const brokenCandidateStore = {
      get: (id: string) => candidateStore.get(id),
      save: (): LearningCandidate => {
        throw new Error('candidate store disk full')
      },
    } as unknown as CandidateStore
    const engine = new PromotionEngine({
      targets,
      mutationStore,
      candidateStore: brokenCandidateStore,
      evidenceStore,
      audit,
      clock: () => NOW,
    })

    const result = await engine.promote(candidate, { approval: 'autonomous', workspaceId: dir })

    expect(result.promoted).toBe(false)
    expect(result.reason).toBe('candidate store disk full')
    expect(result.mutations).toEqual([])
    expect(calls.addLesson).toHaveLength(1)
    expect(calls.removeLesson).toEqual([{ rule: RULE, scope: 'workspace' }])
    const rows = mutationStore.list()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.status).toBe('reverted')
    expect(rows[0]!.reason).toBe('promotion failed')
    expect(candidateStore.listActive()).toHaveLength(0)
    expect(candidateStore.get('cand_fail')!.status).toBe('approved')
  })
})