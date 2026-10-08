/**
 * WP-105 — PolicyLearner tests: fingerprint determinism, emission gates
 * (≥10 comparable tasks, Δsuccess ≥ 0.1 vs global baseline, pattern
 * consistency ≥ 0.7), candidate shape, observation dedup, and ordering.
 */
import { describe, it, expect } from 'bun:test'
import { createHash } from 'node:crypto'
import type {
  LearningObservation,
  TaskOutcome,
  TaskOutcomeStatus,
  VerificationResult,
} from '@rox/shared/memory/learning'
import { PolicyLearner, taskFingerprint } from '../PolicyLearner'

const NOW = Date.parse('2026-10-08T00:00:00.000Z')
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

function obs(
  id: string,
  sessionId: string,
  skills: string[],
  opts: { ts?: string; category?: string; delegated?: boolean; verification?: VerificationResult } = {},
): LearningObservation {
  return {
    id,
    sessionId,
    workspaceId: 'ws-1',
    ts: opts.ts ?? new Date(NOW).toISOString(),
    task: { goal: 'goal', category: opts.category ?? 'refactor' },
    execution: { tools: [], skills, models: [], delegated: opts.delegated ?? true },
    outcome: { status: 'success' },
    signals: {
      userCorrections: [],
      errors: [],
      branches: 0,
      interruptions: 0,
      ...(opts.verification ? { verification: opts.verification } : {}),
    },
    memory: { lessonsInjected: [], episodesRecalled: [], skillsInjected: [] },
    artifacts: { filesChanged: 0 },
  }
}

function outcome(id: string, sessionId: string, fingerprint: string, status: TaskOutcomeStatus): TaskOutcome {
  return {
    id,
    sessionId,
    taskFingerprint: fingerprint,
    status,
    userCorrections: 0,
    memoryUsed: [],
    skillsUsed: [],
    errors: [],
    ts: new Date(NOW).toISOString(),
  }
}

function learner(): PolicyLearner {
  return new PolicyLearner({ clock: () => NOW })
}

/** `count` outcomes for `prefix` with `successes` successes, plus matching observations. */
function group(
  prefix: string,
  fingerprint: string,
  count: number,
  successes: number,
  obsOptions: (i: number) => Parameters<typeof obs>[3] = () => ({}),
): { outcomes: TaskOutcome[]; observations: LearningObservation[] } {
  const outcomes: TaskOutcome[] = []
  const observations: LearningObservation[] = []
  for (let i = 1; i <= count; i += 1) {
    const sessionId = `${prefix}-s${i}`
    const status: TaskOutcomeStatus = i <= successes ? 'success' : 'failure'
    outcomes.push(outcome(`${prefix}-o${i}`, sessionId, fingerprint, status))
    observations.push(
      obs(`${prefix}-obs${i}`, sessionId, ['test', 'refactor'], obsOptions(i)),
    )
  }
  return { outcomes, observations }
}

describe('taskFingerprint', () => {
  it('is deterministic and hash-stable across runs', () => {
    const input = { taskClass: 'refactor', stack: ['typescript', 'bun'], complexity: 'small' as const, skills: ['tdd'] }
    expect(taskFingerprint(input, sha256)).toBe(taskFingerprint(input, sha256))
  })

  it('normalizes case/whitespace and ignores stack/skills ordering', () => {
    const a = taskFingerprint(
      { taskClass: ' Refactor  Module ', stack: ['TypeScript', 'bun'], complexity: 'small', skills: ['TDD', 'bun-test'] },
      sha256,
    )
    const b = taskFingerprint(
      { taskClass: 'refactor module', stack: ['bun', 'typescript'], complexity: 'small', skills: ['bun-test', 'tdd'] },
      sha256,
    )
    expect(a).toBe(b)
  })

  it('distinguishes task class, complexity, and stack', () => {
    const base = { taskClass: 'refactor', stack: ['bun'], complexity: 'small' as const, skills: ['tdd'] }
    expect(taskFingerprint(base, sha256)).not.toBe(taskFingerprint({ ...base, taskClass: 'feature' }, sha256))
    expect(taskFingerprint(base, sha256)).not.toBe(taskFingerprint({ ...base, complexity: 'large' }, sha256))
    expect(taskFingerprint(base, sha256)).not.toBe(taskFingerprint({ ...base, stack: ['node'] }, sha256))
  })

  it('feeds normalized parts to the injected hash', () => {
    const payloads: string[] = []
    const result = taskFingerprint(
      { taskClass: 'Refactor', stack: ['TypeScript', 'bun'], complexity: 'small', skills: ['TDD', 'bun-test'] },
      text => {
        payloads.push(text)
        return 'hashed'
      },
    )
    expect(result).toBe('hashed')
    expect(payloads).toEqual(['refactor\u0000bun,typescript\u0000small\u0000bun-test,tdd'])
  })

  it('handles empty input', () => {
    expect(taskFingerprint({}, () => 'fixed')).toBe('fixed')
  })
})

