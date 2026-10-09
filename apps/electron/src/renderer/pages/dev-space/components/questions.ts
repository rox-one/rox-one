/**
 * С-10 question blocks (04-UI-SPEC §B.10, 03-SPEC-features §3, D8) — pure
 * projections over the `questions.json` artifact plus the fixed contracts the
 * surface and its tests share. No React here: one parser, one naming rule.
 *
 * The artifact document is written by `devSpace:generateQuestions` and mirrors
 * `DevSpaceGenerateQuestionsResult` (packages/shared/src/dev-space/types.ts):
 * `{ schemaVersion, repositoryId, snapshotId, generatedAt, blocks, security }`.
 */
import type {
  DevSpaceQuestion,
  DevSpaceQuestionBlock,
  DevSpaceQuestionBlockName,
  DevSpaceQuestionSource,
  DevSpaceQuestionWhy,
  DevSpaceSecuritySummary,
} from '@rox/shared/dev-space'
import { DEV_SPACE_QUESTIONS_PER_BLOCK } from '@rox/shared/dev-space'
import type { DynamicTourId, TargetId, TourDefinition } from '@/features/product-tour/contracts'

export interface DevSpaceQuestionsDocument {
  readonly schemaVersion: 1
  readonly repositoryId: string
  readonly snapshotId: string | null
  readonly generatedAt: number
  readonly blocks: readonly DevSpaceQuestionBlock[]
  readonly security: DevSpaceSecuritySummary
}

/** Canonical block order: обучение → фичи/улучшения → безопасность (§B.10). */
export const DEV_SPACE_QUESTION_BLOCK_ORDER: readonly DevSpaceQuestionBlockName[] = ['learn', 'features', 'security']

/** Literal column titles (never build keys dynamically). */
export const DEV_SPACE_QUESTION_BLOCK_KEYS: Record<DevSpaceQuestionBlockName, string> = {
  learn: 'devSpaceQuestions.block.learn',
  features: 'devSpaceQuestions.block.features',
  security: 'devSpaceQuestions.block.security',
}

/** The dev-space surface each block's questions are answered on (§B.10 tour target). */
export const DEV_SPACE_QUESTION_BLOCK_TARGETS: Record<DevSpaceQuestionBlockName, TargetId> = {
  learn: 'devspace.wiki.reader',
  features: 'devspace.codegraph.search',
  security: 'devspace.questions.block3',
}

/** «почему этот вопрос» inputs (§3.2) → literal label keys. */
export const DEV_SPACE_WHY_KEYS: Record<keyof DevSpaceQuestionWhy, string> = {
  profile: 'devSpaceQuestions.why.profile',
  repo: 'devSpaceQuestions.why.repo',
  signals: 'devSpaceQuestions.why.signals',
}

const WHY_FIELDS = ['profile', 'repo', 'signals'] as const

const EMPTY_SECURITY: DevSpaceSecuritySummary = {
  sbom: { status: 'unavailable', packageCount: 0 },
  cve: { status: 'skipped', vulnerabilityCount: 0 },
  reasons: [],
}

/** Type guard: the discriminant is the artifact's fixed block enum, kept as a narrowing seam. */
function isBlockName(value: unknown): value is DevSpaceQuestionBlockName {
  return value === 'learn' || value === 'features' || value === 'security'
}

function readWhy(value: unknown): DevSpaceQuestionWhy {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const record = value as Record<string, unknown>
  const why: { profile?: string; repo?: string; signals?: string } = {}
  for (const field of WHY_FIELDS) {
    const entry = record[field]
    if (typeof entry === 'string' && entry.trim()) why[field] = entry
  }
  return why
}

function readSource(value: unknown): DevSpaceQuestionSource | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (typeof record.kind !== 'string' || typeof record.ref !== 'string') return null
  return { kind: record.kind as DevSpaceQuestionSource['kind'], ref: record.ref }
}

/** One valid `DevSpaceQuestion`, or null when the entry is malformed (never a placeholder). */
function readQuestion(value: unknown): DevSpaceQuestion | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string' || typeof record.text !== 'string' || !isBlockName(record.block)) return null
  const source = readSource(record.source)
  if (!source) return null
  return { id: record.id, block: record.block, text: record.text, why: readWhy(record.why), source }
}

function readSecurity(value: unknown): DevSpaceSecuritySummary {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return EMPTY_SECURITY
  const record = value as Record<string, unknown>
  const sbom = typeof record.sbom === 'object' && record.sbom !== null ? record.sbom as Record<string, unknown> : {}
  const cve = typeof record.cve === 'object' && record.cve !== null ? record.cve as Record<string, unknown> : {}
  const reasons = Array.isArray(record.reasons) ? record.reasons.filter((entry): entry is string => typeof entry === 'string') : []
  return {
    sbom: {
      status: sbom.status === 'ok' ? 'ok' : 'unavailable',
      packageCount: typeof sbom.packageCount === 'number' ? sbom.packageCount : 0,
      ...(typeof sbom.reason === 'string' ? { reason: sbom.reason } : {}),
    },
    cve: {
      status: cve.status === 'ok' || cve.status === 'error' ? cve.status : 'skipped',
      vulnerabilityCount: typeof cve.vulnerabilityCount === 'number' ? cve.vulnerabilityCount : 0,
      ...(typeof cve.reason === 'string' ? { reason: cve.reason } : {}),
    },
    reasons,
  }
}

