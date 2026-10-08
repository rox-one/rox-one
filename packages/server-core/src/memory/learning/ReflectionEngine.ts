/**
 * ReflectionEngine — LLM reflection over one session's evidence (PRD §36–§40).
 *
 * Reflection is deliberately separate from distillation: it sees more than the
 * transcript (runtime trace, tool outcomes, memory/skill usage, user
 * corrections, verification, git diff) and is allowed to REJECT a hypothesis it
 * cannot back with evidence — `rejectedHypotheses` is what keeps the candidate
 * store from filling up with plausible noise.
 *
 * Fail-soft by contract: `reflect()` never throws; a missing or failing
 * distiller yields an empty result.
 */
import type { LearningCandidateType, LearningEvidenceType, LearningObservation, LearningScope } from '@rox/shared/memory/learning'
import { clamp01 } from '@rox/shared/memory/learning'
import type { ReflectionContext, ReflectionHypothesis, ReflectionResult } from './learning-types'

export interface ReflectionEngineDeps {
  /** One-shot LLM call (prompt, optional session id) → raw text reply. */
  distiller?: (prompt: string, sessionId?: string) => Promise<string>
  logger?: { warn: (message: string, error?: unknown) => void }
}

/** Static JSON enums mirrored from the frozen contracts, used as runtime guards. */
const CANDIDATE_TYPES: Record<string, true> = { lesson: true, skill: true, preference: true, policy: true }
const SCOPES: Record<string, true> = { global: true, workspace: true, project: true, session: true }
const EVIDENCE_TYPES: Record<string, true> = {
  session: true,
  user_correction: true,
  successful_outcome: true,
  failed_outcome: true,
  tool_trace: true,
  git_diff: true,
  test_result: true,
  skill_usage: true,
  memory_usage: true,
  repository: true,
  recurrence: true,
}

const RESPONSE_SHAPE =
  `Return ONLY valid JSON of the shape:\n` +
  `{"hypotheses":[{"type":"lesson"|"skill"|"preference"|"policy",` +
  `"scope":"global"|"workspace"|"project"|"session","hypothesis":string,` +
  `"category"?:string,"payload"?:unknown,` +
  `"evidenceRefs":[{"type":"session"|"user_correction"|"successful_outcome"|"failed_outcome"|"tool_trace"|"git_diff"|"test_result"|"skill_usage"|"memory_usage"|"repository"|"recurrence",` +
  `"ref":string,"weight":number}],"confidence_estimate"?:number}],"rejectedHypotheses":[{"hypothesis":string,"reason":string}]}\n` +
  `Every hypothesis needs at least one concrete evidenceRef with weight 0..1. ` +
  `Use rejectedHypotheses for anything that looks like a learning signal but lacks evidence. ` +
  `Set confidence_estimate only as your own 0..1 guess — ROX audits it and never treats it as confidence.`

/**
 * Render the PRD §36 reflection prompt: every available evidence section, in a
 * fixed order, then the strict JSON reply shape. Absent sections are skipped —
 * never rendered as `undefined`.
 */
