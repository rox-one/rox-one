import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEV_SPACE_QUESTION_BLOCK_KEYS,
  DEV_SPACE_QUESTION_BLOCK_TARGETS,
  devSpaceQuestionTarget,
  devSpaceQuestionTourId,
  devSpaceSecurityBadgeKey,
  isDevSpaceQuestionsDenied,
  matchesDevSpaceQuestionTour,
  parseDevSpaceQuestions,
  parseDevSpaceTourDefinition,
  pickDevSpaceAnswerTour,
} from '../components/questions'

const questionsDir = join(__dirname, '..')
const componentsDir = join(questionsDir, 'components')
const read = (...parts: string[]) => readFileSync(join(...parts), 'utf8')
const surface = read(componentsDir, 'QuestionsSurface.tsx')
const composer = read(componentsDir, 'AskQuestionComposer.tsx')
const page = read(questionsDir, 'DevSpaceRepoPage.tsx')
const helpers = read(componentsDir, 'questions.ts')
const launcher = read(componentsDir, 'useDevSpaceTourLauncher.ts')
const toursHook = read(componentsDir, 'useDevSpaceGeneratedTours.ts')

const documentBody = JSON.stringify({
  schemaVersion: 1,
  repositoryId: 'repo_1',
  snapshotId: 'sha1',
  generatedAt: 42,
  blocks: [
    { block: 'security', title: 'ignored', questions: [{ id: 's1', block: 'security', text: 'CVE?', why: { signals: 'dirty' }, source: { kind: 'sbom-cve', ref: 'cve' } }] },
    {
      block: 'learn',
      title: 'ignored',
      questions: [
        { id: 'l1', block: 'learn', text: 'Where is the entry point?', why: { profile: 'backend', repo: 'typescript' }, source: { kind: 'wiki', ref: 'repo-wiki' } },
        { id: 'l2', block: 'learn', text: '', why: {}, source: { kind: 'wiki', ref: 'repo-wiki' } },
        { id: 'broken' },
      ],
    },
  ],
  security: { sbom: { status: 'ok', packageCount: 12 }, cve: { status: 'skipped', vulnerabilityCount: 0, reason: 'consent' }, reasons: ['cve-consent-denied'] },
})

describe('questions artifact projection (D8)', () => {
  it('parses blocks in canonical order and drops malformed questions', () => {
    const parsed = parseDevSpaceQuestions(documentBody)
    expect(parsed).not.toBeNull()
    expect(parsed!.blocks.map((block) => block.block)).toEqual(['learn', 'security'])
    expect(parsed!.blocks[0]!.questions.map((question) => question.id)).toEqual(['l1', 'l2'])
    expect(parsed!.blocks[0]!.questions[0]!.why).toEqual({ profile: 'backend', repo: 'typescript' })
    expect(parsed!.blocks[0]!.questions[0]!.source).toEqual({ kind: 'wiki', ref: 'repo-wiki' })
    expect(parsed!.security.sbom.packageCount).toBe(12)
  })

  it('returns null for bodies that are not the questions document', () => {
    expect(parseDevSpaceQuestions('not json')).toBeNull()
    expect(parseDevSpaceQuestions('{"schemaVersion":1}')).toBeNull()
    expect(parseDevSpaceQuestions('{"blocks":[]}')).toBeNull()
  })
})

describe('generated tour contract (D9/D11)', () => {
  it('names a block question tour DS-<block>-<n> with a 1-based index', () => {
    expect(devSpaceQuestionTourId('learn', 0)).toBe('DS-learn-1')
    expect(devSpaceQuestionTourId('security', 9)).toBe('DS-security-10')
  })

  it('maps each block to its dev-space surface', () => {
    expect(devSpaceQuestionTarget('learn')).toBe(DEV_SPACE_QUESTION_BLOCK_TARGETS.learn)
    expect(devSpaceQuestionTarget('features')).toBe('devspace.codegraph.search')
    expect(devSpaceQuestionTarget('security')).toBe('devspace.questions.block3')
  })

  it('matches a tour by id or by the surface it targets', () => {
    expect(matchesDevSpaceQuestionTour({ id: 'DS-learn-1', targets: [] }, 'learn', 0)).toBe(true)
    expect(matchesDevSpaceQuestionTour({ id: 'DS-other-7', targets: ['devspace.wiki.reader'] as const }, 'learn', 3)).toBe(true)
    expect(matchesDevSpaceQuestionTour({ id: 'DS-other-7', targets: ['devspace.c4.viewer'] as const }, 'learn', 3)).toBe(false)
  })

  it('reads TourDefinition artifacts and picks the answer tour by mentioned surface', () => {
    const tour = parseDevSpaceTourDefinition('{"id":"DS-learn-1","steps":[{"target":"devspace.wiki.reader"}]}')
    expect(tour?.id).toBe('DS-learn-1')
    expect(tour?.steps.map((step) => step.target)).toEqual(['devspace.wiki.reader'])
    expect(parseDevSpaceTourDefinition('{}')).toBeNull()
    const fallback = { id: 'DS-fallback-1', targets: ['devspace.questions.block1'] as const }
    expect(pickDevSpaceAnswerTour([fallback], 'see devspace.wiki.reader for details')).toEqual(fallback)
    expect(pickDevSpaceAnswerTour([], 'anything')).toBeNull()
  })
})