/**
 * Parse the `questions` artifact body. Returns null for a body that is not the
 * expected document (so the surface shows an honest error, not an empty block).
 * Malformed individual questions are dropped; the surviving blocks keep their
 * canonical order.
 */
export function parseDevSpaceQuestions(content: string): DevSpaceQuestionsDocument | null {
  let parsed: unknown
  try { parsed = JSON.parse(content) } catch { return null }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const body = parsed as Record<string, unknown>
  if (!Array.isArray(body.blocks)) return null
  const byBlock = new Map<DevSpaceQuestionBlockName, DevSpaceQuestion[]>()
  for (const entry of body.blocks) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue
    const blockRecord = entry as Record<string, unknown>
    if (!isBlockName(blockRecord.block)) continue
    const questions = Array.isArray(blockRecord.questions) ? blockRecord.questions : []
    const bucket = byBlock.get(blockRecord.block) ?? []
    for (const question of questions) {
      const parsedQuestion = readQuestion(question)
      if (parsedQuestion && parsedQuestion.block === blockRecord.block) bucket.push(parsedQuestion)
    }
    byBlock.set(blockRecord.block, bucket)
  }
  const blocks: DevSpaceQuestionBlock[] = []
  for (const block of DEV_SPACE_QUESTION_BLOCK_ORDER) {
    const questions = byBlock.get(block)
    if (!questions) continue
    blocks.push({ block, title: DEV_SPACE_QUESTION_BLOCK_KEYS[block], questions })
  }
  if (!blocks.length) return null
  return {
    schemaVersion: 1,
    repositoryId: typeof body.repositoryId === 'string' ? body.repositoryId : '',
    snapshotId: typeof body.snapshotId === 'string' ? body.snapshotId : null,
    generatedAt: typeof body.generatedAt === 'number' ? body.generatedAt : 0,
    blocks,
    security: readSecurity(body.security),
  }
}

/** A generated tour artifact projected to the ids the launcher needs. */
export interface DevSpaceGeneratedTour {
  readonly id: string
  readonly targets: readonly TargetId[]
}

/** Parse one `tour` artifact body (`TourDefinition` json); null when malformed. */
export function parseDevSpaceTourDefinition(content: string): TourDefinition | null {
  let parsed: unknown
  try { parsed = JSON.parse(content) } catch { return null }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const body = parsed as Record<string, unknown>
  if (typeof body.id !== 'string' || !Array.isArray(body.steps)) return null
  // The dynamic registry re-validates every field (`validateDynamicTourCatalogue`);
  // this boundary only asserts the named type after checking the fields it reads.
  return parsed as TourDefinition
}

/**
 * Deterministic generated-tour id for one block question (D9/D11 contract):
 * `DS-<block>-<n>` with a 1-based index, matching the `DynamicTourId`
 * template the tour catalogue validates against.
 */
export function devSpaceQuestionTourId(block: DevSpaceQuestionBlockName, indexInBlock: number): DynamicTourId {
  return `DS-${block}-${indexInBlock + 1}` as DynamicTourId
}

/** The surface the block's generated tour targets (`TargetId`, §B.10). */
export function devSpaceQuestionTarget(block: DevSpaceQuestionBlockName): TargetId {
  return DEV_SPACE_QUESTION_BLOCK_TARGETS[block]
}

/** True when this generated tour is the one a block question asks for (§B.10). */
export function matchesDevSpaceQuestionTour(tour: DevSpaceGeneratedTour, block: DevSpaceQuestionBlockName, indexInBlock: number): boolean {
  return tour.id === devSpaceQuestionTourId(block, indexInBlock) || tour.targets.includes(devSpaceQuestionTarget(block))
}

/** The tour to run for a free-form answer: the answer's surface first, else the first generated tour. */
export function pickDevSpaceAnswerTour(tours: readonly DevSpaceGeneratedTour[], answer: string): DevSpaceGeneratedTour | null {
  const mentioned = tours.find((tour) => tour.targets.some((target) => answer.includes(target)))
  return mentioned ?? tours[0] ?? null
}

/**
 * Honest badge for the SBOM/CVE half of block 3 (§B.10 «проверка выключена»):
 * a literal key or null when the scan is healthy.
 */
export function devSpaceSecurityBadgeKey(security: DevSpaceSecuritySummary): string | null {
  if (security.cve.status === 'skipped' && security.reasons.includes('cve-consent-denied')) return 'devSpaceQuestions.security.disabled'
  if (security.sbom.status === 'unavailable') return 'devSpaceQuestions.security.sbomUnavailable'
  if (security.cve.status === 'error') return 'devSpaceQuestions.security.cveError'
  return null
}

/** True when the generator refused to run for lack of model-connector consent. */
export function isDevSpaceQuestionsDenied(reasons: readonly string[]): boolean {
  return reasons.includes('model-connectors-consent-denied') || reasons.includes('consent-denied')
}

/** Expected quota per block (D8) — the surface reports a short block honestly. */
export { DEV_SPACE_QUESTIONS_PER_BLOCK }