export function buildReflectionPrompt(input: { observation: LearningObservation; context: ReflectionContext }): string {
  const { observation, context } = input
  const sections: string[] = []
  const add = (heading: string, body: string): void => {
    if (body.trim().length === 0) return
    sections.push(`${heading}:\n${body}`)
  }

  add('Session transcript', context.transcript ?? '')
  add('Runtime trace', context.runtimeTrace ?? '')
  add('Tool outcomes', context.toolOutcomes ?? '')

  const memoryLines: string[] = []
  const lessons = observation.memory?.lessonsInjected
  if (Array.isArray(lessons)) {
    for (const lesson of lessons) memoryLines.push(`- lesson [${lesson.scope}] ${lesson.rule}`)
  }
  const episodes = observation.memory?.episodesRecalled
  if (Array.isArray(episodes)) {
    for (const episode of episodes) memoryLines.push(`- episode ${episode.kind}: ${episode.id}`)
  }
  const injectedSkills = observation.memory?.skillsInjected
  if (Array.isArray(injectedSkills) && injectedSkills.length > 0) {
    memoryLines.push(`- skills injected: ${injectedSkills.join(', ')}`)
  }
  add('Memory used', memoryLines.join('\n'))

  add('Skills used', Array.isArray(observation.execution?.skills) ? observation.execution.skills.join(', ') : '')

  const seenCorrectionIds = new Set<string>()
  const correctionLines: string[] = []
  const correctionLists = [observation.signals?.userCorrections, context.userCorrections]
  for (const list of correctionLists) {
    if (!Array.isArray(list)) continue
    for (const correction of list) {
      if (seenCorrectionIds.has(correction.id)) continue
      seenCorrectionIds.add(correction.id)
      correctionLines.push(`- "${correction.original}" → "${correction.corrected}" (${correction.category})`)
    }
  }
  add('User corrections', correctionLines.join('\n'))

  add('Verification', renderVerification(context.verification ?? observation.signals?.verification))
  add('Git diff', context.gitDiffSummary ?? '')

  return (
    `You are ROX reflection for a coding agent. Review the session evidence below and propose durable learning hypotheses.\n\n` +
    (sections.length > 0 ? `${sections.join('\n\n')}\n\n` : '') +
    RESPONSE_SHAPE
  )
}

function renderVerification(verification: LearningObservation['signals']['verification']): string {
  if (!verification) return ''
  const lines: string[] = []
  if (typeof verification.testsPassed === 'number' || typeof verification.testsFailed === 'number') {
    lines.push(`- tests: ${verification.testsPassed ?? 0} passed, ${verification.testsFailed ?? 0} failed`)
  }
  if (verification.buildPassed !== undefined) lines.push(`- build: ${verification.buildPassed ? 'passed' : 'failed'}`)
  if (verification.lintPassed !== undefined) lines.push(`- lint: ${verification.lintPassed ? 'passed' : 'failed'}`)
  if (verification.typecheckPassed !== undefined) {
    lines.push(`- typecheck: ${verification.typecheckPassed ? 'passed' : 'failed'}`)
  }
  return lines.join('\n')
}

export class ReflectionEngine {
  private readonly distiller: ((prompt: string, sessionId?: string) => Promise<string>) | undefined
  private readonly logger: { warn: (message: string, error?: unknown) => void }
  private warnedNoDistiller = false

  constructor(deps: ReflectionEngineDeps = {}) {
    this.distiller = deps.distiller
    this.logger = deps.logger ?? { warn: () => {} }
  }

  /**
   * Reflect over one observation. Never throws: a missing distiller, a
   * distiller error, or two invalid replies all yield an empty result.
   */
  async reflect(input: {
    observation: LearningObservation
    context: ReflectionContext
    sessionId?: string
  }): Promise<ReflectionResult> {
    const label = input.sessionId ?? input.observation?.id ?? 'unknown'
    try {
      if (!this.distiller) {
        if (!this.warnedNoDistiller) {
          this.warnedNoDistiller = true
          this.logger.warn('ReflectionEngine: no distiller configured — skipping reflection')
        }
        return { hypotheses: [], rejectedHypotheses: [] }
      }

      const prompt = buildReflectionPrompt({ observation: input.observation, context: input.context })
      let result = parseReflectionResult(await this.distiller(prompt, input.sessionId))
      if (!result) {
        // One retry with a harder JSON-only instruction (same as distillation).
        result = parseReflectionResult(await this.distiller(`${prompt}\nReturn only valid JSON`, input.sessionId))
      }
      if (!result) {
        this.logger.warn(`ReflectionEngine: distiller returned invalid JSON twice for ${label}`)
        return { hypotheses: [], rejectedHypotheses: [] }
      }
      return result
    } catch (error) {
      this.logger.warn(`ReflectionEngine: reflection failed for ${label}`, error)
      return { hypotheses: [], rejectedHypotheses: [] }
    }
  }
}