describe('security block honesty (D6/D8)', () => {
  it('marks the CVE scan disabled under missing consent', () => {
    expect(devSpaceSecurityBadgeKey({ sbom: { status: 'ok', packageCount: 3 }, cve: { status: 'skipped', vulnerabilityCount: 0 }, reasons: ['cve-consent-denied'] })).toBe('devSpaceQuestions.security.disabled')
    expect(devSpaceSecurityBadgeKey({ sbom: { status: 'unavailable', packageCount: 0 }, cve: { status: 'ok', vulnerabilityCount: 1 }, reasons: ['syft-unavailable'] })).toBe('devSpaceQuestions.security.sbomUnavailable')
    expect(devSpaceSecurityBadgeKey({ sbom: { status: 'ok', packageCount: 3 }, cve: { status: 'ok', vulnerabilityCount: 1 }, reasons: [] })).toBeNull()
  })

  it('recognises a denied generator run', () => {
    expect(isDevSpaceQuestionsDenied(['model-connectors-consent-denied'])).toBe(true)
    expect(isDevSpaceQuestionsDenied([])).toBe(false)
  })
})

describe('С-10 UI contracts (04-UI-SPEC §B.10)', () => {
  it('uses literal devSpaceQuestions.* keys and never builds keys dynamically', () => {
    const surfaceKeys = [
      'devSpaceQuestions.tab', 'devSpaceQuestions.title', 'devSpaceQuestions.stale',
      'devSpaceQuestions.recalculate', 'devSpaceQuestions.recalculating', 'devSpaceQuestions.retry',
      'devSpaceQuestions.emptyTitle', 'devSpaceQuestions.emptyDescription', 'devSpaceQuestions.emptyAction',
      'devSpaceQuestions.error', 'devSpaceQuestions.denied', 'devSpaceQuestions.deniedReason', 'devSpaceQuestions.count',
      'devSpaceQuestions.blockPending',
      'devSpaceQuestions.why.toggle', 'devSpaceQuestions.why.source', 'devSpaceQuestions.answerText',
      'devSpaceQuestions.watchTour', 'devSpaceQuestions.tourUnavailable', 'devSpaceQuestions.answerLoading',
      'devSpaceQuestions.answerUnavailable', 'devSpaceQuestions.security.note',
      'devSpaceQuestions.block.learn', 'devSpaceQuestions.block.features', 'devSpaceQuestions.block.security',
      'devSpaceQuestions.why.profile', 'devSpaceQuestions.why.repo', 'devSpaceQuestions.why.signals',
    ]
    const all = `${surface}\n${helpers}\n${page}`
    for (const key of surfaceKeys) expect(all).toContain(`'${key}'`)
    for (const [block, key] of Object.entries(DEV_SPACE_QUESTION_BLOCK_KEYS)) expect(key).toBe(`devSpaceQuestions.block.${block}`)
    expect(surface).not.toMatch(/t\(`/)
  })

  it('renders three columns, the why disclosure, answer and tour actions', () => {
    expect(surface).toContain('lg:grid-cols-3')
    expect(surface).toContain('data-testid="dev-space-questions-grid"')
    expect(surface).toContain('data-testid={`dev-space-questions-block-${column.block}`}')
    expect(surface).toContain('data-testid={`dev-space-question-why-body-${question.id}`}')
    expect(surface).toContain('data-testid={`dev-space-question-answer-${question.id}`}')
    expect(surface).toContain('data-testid={`dev-space-question-tour-${question.id}`}')
    expect(surface).toContain("onKeyDown={handleGridKeyDown}")
    expect(surface).toContain("from '@/components/markdown'")
  })

  it('recalculates through the generate channel and re-reads existing artifacts', () => {
    expect(surface).toContain('window.electronAPI.generateDevSpaceQuestions({ workspaceId, repositoryId })')
    expect(surface).toContain('window.electronAPI.readDevSpaceArtifact')
    expect(helpers).toContain('parseDevSpaceQuestions')
    expect(surface).toContain("artifact.kind === 'questions'")
    expect(page).toContain('useDevSpaceGeneratedTours')
    expect(page).toContain('useDevSpaceTourLauncher')
  })

  it('launches generated tours only through the product-tour public controller', () => {
    expect(launcher).toContain("from '@/features/product-tour/runtime'")
    expect(launcher).toContain('useProductLearning')
    expect(launcher).toContain('learning?.start(tourId as TourId)')
    expect(page).toContain('tourLauncher.start(tour.id)')
    // The offered tours are the registered ones: the same public seam `start(id)` resolves.
    expect(toursHook).toContain("from '@/features/product-tour/runtime'")
    expect(toursHook).toContain('registerDynamicTour(definition)')
    expect(toursHook).toContain('parseDevSpaceTourDefinition')
  })

  it('binds «свой вопрос» to an ordinary repo session through the standard composer', () => {
    expect(page).toContain('<AskQuestionComposer')
    expect(composer).toContain("'devSpace.ask.title'")
    expect(composer).toContain("from '@/components/app-shell/input'")
    expect(composer).toContain('<FreeFormInput')
    expect(composer).toContain('window.electronAPI.createSession(workspaceId')
    expect(composer).toContain('window.electronAPI.sendMessage')
    expect(composer).toContain('window.electronAPI.getSessions()')
    expect(composer).toContain('projectId')
    expect(composer).toContain("'devSpace.ask.showOnScreens'")
    expect(composer).toContain("'devSpace.ask.openSession'")
    expect(composer).toContain('navigate.navigateToSession(sessionId)')
    expect(composer).not.toContain('new Promise(')
  })
})