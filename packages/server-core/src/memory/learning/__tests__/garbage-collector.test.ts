/**
 * GarbageCollector tests (PRD §14 Job 6).
 *
 * Two layers: the pure collector (deterministic recommendations from lessons,
 * skills and rolled-back policies; `apply` without an archive port never
 * deletes) and the service integration (`runGarbageCollection` audits every
 * recommendation with action 'garbage-collection' through the real
 * LearningAudit file and archives nothing without an injected port).
 */
import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { LearningObservation, UserCorrection } from '@rox/shared/memory/learning'
import {
  DEFAULT_GARBAGE_THRESHOLDS,
  GarbageCollector,
  type GarbageArchivePort,
  type GarbageRecommendation,
} from '../GarbageCollector'
import { LearningService, type LearningServiceLogger, type LearningServiceStores } from '../LearningService'
import type {
  LearningTargetStores,
  ValidatorPorts,
} from '../learning-types'
import { learningDirFor } from '../learning-types'
import { ObservationStore } from '../ObservationStore'
import { CandidateStore } from '../CandidateStore'
import { EvidenceStore } from '../EvidenceStore'
import { OutcomeStore } from '../OutcomeStore'
import { MutationStore } from '../MutationStore'
import { ExperimentStore } from '../ExperimentStore'
import { PolicyStore } from '../PolicyStore'
import { LearningAudit } from '../LearningAudit'
import { DEFAULT_LEARNING_THRESHOLDS, DEFAULT_SKILLS_LEARNING_POLICY } from '@rox/shared/memory/learning'

const NOW = Date.parse('2026-10-08T00:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000
const OLD = new Date(NOW - 200 * DAY).toISOString()

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'learning-gc-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const SILENT_LOGGER: LearningServiceLogger = { warn: () => {} }

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

function makeValidatorPorts(): ValidatorPorts {
  return {
    listExistingRules: () => [],
    readRepositorySignals: () => [],
    listOutcomesByFingerprint: () => [],
    readSkillsLearningPolicy: () => ({ ...DEFAULT_SKILLS_LEARNING_POLICY }),
    thresholds: { ...DEFAULT_LEARNING_THRESHOLDS },
  }
}

function makeService(stores = makeStores()): LearningService {
  return new LearningService({
    workspaceRoot: root,
    workspaceId: 'workspace-1',
    clock: () => NOW,
    logger: SILENT_LOGGER,
    audit: new LearningAudit(root),
    stores,
    targets: makeTargets(),
    validatorPorts: makeValidatorPorts(),
  })
}

/** Minimal approved skill + S4 usage ledger in the workspace layout. */
function seedSkill(slug: string, usageTs: string, body = '# Skill\n\nDo the thing.\n'): void {
  const dir = join(root, 'skills', slug)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), body)
  writeFileSync(
    join(root, 'skills', '.usage.jsonl'),
    `${JSON.stringify({ ts: usageTs, skills: [slug] })}\n`,
  )
}

