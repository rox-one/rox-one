/**
 * D8 question-block generator (03-SPEC-features §3): quota, deterministic ids,
 * the `source` link and the transparent «почему этот вопрос» format (§3.2).
 */
import { describe, expect, it } from 'bun:test'
import { DEV_SPACE_QUESTIONS_PER_BLOCK, generateQuestionBlocks, roleLabel } from '../questions/blocks.ts'
import type { DevSpaceQuestionContext } from '../questions/blocks.ts'
import { profileFromEnvironment } from '../questions/context.ts'
import { getDefaultEnvironmentPrefs } from '@rox/shared/environment'
import type { EnvironmentPrefs } from '@rox/shared/environment'

const FULL_CONTEXT: DevSpaceQuestionContext = {
  profile: { answered: true, isDeveloper: true, relatedRoles: ['backend', 'devops'] },
  repo: { status: 'ready', snapshotId: `snapshot_${'a'.repeat(64)}`, dirty: true, fileCount: 42, totalBytes: 3072 },
  signals: { ci: true, ciWorkflows: 3 },
  security: { sbomAvailable: true, cveChecked: true },
}

describe('generateQuestionBlocks', () => {
  it('emits exactly three blocks of ten questions in the fixed order', () => {
    const blocks = generateQuestionBlocks(FULL_CONTEXT)
    expect(blocks.map(block => block.block)).toEqual(['learn', 'features', 'security'])
    for (const block of blocks) {
      expect(block.questions).toHaveLength(DEV_SPACE_QUESTIONS_PER_BLOCK)
      expect(block.title.length).toBeGreaterThan(0)
    }
    const ids = blocks.flatMap(block => block.questions.map(question => question.id))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('links every question to a source artifact kind/topic (§3.1)', () => {
    for (const block of generateQuestionBlocks(FULL_CONTEXT)) {
      for (const question of block.questions) {
        expect(question.source.kind.length).toBeGreaterThan(0)
        expect(question.source.ref.length).toBeGreaterThan(0)
        expect(question.text.length).toBeGreaterThan(0)
        // Every question carries at least one transparent «почему» fragment.
        expect(Object.keys(question.why).length).toBeGreaterThan(0)
      }
    }
  })

  it('builds the why from profile, repo context and working signals (§3.2)', () => {
    const [learn, features, security] = generateQuestionBlocks(FULL_CONTEXT)

    const entry = learn!.questions[0]!.why
    expect(entry.repo).toContain('статус ready')
    expect(entry.repo).toContain('42 файлов')
    expect(entry.repo).toContain('3.0 КБ')

    const roleDriven = learn!.questions[9]!.why
    expect(roleDriven.profile).toContain('разработчик')
    expect(roleDriven.profile).toContain('backend')

    const signalDriven = features!.questions[9]!.why
    expect(signalDriven.signals).toContain('незакоммиченные изменения')
    expect(signalDriven.signals).toContain('3 workflow')

    const securityDriven = security!.questions[6]!.why
    expect(securityDriven.signals).toContain('CVE-проверка выполнена')
  })

  it('degrades honestly: unknown profile/signals omit their why field', () => {
    const context: DevSpaceQuestionContext = {
      ...FULL_CONTEXT,
      profile: { answered: false, isDeveloper: null, relatedRoles: [] },
      repo: { ...FULL_CONTEXT.repo, dirty: null, fileCount: null, totalBytes: null },
      signals: { ci: null, ciWorkflows: null },
      security: { sbomAvailable: false, cveChecked: false },
    }
    const [learn, features, security] = generateQuestionBlocks(context)
    expect(learn!.questions[9]!.why.profile).toBeUndefined()
    expect(features!.questions[9]!.why.signals).toBeUndefined()
    expect(security!.questions[6]!.why.signals).toContain('недоступен (syft не найден)')
    // Repo context is always present (at least the catalog status).
    for (const block of [learn!, features!, security!]) {
      for (const question of block.questions) expect(question.why.repo).toBeDefined()
    }
  })

  it('is deterministic — same inputs yield byte-identical blocks (idempotency)', () => {
    expect(JSON.stringify(generateQuestionBlocks(FULL_CONTEXT)))
      .toBe(JSON.stringify(generateQuestionBlocks(FULL_CONTEXT)))
  })
})

describe('roleLabel / profileFromEnvironment', () => {
  it('labels an answered developer profile with related roles', () => {
    expect(roleLabel({ answered: true, isDeveloper: true, relatedRoles: ['ml'] })).toBe('разработчик (ml)')
    expect(roleLabel({ answered: true, isDeveloper: false, relatedRoles: [] })).toBe('не разработчик')
    expect(roleLabel({ answered: false, isDeveloper: null, relatedRoles: [] })).toBeNull()
  })

  it('projects EnvironmentPrefs.role, treating skipped/unanswered as absent', () => {
    const answered = getDefaultEnvironmentPrefs(0)
    answered.role = { status: 'answered', value: { isDeveloper: true, relatedRoles: ['frontend'] } }
    expect(profileFromEnvironment(answered)).toEqual({ answered: true, isDeveloper: true, relatedRoles: ['frontend'] })
    const skipped: EnvironmentPrefs = { ...answered, role: { status: 'skipped', value: null } }
    expect(profileFromEnvironment(skipped)).toEqual({ answered: false, isDeveloper: null, relatedRoles: [] })
  })
})