describe('PolicyLearner.learn — emission gates', () => {
  it('emits no policy for fewer than 10 comparable tasks', () => {
    const good = group('good', 'fp-good', 9, 9)
    const bad = group('bad', 'fp-bad', 10, 0)
    const policies = learner().learn({
      observations: [...good.observations, ...bad.observations],
      outcomes: [...good.outcomes, ...bad.outcomes],
    })
    expect(policies).toEqual([])
  })

  it('never lowers the default floor of 10 via minTasks', () => {
    const good = group('good', 'fp-good', 9, 9)
    const bad = group('bad', 'fp-bad', 10, 0)
    const policies = learner().learn({
      observations: [...good.observations, ...bad.observations],
      outcomes: [...good.outcomes, ...bad.outcomes],
      minTasks: 3,
    })
    expect(policies).toEqual([])
  })

  it('raises the floor via minTasks', () => {
    const good = group('good', 'fp-good', 12, 12)
    const bad = group('bad', 'fp-bad', 10, 0)
    const policies = learner().learn({
      observations: [...good.observations, ...bad.observations],
      outcomes: [...good.outcomes, ...bad.outcomes],
      minTasks: 20,
    })
    expect(policies).toEqual([])
  })

  it('emits a candidate policy for >= 10 comparable tasks with Δsuccess >= 0.1 and a consistent pattern', () => {
    const good = group('good', 'fp-good', 12, 10, i =>
      i === 1
        ? { verification: { testsPassed: 3, testsFailed: 0, lintPassed: true } }
        : { category: i <= 8 ? 'refactor' : 'feature', verification: { testsPassed: 2, lintPassed: true } },
    )
    const bad = group('bad', 'fp-bad', 5, 0)

    const policies = learner().learn({
      observations: [...good.observations, ...bad.observations],
      outcomes: [...good.outcomes, ...bad.outcomes],
    })

    // Group rate 10/12 ≈ 0.833; baseline over all 17 outcomes = 10/17 ≈ 0.588.
    expect(policies).toHaveLength(1)
    const policy = policies[0]
    expect(policy.id).toBe('pol_fp-good_1')
    expect(policy.fingerprint).toBe('fp-good')
    expect(policy.taskClass).toBe('refactor')
    expect(policy.preferredSkills).toEqual(['refactor', 'test'])
    expect(policy.verification).toEqual(['lint', 'tests'])
    expect(policy.delegation).toBe('prefer')
    expect(policy.status).toBe('candidate')
    expect(policy.confidence).toBeCloseTo((10 / 12) * 1, 4)
    expect(policy.createdAt).toBe(new Date(NOW).toISOString())
    expect(policy.updatedAt).toBe(new Date(NOW).toISOString())
    expect(policy.evidence).toHaveLength(12)
    expect(policy.evidence.filter(e => e.type === 'successful_outcome')).toHaveLength(10)
    expect(policy.evidence.filter(e => e.type === 'failed_outcome')).toHaveLength(2)
    expect(policy.evidence[0]).toEqual({
      evidenceId: 'good-o1',
      type: 'successful_outcome',
      ref: 'good-o1',
      weight: 1,
    })
  })

  it('skips groups whose Δsuccess vs the global baseline is below 0.1', () => {
    const good = group('good', 'fp-good', 10, 9)
    const better = group('better', 'fp-better', 10, 10)
    const policies = learner().learn({
      observations: [...good.observations, ...better.observations],
      outcomes: [...good.outcomes, ...better.outcomes],
    })
    // good: 0.9 vs baseline 0.95 → −0.05; better: 1.0 vs 0.95 → 0.05.
    expect(policies).toEqual([])
  })

  it('skips groups without a consistent skill/delegation pattern', () => {
    const outcomes: TaskOutcome[] = []
    const observations: LearningObservation[] = []
    for (let i = 1; i <= 10; i += 1) {
      outcomes.push(outcome(`noisy-o${i}`, `noisy-s${i}`, 'fp-noisy', 'success'))
      observations.push(
        obs(`noisy-obs${i}`, `noisy-s${i}`, [`skill-${i}`], { delegated: i % 2 === 0 }),
      )
    }
    const bad = group('bad', 'fp-bad', 10, 0)
    const policies = learner().learn({
      observations: [...observations, ...bad.observations],
      outcomes: [...outcomes, ...bad.outcomes],
    })
    expect(policies).toEqual([])
  })

  it('skips groups with no observations at all (no evidence of a pattern)', () => {
    const good = group('good', 'fp-good', 10, 10)
    const bad = group('bad', 'fp-bad', 10, 0)
    const policies = learner().learn({ observations: [], outcomes: [...good.outcomes, ...bad.outcomes] })
    expect(policies).toEqual([])
  })

  it('emits delegation avoid when non-delegated tasks dominate', () => {
    const good = group('good', 'fp-good', 10, 10, i => ({ delegated: i > 8 }))
    const bad = group('bad', 'fp-bad', 10, 0)
    const policies = learner().learn({
      observations: [...good.observations, ...bad.observations],
      outcomes: [...good.outcomes, ...bad.outcomes],
    })
    expect(policies).toHaveLength(1)
    expect(policies[0].delegation).toBe('avoid')
  })
})

