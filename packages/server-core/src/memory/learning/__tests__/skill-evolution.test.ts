/**
 * WP-105 — SkillEvolutionEngine tests: keep/improve/archive boundaries,
 * patch refusal below the evidence threshold, version-info shape, evidence
 * weight clamping, determinism, and the documented redaction boundary
 * (the engine emits unredacted drafts; PromotionEngine/enqueue redacts).
 */
import { describe, it, expect } from 'bun:test'
import type { SkillUsageMap } from '@rox/shared/memory/types'
import type { TaskOutcome, TaskOutcomeStatus } from '@rox/shared/memory/learning'
import {
  DEFAULT_SKILL_EVOLUTION_THRESHOLDS,
  SkillEvolutionEngine,
  type SkillCurationInput,
  type SkillCurationSkill,
} from '../SkillEvolutionEngine'

const NOW = Date.parse('2026-10-08T00:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000

function engine(): SkillEvolutionEngine {
  return new SkillEvolutionEngine({ clock: () => NOW })
}

function outcome(
  id: string,
  slug: string,
  status: TaskOutcomeStatus,
  sessionId = `sess-${id}`,
): TaskOutcome {
  return {
    id,
    sessionId,
    taskFingerprint: 'fp-1',
    status,
    userCorrections: 0,
    memoryUsed: [],
    skillsUsed: [slug],
    errors: [],
    ts: new Date(NOW - DAY).toISOString(),
  }
}

function input(
  skills: SkillCurationSkill[],
  usage: SkillUsageMap,
  outcomes: TaskOutcome[],
): SkillCurationInput {
  return { skills, usage, outcomes }
}

function skill(slug: string, extra: Partial<SkillCurationSkill> = {}): SkillCurationSkill {
  return { slug, pending: false, approved: true, hasBody: true, ...extra }
}

function decide(slug: string, i: SkillCurationInput) {
  const decisions = engine().curate(i)
  const decision = decisions.find(d => d.slug === slug)
  if (!decision) throw new Error(`no decision for ${slug}`)
  return decision
}

describe('curate — keep/improve/archive boundaries', () => {
  it('keeps a healthy skill', () => {
    const i = input(
      [skill('healthy')],
      { healthy: { used: 10, lastUsedAt: new Date(NOW).toISOString() } },
      [
        outcome('o1', 'healthy', 'success'),
        outcome('o2', 'healthy', 'success'),
        outcome('o3', 'healthy', 'success'),
        outcome('o4', 'healthy', 'failure'),
      ],
    )
    const d = decide('healthy', i)
    expect(d.action).toBe('keep')
    expect(d.metrics.uses).toBe(10)
    expect(d.metrics.successes).toBe(3)
    expect(d.metrics.failures).toBe(1)
    expect(d.metrics.successRate).toBeCloseTo(0.75, 5)
  })

  it('archives a pending candidate unused for >= 30 days, keeps one just under', () => {
    const stale = skill('stale', {
      approved: false,
      pending: true,
      pendingSince: new Date(NOW - 31 * DAY).toISOString(),
    })
    const fresh = skill('fresh', {
      approved: false,
      pending: true,
      pendingSince: new Date(NOW - 29 * DAY).toISOString(),
    })
    const i = input([stale, fresh], {}, [])
    expect(decide('stale', i).action).toBe('archive')
    expect(decide('fresh', i).action).toBe('keep')
    expect(decide('stale', i).metrics.pendingAgeDays).toBeCloseTo(31, 3)
  })

  it('does not archive a pending candidate that has been used', () => {
    const i = input(
      [skill('used-pending', { approved: false, pending: true, pendingSince: new Date(NOW - 90 * DAY).toISOString() })],
      { 'used-pending': { used: 1, lastUsedAt: new Date(NOW).toISOString() } },
      [outcome('o1', 'used-pending', 'success')],
    )
    expect(decide('used-pending', i).action).toBe('keep')
  })

  it('archives low success rate only with >= 3 uses', () => {
    const few = input(
      [skill('few')],
      { few: { used: 2, lastUsedAt: '' } },
      [outcome('o1', 'few', 'failure'), outcome('o2', 'few', 'failure')],
    )
    expect(decide('few', few).action).toBe('keep')

    const enough = input(
      [skill('bad')],
      { bad: { used: 3, lastUsedAt: '' } },
      [outcome('o1', 'bad', 'failure'), outcome('o2', 'bad', 'failure'), outcome('o3', 'bad', 'success')],
    )
    const d = decide('bad', enough)
    expect(d.action).toBe('archive')
    expect(d.metrics.successRate).toBeCloseTo(1 / 3, 5)
  })

  it('improves on 3+ failed outcomes even when successRate is at the archive floor', () => {
    const i = input(
      [skill('flaky')],
      { flaky: { used: 5, lastUsedAt: '' } },
      [
        outcome('o1', 'flaky', 'failure'),
        outcome('o2', 'flaky', 'failure'),
        outcome('o3', 'flaky', 'failure'),
        outcome('o4', 'flaky', 'success'),
        outcome('o5', 'flaky', 'success'),
      ],
    )
    const d = decide('flaky', i)
    expect(d.action).toBe('improve')
    expect(d.reason).toContain('3 failed outcomes')
  })

  it('improves on low success rate with >= 3 uses and < 3 failures', () => {
    const i = input(
      [skill('weak')],
      { weak: { used: 5, lastUsedAt: '' } },
      [
        outcome('o1', 'weak', 'success'),
        outcome('o2', 'weak', 'success'),
        outcome('o3', 'weak', 'failure'),
        outcome('o4', 'weak', 'failure'),
      ],
    )
    expect(decide('weak', i).action).toBe('improve')
  })

  it('ignores other skills outcomes and missing usage entries', () => {
    const i = input(
      [skill('quiet')],
      { other: { used: 5, lastUsedAt: '' } },
      [outcome('o1', 'other', 'failure'), outcome('o2', 'other', 'failure'), outcome('o3', 'other', 'failure')],
    )
    const d = decide('quiet', i)
    expect(d.action).toBe('keep')
    expect(d.metrics.uses).toBe(0)
    expect(d.metrics.failures).toBe(0)
  })

  it('reports one decision per input skill, deterministically', () => {
    const i = input(
      [skill('a'), skill('b')],
      { a: { used: 0, lastUsedAt: '' } },
      [outcome('o1', 'b', 'failure')],
    )
    const first = engine().curate(i)
    const second = engine().curate(i)
    expect(first).toEqual(second)
    expect(first.map(d => d.slug)).toEqual(['a', 'b'])
  })

  it('audits each decision through the injected sink without throwing', () => {
    const entries: Array<{ actor: string; action: string; target: string }> = []
    const audited = new SkillEvolutionEngine({
      clock: () => NOW,
      auditor: { append: e => entries.push(e) },
    })
    audited.curate(input([skill('a')], {}, []))
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ actor: 'automation', action: 'skill-curation', target: 'a' })

    const throwing = new SkillEvolutionEngine({
      clock: () => NOW,
      auditor: {
        append: () => {
          throw new Error('sink down')
        },
      },
    })
    expect(throwing.curate(input([skill('a')], {}, []))).toHaveLength(1)
  })
})