describe('GarbageCollector.collect', () => {
  const collector = new GarbageCollector({ clock: () => NOW })

  it('classifies lessons: contradicted, low_effectiveness, and stale', () => {
    const effectiveness = new Map([
      ['lesson:low', { targetType: 'lesson' as const, targetId: 'low', components: { successRate: 0.1, correctionRate: 0.9, conflictRate: 0, reuseRate: 0, confidence: 0.3 }, effectiveness: 0.12, sampleSize: 5, computedAt: '2026-10-01T00:00:00.000Z' }],
    ])
    const recommendations = collector.collect({
      now: NOW,
      effectiveness,
      lessons: [
        { rule: 'contradicted rule', scope: 'workspace', ts: OLD, conflicts: 2 },
        { rule: 'low', scope: 'workspace', ts: OLD, usageCount: 0 },
        { rule: 'old rule', scope: 'global', ts: OLD, usageCount: 0 },
        { rule: 'fresh rule', scope: 'workspace', ts: new Date(NOW - 1 * DAY).toISOString(), usageCount: 9 },
      ],
    })

    const byRule = new Map(recommendations.map((r) => [r.targetId, r]))
    expect(byRule.get('contradicted rule')?.reason).toBe('contradicted')
    expect(byRule.get('low')?.reason).toBe('low_effectiveness')
    expect(byRule.get('old rule')?.reason).toBe('stale')
    expect(byRule.has('fresh rule')).toBe(false)
  })

  it('recommends long-unused approved skills and skips unapproved ones', () => {
    const recommendations = collector.collect({
      now: NOW,
      skills: [
        { slug: 'unused-approved', uses: 0, lastUsedAt: OLD, approved: true },
        { slug: 'unused-pending', uses: 0, lastUsedAt: OLD, approved: false },
        { slug: 'busy', uses: 50, lastUsedAt: new Date(NOW - 1 * DAY).toISOString(), approved: true },
        { slug: 'never-used-approved', uses: 0, lastUsedAt: '', approved: true },
      ],
    })
    const slugs = recommendations.map((r) => r.targetId)
    expect(slugs).toContain('unused-approved')
    expect(slugs).not.toContain('unused-pending')
    expect(slugs).not.toContain('busy')
    expect(recommendations.find((r) => r.targetId === 'unused-approved')?.reason).toBe('low_use')
  })

  it('always recommends rolled-back policies for archive', () => {
    const recommendations = collector.collect({
      now: NOW,
      policies: [{ id: 'pol_1', updatedAt: OLD }],
    })
    expect(recommendations).toHaveLength(1)
    expect(recommendations[0]).toMatchObject({ targetType: 'policy', targetId: 'pol_1', reason: 'low_effectiveness' })
  })

  it('is deterministic and sorted by targetType, targetId, reason', () => {
    const input = {
      now: NOW,
      skills: [{ slug: 'z-skill', uses: 0, lastUsedAt: OLD, approved: true }],
      policies: [{ id: 'a-policy', updatedAt: OLD }],
    }
    const first = collector.collect(input)
    expect(collector.collect(input)).toEqual(first)
    const keys = first.map((r) => `${r.targetType}:${r.targetId}`)
    expect(keys).toEqual([...keys].sort())
    expect(first[0]?.targetType).toBe('policy')
  })
})

describe('GarbageCollector.apply', () => {
  const collector = new GarbageCollector({ clock: () => NOW })
  const recommendations: GarbageRecommendation[] = [
    { targetType: 'skill', targetId: 'a', reason: 'low_use', detail: 'x' },
    { targetType: 'policy', targetId: 'p', reason: 'low_effectiveness', detail: 'y' },
  ]

  it('archives nothing without an archive port', () => {
    expect(collector.apply(recommendations)).toBe(0)
    expect(collector.apply(recommendations, undefined)).toBe(0)
  })

  it('counts only targets the injected port accepts', () => {
    const port: GarbageArchivePort = { archiveLesson: () => false, archiveSkill: (slug) => slug === 'a' }
    expect(collector.apply(recommendations, port)).toBe(1)
  })
})

describe('LearningService.runGarbageCollection', () => {
  it('recommends from the real inventory, audits each one, and deletes nothing', async () => {
    const stores = makeStores()
    seedSkill('unused-approved', OLD)
    stores.policies.save({
      id: 'pol_rb',
      fingerprint: 'fp',
      taskClass: 'refactor',
      preferredSkills: [],
      verification: [],
      delegation: 'neutral',
      confidence: 0.5,
      evidence: [],
      status: 'rolled_back',
      createdAt: OLD,
      updatedAt: OLD,
    })
    const service = makeService(stores)

    const result = await service.runGarbageCollection('workspace-1')

    // No archive port exists on LearningTargetStores → archived stays 0.
    expect(result).toEqual({ archived: 0 })
    // ...and the approved skill is untouched on disk.
    expect(existsSync(join(root, 'skills', 'unused-approved', 'SKILL.md'))).toBe(true)

    const auditLines = readFileSync(join(learningDirFor(root), 'learning-audit.jsonl'), 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { action: string; actor: string; target: string; detail: string })
    const gcEntries = auditLines.filter((entry) => entry.action === 'garbage-collection')
    expect(gcEntries.length).toBeGreaterThanOrEqual(2)
    expect(gcEntries.every((entry) => entry.actor === 'learning')).toBe(true)
    const targets = gcEntries.map((entry) => entry.target)
    expect(targets).toContain('unused-approved')
    expect(targets).toContain('pol_rb')
  })
})