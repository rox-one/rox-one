/**
 * LearningHost tests (WP-117) — the composition root that makes the learning
 * loop live in a running app.
 *
 * No engines are faked: the host builds the real seven-store stack over a temp
 * workspace, and only the two ambient seams (workspace lookup, LLM distill) are
 * injected. Covers bus → observation persistence, facade dispatch and its
 * unknown-workspace degradation, the real `LearningTargetStores` write-through,
 * and worker lifecycle.
 */
import { describe, it, expect, afterEach } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { LearningPolicy } from '@rox/shared/memory/learning'
import { SessionEventBus } from '../../../sessions/SessionEventBus'
import { learningDirFor, type LearningTargetStores } from '../learning-types'
import { createWorkspaceTargetStores, LearningHost } from '../LearningHost'
import { PolicyStore } from '../PolicyStore'

const NOW = Date.parse('2026-10-08T00:00:00.000Z')
const NOW_ISO = new Date(NOW).toISOString()
const WS = 'ws-1'
const SESSION = 'sess-1'
const RULE = 'Always review the diff before committing'

const roots: string[] = []
const hosts: LearningHost[] = []

function makeWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'learning-host-'))
  roots.push(root)
  return root
}

function makeHost(root: string | null): LearningHost {
  const host = new LearningHost({
    resolveWorkspace: (workspaceId) => (root && workspaceId === WS ? { id: WS, rootPath: root } : null),
    clock: () => NOW,
  })
  hosts.push(host)
  return host
}

function readJsonl(path: string): unknown[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as unknown)
}

afterEach(() => {
  for (const host of hosts.splice(0)) host.stop()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('LearningHost lifecycle bus', () => {
  it('persists a structured observation when a session completes', () => {
    const root = makeWorkspace()
    const bus = new SessionEventBus()
    const host = makeHost(root)
    const off = host.attachBus(bus)

    bus.emit('session.completed', { sessionId: SESSION, workspaceId: WS, ts: NOW_ISO, reason: 'complete' })
    off()

    const rows = readJsonl(join(learningDirFor(root), 'observations.jsonl'))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ sessionId: SESSION, workspaceId: WS, outcome: { status: 'success' } })
  })

  it('merges tool, correction and completion signals into one session observation', () => {
    const root = makeWorkspace()
    const bus = new SessionEventBus()
    const host = makeHost(root)
    host.attachBus(bus)

    bus.emit('tool.result', { sessionId: SESSION, workspaceId: WS, ts: NOW_ISO, tool: 'bash', callId: 'c1', ok: false, error: 'boom' })
    bus.emit('user.correction', { sessionId: SESSION, workspaceId: WS, ts: NOW_ISO, kind: 'plan_edit', detail: 'not that plan' })
    bus.emit('prompt.assembled', {
      sessionId: SESSION,
      workspaceId: WS,
      ts: NOW_ISO,
      lessons: [{ rule: RULE, scope: 'workspace' }],
      skillSlugs: ['safe-skill'],
    })
    bus.emit('session.completed', { sessionId: SESSION, workspaceId: WS, ts: NOW_ISO, reason: 'error' })

    const rows = readJsonl(join(learningDirFor(root), 'observations.jsonl'))
    const latest = rows[rows.length - 1]
    expect(latest).toMatchObject({
      outcome: { status: 'failure', reason: 'error' },
      execution: { tools: ['bash'] },
      memory: { skillsInjected: ['safe-skill'], lessonsInjected: [{ rule: RULE, scope: 'workspace' }] },
      signals: { userCorrections: [{ category: 'workflow' }], errors: [{ tool: 'bash', message: 'boom' }] },
    })
  })

  it('ignores events for unknown workspaces without throwing', () => {
    const host = makeHost(null)
    const bus = new SessionEventBus()
    host.attachBus(bus)
    expect(() => bus.emit('session.completed', { sessionId: SESSION, workspaceId: 'nope', ts: NOW_ISO, reason: 'complete' })).not.toThrow()
    expect(() => bus.emit('tool.result', { sessionId: SESSION, workspaceId: 'nope', ts: NOW_ISO, tool: 'bash', callId: 'c1', ok: true })).not.toThrow()
  })
})