describe('buildPatchCandidate', () => {
  const failures = [
    { sessionId: 'sess-1', evidence: 'bun test failed with exit 1' },
    { sessionId: 'sess-2', evidence: 'lint error in widget.ts' },
    { sessionId: 'sess-3', evidence: 'typecheck error: missing export' },
  ]

  it('refuses fewer than 3 failures without deterministic evidence', () => {
    const e = engine()
    expect(() =>
      e.buildPatchCandidate({
        slug: 'deploy-check',
        currentBody: '# deploy-check',
        failures: failures.slice(0, 2),
        baseVersion: 3,
      }),
    ).toThrow(/refused.*2 failed outcomes < 3/)
    expect(() =>
      e.buildPatchCandidate({
        slug: 'deploy-check',
        currentBody: '# deploy-check',
        failures: [],
        baseVersion: 3,
      }),
    ).toThrow(/no deterministic evidence flag/)
  })

  it('allows fewer failures when deterministic evidence is flagged', () => {
    const candidate = engine().buildPatchCandidate({
      slug: 'deploy-check',
      currentBody: '# deploy-check',
      failures: failures.slice(0, 1),
      baseVersion: 3,
      deterministicEvidence: true,
    })
    expect(candidate.payload.versionInfo.version).toBe(4)
  })

  it('returns a draft with version-info shape (version = baseVersion + 1, metrics placeholder)', () => {
    const candidate = engine().buildPatchCandidate({
      slug: 'deploy-check',
      currentBody: '# deploy-check\n\nRun checks before deploying.\n',
      failures,
      baseVersion: 3,
    })

    expect(candidate.hypothesis).toContain("Skill 'deploy-check'")
    expect(candidate.payload.slug).toBe('deploy-check')
    expect(candidate.payload.supersedes).toBe('deploy-check')
    expect(candidate.payload.description).toContain('3 failed outcomes')
    expect(candidate.payload.versionInfo).toEqual({
      version: 4,
      parentVersion: 3,
      evidence: ['sess-1', 'sess-2', 'sess-3'],
      reason: candidate.hypothesis,
      metrics: {},
    })

    expect(candidate.evidenceRefs).toEqual([
      { type: 'failed_outcome', ref: 'sess-1', weight: 1 },
      { type: 'failed_outcome', ref: 'sess-2', weight: 1 },
      { type: 'failed_outcome', ref: 'sess-3', weight: 1 },
    ])
    for (const ref of candidate.evidenceRefs) {
      expect(ref.weight).toBeGreaterThanOrEqual(0)
      expect(ref.weight).toBeLessThanOrEqual(1)
    }
  })

  it('appends deterministic guardrails from the failure evidence to the body', () => {
    const candidate = engine().buildPatchCandidate({
      slug: 'deploy-check',
      currentBody: '# deploy-check\n\nRun checks before deploying.\n',
      failures,
      baseVersion: 1,
    })
    expect(candidate.payload.body.startsWith('# deploy-check\n\nRun checks before deploying.')).toBe(true)
    expect(candidate.payload.body).toContain('## Guardrails (learned)')
    expect(candidate.payload.body).toContain('- Session `sess-1` failed: bun test failed with exit 1')
    expect(candidate.payload.body).toContain('- Session `sess-3` failed: typecheck error: missing export')
  })

  it('is deterministic across runs', () => {
    const build = () =>
      engine().buildPatchCandidate({
        slug: 'deploy-check',
        currentBody: '# deploy-check\n',
        failures,
        baseVersion: 2,
      })
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()))
  })

  it('does NOT redact the draft: redaction is owned by the promotion/enqueue path', () => {
    // The promotion path (PromotionEngine → LearningTargetStores.enqueueSkill
    // → SkillPendingQueue, mirroring MemoryService.applyResult's skill branch)
    // applies redactSecrets + the SENSITIVE_RE gate. The engine must stay a
    // pure draft builder, so the evidence text is passed through verbatim.
    const draft = engine().buildPatchCandidate({
      slug: 'deploy-check',
      currentBody: '# deploy-check\n',
      failures: [
        { sessionId: 'sess-1', evidence: 'token=api_key=abcdef1234567890 rejected' },
        { sessionId: 'sess-2', evidence: 'export AWS_ACCESS_KEY_ID (AKIAIOSFODNN7EXAMPLE) leaked' },
        { sessionId: 'sess-3', evidence: 'private key in .ssh/config' },
      ],
      baseVersion: 1,
    })
    expect(draft.payload.body).toContain('token=api_key=abcdef1234567890 rejected')
    expect(draft.payload.body).toContain('AKIAIOSFODNN7EXAMPLE')
  })
})