describe('PolicyLearner.learn — determinism and observation handling', () => {
  it('is deterministic across runs and independent of observation ordering', () => {
    const good = group('good', 'fp-good', 12, 10)
    const bad = group('bad', 'fp-bad', 6, 0)
    const input = {
      observations: [...good.observations, ...bad.observations],
      outcomes: [...good.outcomes, ...bad.outcomes],
    }
    const first = learner().learn(input)
    const second = learner().learn(input)
    const reversed = learner().learn({ ...input, observations: [...input.observations].reverse() })
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
    expect(JSON.stringify(first)).toBe(JSON.stringify(reversed))
    expect(first).toHaveLength(1)
  })

  it('counts only the latest observation per session', () => {
    const outcomes: TaskOutcome[] = []
    const observations: LearningObservation[] = []
    const earlier = new Date(NOW - 60_000).toISOString()
    for (let i = 1; i <= 10; i += 1) {
      outcomes.push(outcome(`good-o${i}`, `good-s${i}`, 'fp-good', 'success'))
      observations.push(obs(`good-old${i}`, `good-s${i}`, [], { ts: earlier, delegated: true }))
      observations.push(obs(`good-new${i}`, `good-s${i}`, ['deploy'], { delegated: true }))
    }
    const bad = group('bad', 'fp-bad', 10, 0)
    const policies = learner().learn({
      observations: [...observations, ...bad.observations],
      outcomes: [...outcomes, ...bad.outcomes],
    })
    expect(policies).toHaveLength(1)
    expect(policies[0].preferredSkills).toEqual(['deploy'])
    expect(policies[0].confidence).toBeCloseTo(1, 4)
  })

  it('orders emitted policies by fingerprint and numbers ids from 1', () => {
    const zzz = group('zzz', 'zzz', 10, 10)
    const aaa = group('aaa', 'aaa', 10, 10)
    const bad = group('bad', 'mmm', 10, 0)
    const policies = learner().learn({
      observations: [...zzz.observations, ...aaa.observations, ...bad.observations],
      outcomes: [...zzz.outcomes, ...aaa.outcomes, ...bad.outcomes],
    })
    expect(policies.map(p => p.id)).toEqual(['pol_aaa_1', 'pol_zzz_2'])
    expect(policies.map(p => p.fingerprint)).toEqual(['aaa', 'zzz'])
  })

  it('returns no policies for empty outcome input', () => {
    expect(learner().learn({ observations: [], outcomes: [] })).toEqual([])
  })
})