describe('LearningHost RPC facade', () => {
  it('dispatches by workspaceId to that workspace’s service', () => {
    const root = makeWorkspace()
    const host = makeHost(root)
    host.observeCompletion({ workspaceId: WS, sessionId: SESSION, reason: 'complete' })

    expect(host.getStats(WS).observations).toBe(1)
    expect(host.listCandidates(WS)).toEqual([])
    expect(host.getCandidate(WS, 'cand_missing')).toBeNull()
    expect(host.getPolicies(WS)).toEqual([])
    expect(host.listEvidence(WS)).toEqual([])
    expect(host.getOutcome(WS, 'out_missing')).toBeNull()
    expect(host.getExperiment(WS, 'exp_missing')).toBeNull()
    expect(host.getSkillEffectiveness(WS, RULE)).toMatchObject({ targetId: RULE })
    // observeCompletion also records its TaskOutcome (PRD §3.5/§19), so the
    // timeline now carries both the observation and that outcome.
    const timeline = host.getTimeline(WS, 5)
    expect(timeline).toHaveLength(2)
    expect(timeline.map((entry) => entry.kind).sort()).toEqual(['observation', 'outcome'])
  })

  it('degrades to empty results for an unknown workspace instead of throwing', async () => {
    const host = makeHost(null)

    expect(host.getStats('nope')).toEqual({
      observations: 0,
      candidates: 0,
      activeCandidates: 0,
      rejectedCandidates: 0,
      outcomes: 0,
      mutations: 0,
      revertedMutations: 0,
      policies: 0,
    })
    expect(host.listCandidates('nope')).toEqual([])
    expect(host.getCandidate('nope', 'cand_1')).toBeNull()
    expect(host.getPolicies('nope')).toEqual([])
    expect(host.listEvidence('nope', 'cand_1')).toEqual([])
    host.recordToolOutcome({ workspaceId: 'nope', sessionId: SESSION, tool: 'bash', ok: true, ts: NOW_ISO })

    expect(await host.approveCandidate('nope', 'cand_1')).toEqual({ promoted: false, status: 'candidate', mutations: [] })
    expect(await host.rollbackCandidate('nope', 'cand_1')).toEqual({ reverted: false, mutationIds: [] })
    expect(await host.revalidateCandidate('nope', 'cand_1')).toBeNull()
    expect(await host.reflectSession('nope', SESSION)).toEqual({ candidates: [] })
    expect(await host.runConsolidation('nope')).toEqual({ candidates: [] })
    expect(await host.runSkillCuration('nope')).toEqual({ items: [] })
    expect(await host.runPolicyLearning('nope')).toEqual({ policies: [] })
    expect(await host.runGarbageCollection('nope')).toEqual({ archived: 0 })
    expect(await host.evaluateOutcomes('nope')).toEqual({ rolledBack: [] })
    expect(await host.ingestDistilled({ workspaceId: 'nope', sessionId: SESSION, kind: 'lesson', rule: RULE })).toMatchObject({ handled: false, promoted: false })
    expect(await host.whenIdle()).toBeUndefined()
  })

  it('stops every worker and stays safe when stopped repeatedly', () => {
    const root = makeWorkspace()
    const host = makeHost(root)
    host.getStats(WS)
    host.stop()
    expect(() => host.stop()).not.toThrow()
  })
})

describe('LearningTargetStores adapters', () => {
  let root: string
  let targets: LearningTargetStores
  let policies: PolicyStore

  const setup = (): void => {
    root = makeWorkspace()
    policies = new PolicyStore(root)
    targets = createWorkspaceTargetStores(root, policies, () => NOW).targets
  }

  it('writes workspace lessons through the real LessonStore file', () => {
    setup()
    targets.addLesson({ rule: RULE, category: 'workflow', scope: 'workspace', trigger: 'distillation', sessionId: SESSION })

    const file = join(root, 'memory', 'lessons.jsonl')
    expect(existsSync(file)).toBe(true)
    const rows = readJsonl(file)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ rule: RULE, generated: true, source: { trigger: 'distillation', sessionId: SESSION } })
    expect(rows[0]).not.toHaveProperty('owner')

    // Idempotent by rule: re-adding refreshes rather than duplicates.
    targets.addLesson({ rule: RULE, category: 'workflow', scope: 'workspace', trigger: 'distillation' })
    expect(readJsonl(file)).toHaveLength(1)

    expect(targets.removeLesson(RULE, 'workspace')).toBe(true)
    expect(targets.removeLesson(RULE, 'workspace')).toBe(false)
    expect(readJsonl(file)).toHaveLength(0)
  })

  it('enqueues, reads and removes real pending skill candidates', () => {
    setup()
    expect(targets.enqueueSkill({ slug: 'safe-skill', description: 'Does a thing', body: '# Steps', sessionId: SESSION })).toBe(true)
    expect(targets.enqueueSkill({ slug: 'safe-skill', description: 'Does a thing', body: '# Steps' })).toBe(false)

    const dir = join(root, 'skills', '.pending', 'safe-skill')
    expect(existsSync(join(dir, 'SKILL.md'))).toBe(true)
    expect(readFileSync(join(dir, 'SKILL.md'), 'utf8')).toContain('# Steps')
    expect(existsSync(join(dir, '.meta.json'))).toBe(true)
    expect(targets.readQueuedSkill('safe-skill')).toEqual({ slug: 'safe-skill', description: 'Does a thing', body: '# Steps' })

    expect(targets.removeQueuedSkill('../../escape')).toBe(false)
    expect(targets.removeQueuedSkill('safe-skill')).toBe(true)
    expect(existsSync(dir)).toBe(false)
    expect(targets.readQueuedSkill('safe-skill')).toBeNull()
  })

  it('saves and removes learned policies', () => {
    setup()
    const policy: LearningPolicy = {
      id: 'pol_1',
      fingerprint: 'fp_1',
      taskClass: 'refactor',
      preferredSkills: [],
      verification: [],
      delegation: 'neutral',
      confidence: 0.8,
      evidence: [],
      status: 'active',
      createdAt: NOW_ISO,
      updatedAt: NOW_ISO,
    }
    targets.savePolicy(policy)
    expect(policies.get('pol_1')?.taskClass).toBe('refactor')
    expect(targets.removePolicy('pol_1')).toBe(true)
    expect(targets.removePolicy('pol_1')).toBe(false)
  })
})