/**
 * Parse a reflection reply into a validated result. Returns null only when the
 * reply is not JSON or not an object carrying at least one hypothesis list;
 * malformed individual entries are dropped, never thrown over.
 */
export function parseReflectionResult(raw: string): ReflectionResult | null {
  if (typeof raw !== 'string') return null
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()
  if (stripped.length === 0) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(stripped)
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object') return null

  const hypothesesRaw = 'hypotheses' in parsed && Array.isArray(parsed.hypotheses) ? parsed.hypotheses : undefined
  const rejectedRaw =
    'rejectedHypotheses' in parsed && Array.isArray(parsed.rejectedHypotheses) ? parsed.rejectedHypotheses : undefined
  if (!hypothesesRaw && !rejectedRaw) return null

  const hypotheses: ReflectionHypothesis[] = []
  for (const entry of hypothesesRaw ?? []) {
    const hypothesis = toHypothesis(entry)
    if (hypothesis) hypotheses.push(hypothesis)
  }

  const rejectedHypotheses: ReflectionResult['rejectedHypotheses'] = []
  for (const entry of rejectedRaw ?? []) {
    if (entry === null || typeof entry !== 'object') continue
    const hypothesis = 'hypothesis' in entry ? entry.hypothesis : undefined
    const reason = 'reason' in entry ? entry.reason : undefined
    if (typeof hypothesis !== 'string' || hypothesis.trim().length === 0) continue
    if (typeof reason !== 'string' || reason.trim().length === 0) continue
    rejectedHypotheses.push({ hypothesis, reason })
  }

  return { hypotheses, rejectedHypotheses }
}

function toHypothesis(value: unknown): ReflectionHypothesis | null {
  if (value === null || typeof value !== 'object') return null

  const type = 'type' in value ? value.type : undefined
  if (!isCandidateType(type)) return null
  const scope = 'scope' in value ? value.scope : undefined
  if (!isScope(scope)) return null
  const hypothesis = 'hypothesis' in value ? value.hypothesis : undefined
  if (typeof hypothesis !== 'string' || hypothesis.trim().length === 0) return null

  const result: ReflectionHypothesis = {
    type,
    scope,
    hypothesis,
    evidenceRefs: toEvidenceRefs('evidenceRefs' in value ? value.evidenceRefs : undefined),
  }
  const category = 'category' in value ? value.category : undefined
  if (typeof category === 'string' && category.trim().length > 0) result.category = category
  if ('payload' in value && value.payload !== undefined) result.payload = value.payload
  const estimate = 'confidence_estimate' in value ? value.confidence_estimate : undefined
  if (typeof estimate === 'number' && Number.isFinite(estimate)) result.modelConfidenceEstimate = clamp01(estimate)
  return result
}

function toEvidenceRefs(value: unknown): ReflectionHypothesis['evidenceRefs'] {
  if (!Array.isArray(value)) return []
  const refs: ReflectionHypothesis['evidenceRefs'] = []
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object') continue
    const type = 'type' in entry ? entry.type : undefined
    const ref = 'ref' in entry ? entry.ref : undefined
    if (!isEvidenceType(type) || typeof ref !== 'string' || ref.trim().length === 0) continue
    const weight = 'weight' in entry ? entry.weight : undefined
    refs.push({
      type,
      ref,
      weight: typeof weight === 'number' && Number.isFinite(weight) ? clamp01(weight) : 0,
    })
  }
  return refs
}

/** Type guards preserve narrowing over untyped JSON (`in` + typeof, no casts). */
function isCandidateType(value: unknown): value is LearningCandidateType {
  return typeof value === 'string' && CANDIDATE_TYPES[value] === true
}

function isScope(value: unknown): value is LearningScope {
  return typeof value === 'string' && SCOPES[value] === true
}

function isEvidenceType(value: unknown): value is LearningEvidenceType {
  return typeof value === 'string' && EVIDENCE_TYPES[value] === true
}