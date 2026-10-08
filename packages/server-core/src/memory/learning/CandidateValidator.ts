/**
 * PRD §37/§38 — deterministic candidate validation.
 *
 * Seven deterministic passes run in the fixed ValidationPassId order (PRD §37)
 * before any LLM judge is consulted:
 *
 *   duplicate → contradiction → scope → sensitive → evidence_count →
 *   repository_evidence → outcome_evidence → consistency
 *
 * Every pass is produced on every call (no short-circuit), never throws, and
 * never mutates the candidate. `promotable` is true only when every
 * deterministic pass agreed AND the ROX-computed confidence (`computeConfidence`
 * over recomputed components, never the model's estimate) clears the
 * type-appropriate minimum (PRD §39); a judge verdict of `reject` clears it as
 * well, since the judge is the final gate (PRD §37). The `validating` status
 * transition is the caller's concern — the validator only returns
 * `CandidateValidation`.
 *
 * Contradiction vocabulary: `parseConflicts`/`buildConflictPrompt`
 * (memory/lesson-graph) operate on an LLM reply text, not on precomputed
 * (candidate, existing-rule) pairs, so they are NOT reused here. The pass
 * composes two deterministic sources instead:
 *   - `detectProposalConflicts` from `@rox/shared/memory/proposals` — exact
 *     text match and `always …` vs `never …` polarity, on precomputed pairs;
 *   - a conservative subject+polarity rule for the remaining phrasing: a
 *     conflict is reported only when the polarity-stripped subjects of the two
 *     rules are IDENTICAL and exactly one of them is negative (explicit
 *     negation words or the stored `negative` flag from the rule store).
 */
import type {
  CandidateValidation,
  ConfidenceComponents,
  LearningCandidate,
  LearningCandidateType,
  LearningEvidenceType,
  LearningPromotionThresholds,
  LearningScope,
  TaskOutcome,
  ValidationPassResult,
} from '@rox/shared/memory/learning'
import { DEFAULT_LEARNING_THRESHOLDS, clamp01, computeConfidence, normalizeHypothesis } from '@rox/shared/memory/learning'
import { detectProposalConflicts } from '@rox/shared/memory/proposals'
import type { ValidateCandidateInput, ValidatorPorts } from './learning-types'

/**
 * Mirrors MemoryService SENSITIVE_RE / proposals credential vocabulary, with
 * `api key` (space-separated) accepted because the validator is the last gate
 * before durable promotion.
 */
const SENSITIVE_RE = /(\.ssh|\.pem$|\.key$|credential|secret|password|api[_\s-]?key|token)/i

const VALID_SCOPES: readonly LearningScope[] = ['global', 'workspace', 'project', 'session']

/** Weight used when an evidence row carries no usable weight (missing → 0.3). */
const DEFAULT_EVIDENCE_WEIGHT = 0.3

/** Confidence tolerance when re-deriving `candidate.confidence` (PRD §38). */
const CONFIDENCE_TOLERANCE = 1e-6

type ExistingRule = { rule: string; scope: 'global' | 'workspace'; negative?: boolean }

interface ResolvedEvidence {
  id: string
  type: LearningEvidenceType
  weight: number
  ref: string
}

// ---------------------------------------------------------------------------
// Evidence resolution
// ---------------------------------------------------------------------------

function finiteWeight(weight: unknown): number | undefined {
  return typeof weight === 'number' && Number.isFinite(weight) ? clamp01(weight) : undefined
}

/**
 * Resolve the candidate's evidence refs against the rows the caller passed.
 * A ref whose row is missing still contributes its snapshot (type/weight), so
 * partial evidence never throws and never silently drops the candidate's
 * declared support. Malformed candidates without refs fall back to the rows.
 */
function resolveEvidence(
  candidate: LearningCandidate,
  rows: ValidateCandidateInput['evidence'],
): ResolvedEvidence[] {
  const byId = new Map((rows ?? []).map(row => [row.id, row]))
  if (!Array.isArray(candidate.evidence) || candidate.evidence.length === 0) {
    return (rows ?? []).map(row => ({
      id: row.id,
      type: row.type,
      weight: finiteWeight(row.weight) ?? DEFAULT_EVIDENCE_WEIGHT,
      ref: row.ref,
    }))
  }
  const seen = new Set<string>()
  const resolved: ResolvedEvidence[] = []
  for (const ref of candidate.evidence) {
    if (seen.has(ref.evidenceId)) continue
    seen.add(ref.evidenceId)
    const row = byId.get(ref.evidenceId)
    resolved.push({
      id: ref.evidenceId,
      type: row?.type ?? ref.type,
      weight: finiteWeight(row?.weight) ?? finiteWeight(ref.weight) ?? DEFAULT_EVIDENCE_WEIGHT,
      ref: row?.ref ?? ref.ref,
    })
  }
  return resolved
}

// ---------------------------------------------------------------------------
// Repository-checkable vocabulary + signal matching
// ---------------------------------------------------------------------------

/** Tool / package-manager / structure terms a repository signal can confirm. */
const REPOSITORY_TERMS: readonly string[] = [
  'npm', 'yarn', 'pnpm', 'bun', 'deno', 'node', 'npmrc', 'cargo', 'pip', 'pipenv',
  'poetry', 'uv', 'conda', 'go mod', 'gomod', 'maven', 'gradle', 'dotnet', 'nuget',
  'gem', 'bundler', 'composer', 'swiftpm', 'cocoapods',
  'vitest', 'jest', 'mocha', 'pytest', 'playwright', 'cypress', 'eslint', 'biome',
  'prettier', 'oxlint', 'tsc', 'typescript', 'vite', 'webpack', 'esbuild', 'rollup',
  'turbo', 'nx', 'make', 'just', 'docker', 'dockerfile', 'compose', 'git', 'husky',
  'lint-staged', 'changesets', 'semantic-release',
  'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock',
  'bun.lockb', 'tsconfig', 'jsconfig', 'lockfile', 'lock file', 'workspace',
  'monorepo', 'workspaces', 'packages/', 'apps/', 'src/', 'tests/', 'test/',
  'scripts/', '.github', 'ci', 'pipeline', 'postinstall', 'prepare script',
  'agents.md', 'claude.md', 'readme', 'makefile', 'flake.nix', 'deno.json',
  'pyproject.toml', 'cargo.toml', 'go.mod', 'pom.xml',
]

/** Word-boundary match for plain alphanumeric terms, substring otherwise. */
function termMatches(haystack: string, term: string): boolean {
  // Alphanumeric-only terms need no regex escaping; punctuation terms match as substrings.
  if (/^[a-z0-9]+$/i.test(term)) return new RegExp(`\\b${term}\\b`, 'i').test(haystack)
  return haystack.toLowerCase().includes(term.toLowerCase())
}

/** Repository-checkable terms the hypothesis actually mentions. */
function repositoryKeywords(hypothesis: unknown): string[] {
  const hay = ` ${normalizeHypothesis(typeof hypothesis === 'string' ? hypothesis : '')} `
  const keywords = new Set<string>()
  for (const term of REPOSITORY_TERMS) {
    if (termMatches(hay, term)) keywords.add(term)
  }
  return [...keywords]
}

/** Signals (from ValidatorPorts.readRepositorySignals) matching any keyword. */
function matchingRepositorySignals(keywords: string[], signals: string[]): string[] {
  if (keywords.length === 0) return []
  const matches: string[] = []
  for (const signal of signals ?? []) {
    if (typeof signal !== 'string' || !signal.trim()) continue
    if (keywords.some(keyword => termMatches(signal, keyword))) matches.push(signal)
  }
  return matches
}

// ---------------------------------------------------------------------------
// Confidence components (PRD §38)
// ---------------------------------------------------------------------------

/** Deterministic status → outcome weight used by the outcome-support component. */
function outcomeSupportWeight(status: TaskOutcome['status']): number {
  if (status === 'success') return 1
  if (status === 'partial') return 0.5
  return 0 // failure + aborted
}

/**
 * Recompute the confidence components from stored evidence (PRD §38). The
 * model's own estimate is never an input; every component is derived here.
 * Pure and non-throwing: missing evidence rows, malformed weights and empty
 * repositories all map to the documented neutral values.
 *
 * consistency is derived from the candidate's stored duplicate pass: a
 * duplicate collision halves it (0.5), otherwise 1.
 */
export function computeConfidenceComponents(input: {
  candidate: LearningCandidate
  evidence: ValidateCandidateInput['evidence']
  repoSignals: string[]
  priorOutcomes: TaskOutcome[]
}): ConfidenceComponents {
  const { candidate } = input
  const resolved = resolveEvidence(candidate, input.evidence ?? [])

  const recurrence = Math.min(1, resolved.length / 5)
  const evidenceQuality = resolved.length === 0
    ? DEFAULT_EVIDENCE_WEIGHT
    : resolved.reduce((sum, item) => sum + item.weight, 0) / resolved.length

  const evidenceTypes = new Set(resolved.map(item => item.type))
  const userSignal = evidenceTypes.has('user_correction') ? 1 : evidenceTypes.has('session') ? 0.6 : 0.3

  const signals = Array.isArray(input.repoSignals) ? input.repoSignals : []
  const signalMatches = matchingRepositorySignals(repositoryKeywords(candidate.hypothesis), signals)
  const repositorySupport = signalMatches.length > 0 ? clamp01(0.4 + 0.2 * signalMatches.length) : 0.5

  const outcomes = Array.isArray(input.priorOutcomes) ? input.priorOutcomes : []
  const outcomeSupport = outcomes.length === 0
    ? 0.5
    : clamp01(outcomes.reduce((sum, outcome) => sum + outcomeSupportWeight(outcome.status), 0) / outcomes.length)

  const duplicateFailed = (candidate.validation?.passes ?? [])
    .some(pass => pass.pass === 'duplicate' && !pass.ok)

  return {
    recurrence: clamp01(recurrence),
    evidenceQuality: clamp01(evidenceQuality),
    userSignal,
    repositorySupport,
    outcomeSupport,
    consistency: duplicateFailed ? 0.5 : 1,
  }
}

// ---------------------------------------------------------------------------
// Passes 1-4: duplicate, contradiction, scope, sensitive (PRD §37)
// ---------------------------------------------------------------------------

const NEGATION_RE = /\b(never|don't|do not|doesn't|does not|avoid|must not|should not|no longer|not)\b/i
const POLARITY_TOKEN_RE = /\b(always|never|don't|do not|doesn't|does not|avoid|must|should|prefer|use|no longer|not)\b/g
const SUBJECT_NOISE_RE = /[^a-z0-9]+/g

/** Polarity-stripped subject of a rule — identical subjects mean same topic. */
function ruleSubject(text: unknown): string {
  const normalized = normalizeHypothesis(typeof text === 'string' ? text : '')
  return normalized.replace(POLARITY_TOKEN_RE, ' ').replace(SUBJECT_NOISE_RE, ' ').trim()
}

function ruleIsNegative(text: unknown, storedFlag: boolean | undefined): boolean {
  return storedFlag === true || (typeof text === 'string' && NEGATION_RE.test(text))
}

/**
 * Conservative subject+polarity conflict: same subject, opposite polarity.
 * Used for phrasing `detectProposalConflicts` does not cover (its polarity rule
 * only sees `always`/`never` prefixes). Text-identical pairs are duplicates, so
 * they can never contradict — the duplicate pass owns them.
 */
function subjectPolarityConflict(candidateText: string, existing: ExistingRule): string | undefined {
  const candidateSubject = ruleSubject(candidateText)
  const existingSubject = ruleSubject(existing.rule)
  if (!candidateSubject || candidateSubject !== existingSubject) return undefined
  if (normalizeHypothesis(candidateText) === normalizeHypothesis(existing.rule)) return undefined
  if (ruleIsNegative(candidateText, undefined) === ruleIsNegative(existing.rule, existing.negative)) return undefined
  return existing.rule
}

function duplicatePass(candidate: LearningCandidate, existingRules: ExistingRule[] | null): ValidationPassResult {
  if (existingRules === null) return { pass: 'duplicate', ok: false, detail: 'existing rules unavailable' }
  const needle = normalizeHypothesis(candidate.hypothesis ?? '')
  const hit = existingRules.find(rule => typeof rule.rule === 'string' && normalizeHypothesis(rule.rule) === needle)
  return hit
    ? { pass: 'duplicate', ok: false, detail: `already exists: ${hit.rule}` }
    : { pass: 'duplicate', ok: true }
}

function contradictionPass(candidate: LearningCandidate, existingRules: ExistingRule[] | null): ValidationPassResult {
  if (existingRules === null) return { pass: 'contradiction', ok: false, detail: 'existing rules unavailable' }
  const texts = existingRules.map(rule => rule.rule).filter((text): text is string => typeof text === 'string')
  // `subsumes` (exact text) belongs to the duplicate pass — only polarity collides here.
  const detected = detectProposalConflicts(candidate.hypothesis ?? '', texts).find(conflict => conflict.relation === 'contradicts')
  if (detected) {
    return { pass: 'contradiction', ok: false, detail: `contradicts existing rule: ${detected.existingRule}` }
  }
  for (const existing of existingRules) {
    const conflicting = subjectPolarityConflict(candidate.hypothesis ?? '', existing)
    if (conflicting) return { pass: 'contradiction', ok: false, detail: `contradicts existing rule: ${conflicting}` }
  }
  return { pass: 'contradiction', ok: true }
}

function scopePass(candidate: LearningCandidate): ValidationPassResult {
  if (!VALID_SCOPES.includes(candidate.scope)) {
    return { pass: 'scope', ok: false, detail: `invalid scope: ${String(candidate.scope)}` }
  }
  if (candidate.scope === 'session' && candidate.type === 'policy') {
    return { pass: 'scope', ok: false, detail: 'session-scope policy is not allowed' }
  }
  return { pass: 'scope', ok: true }
}

/** Payload rendered for secret scanning — strings verbatim, objects JSON. */
function payloadText(payload: unknown): string {
  if (typeof payload === 'string') return payload
  if (payload === null || payload === undefined) return ''
  try {
    return JSON.stringify(payload) ?? ''
  } catch {
    return ''
  }
}

function sensitivePass(candidate: LearningCandidate): ValidationPassResult {
  const hits: string[] = []
  if (SENSITIVE_RE.test(candidate.hypothesis ?? '')) hits.push('hypothesis')
  const payload = payloadText(candidate.payload)
  if (payload && SENSITIVE_RE.test(payload)) hits.push('payload')
  return hits.length > 0
    ? { pass: 'sensitive', ok: false, detail: `credential-like material referenced in ${hits.join(' and ')}` }
    : { pass: 'sensitive', ok: true }
}

// ---------------------------------------------------------------------------
// Passes 5-8: evidence_count, repository_evidence, outcome_evidence, consistency
// ---------------------------------------------------------------------------

/** Type → threshold pair. `preference` rides the lesson thresholds (§39). */
function thresholdKeys(type: LearningCandidateType): { evidence: keyof LearningPromotionThresholds; confidence: keyof LearningPromotionThresholds } {
  if (type === 'skill') return { evidence: 'skillMinEvidence', confidence: 'skillMinConfidence' }
  if (type === 'policy') return { evidence: 'policyMinEvidence', confidence: 'policyMinConfidence' }
  return { evidence: 'lessonMinEvidence', confidence: 'lessonMinConfidence' }
}

function evidenceCountPass(
  candidate: LearningCandidate,
  resolved: ResolvedEvidence[],
  thresholds: LearningPromotionThresholds,
): ValidationPassResult {
  const min = thresholds[thresholdKeys(candidate.type).evidence]
  const needed = typeof min === 'number' && Number.isFinite(min) ? min : 1
  return resolved.length >= needed
    ? { pass: 'evidence_count', ok: true }
    : { pass: 'evidence_count', ok: false, detail: `needs ${needed} distinct evidence item(s), has ${resolved.length}` }
}

function repositoryEvidencePass(
  candidate: LearningCandidate,
  resolved: ResolvedEvidence[],
  repoSignals: string[] | null,
): ValidationPassResult {
  const pass = 'repository_evidence' as const
  if (candidate.type !== 'lesson' && candidate.type !== 'preference') return { pass, ok: true, detail: 'not applicable' }
  const keywords = repositoryKeywords(candidate.hypothesis)
  if (keywords.length === 0) return { pass, ok: true, detail: 'not applicable' }
  const repositoryRows = resolved.filter(item => item.type === 'repository')
  if (repositoryRows.length > 0) return { pass, ok: true, detail: `${repositoryRows.length} repository evidence item(s)` }
  if (repoSignals === null) return { pass, ok: false, detail: 'repository signals unavailable' }
  const matches = matchingRepositorySignals(keywords, repoSignals)
  return matches.length > 0
    ? { pass, ok: true, detail: `matched repository signal(s): ${matches.join(', ')}` }
    : { pass, ok: false, detail: `no repository signal matches: ${keywords.join(', ')}` }
}

function outcomeEvidencePass(candidate: LearningCandidate, resolved: ResolvedEvidence[]): ValidationPassResult {
  const pass = 'outcome_evidence' as const
  const types = new Set(resolved.map(item => item.type))
  if (candidate.type === 'skill' || candidate.type === 'policy') {
    return types.has('successful_outcome') || types.has('test_result')
      ? { pass, ok: true }
      : { pass, ok: false, detail: `${candidate.type} evidence needs ≥1 successful_outcome or test_result item` }
  }
  if (candidate.type === 'lesson') {
    if (types.has('user_correction')) return { pass, ok: true, detail: 'user correction evidence' }
    const sessions = resolved.filter(item => item.type === 'session').length
    return sessions >= 2
      ? { pass, ok: true, detail: `${sessions} session observations` }
      : { pass, ok: false, detail: 'lesson needs ≥1 user_correction or ≥2 session observations' }
  }
  return { pass, ok: true, detail: 'not applicable' }
}

function consistencyPass(candidate: LearningCandidate, recomputed: number): ValidationPassResult {
  const pass = 'consistency' as const
  const stored = candidate.confidence
  if (!Number.isFinite(stored) || stored === 0) return { pass, ok: true, detail: 'no prior confidence' }
  return Math.abs(stored - recomputed) <= CONFIDENCE_TOLERANCE
    ? { pass, ok: true }
    : { pass, ok: false, detail: `stored confidence ${stored} != recomputed ${recomputed}` }
}

// ---------------------------------------------------------------------------
// LLM judge (PRD §37 — "Только потом LLM judge")
// ---------------------------------------------------------------------------

function buildJudgePrompt(candidate: LearningCandidate, resolved: ResolvedEvidence[]): string {
  const kinds = [...new Set(resolved.map(item => item.type))].join(', ') || 'none'
  return [
    `You are the final judge for a proposed durable ${candidate.type} (scope: ${candidate.scope}).`,
    '',
    `Proposed rule: ${candidate.hypothesis}`,
    `Evidence: ${resolved.length} item(s) [${kinds}].`,
    '',
    'Do the evidence items support promoting this rule as durable guidance?',
    'Reply with STRICT JSON only — no markdown fences, no prose:',
    '{"verdict":"support"|"reject"|"inconclusive","rationale":"<one short sentence>"}',
  ].join('\n')
}

/** Tolerant parse of the judge reply; malformed or garbage → undefined. */
function parseJudgeVerdict(reply: string): CandidateValidation['judged'] {
  if (typeof reply !== 'string' || !reply.trim()) return undefined
  let cleaned = reply.trim()
  const fence = cleaned.match(/```(?:json|JSON)?\s*([\s\S]*?)```/)
  if (fence && fence[1]) cleaned = fence[1].trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    return undefined
  }
  if (!parsed || typeof parsed !== 'object') return undefined
  const body = parsed as { verdict?: unknown; rationale?: unknown }
  if (body.verdict !== 'support' && body.verdict !== 'reject' && body.verdict !== 'inconclusive') return undefined
  const rationale = typeof body.rationale === 'string' && body.rationale.trim() ? body.rationale.trim() : undefined
  return rationale ? { verdict: body.verdict, rationale } : { verdict: body.verdict }
}

// ---------------------------------------------------------------------------
// CandidateValidator
// ---------------------------------------------------------------------------

/**
 * Deterministic validator for learning candidates (PRD §37). Ports are
 * injected; every port call is fail-soft (a throwing/unusable port yields an
 * explicit not-ok pass instead of an exception).
 */
export class CandidateValidator {
  private readonly ports: ValidatorPorts

  constructor(ports: ValidatorPorts) {
    this.ports = ports
  }

  async validate(input: ValidateCandidateInput): Promise<CandidateValidation> {
    // Sanitize once: a corrupt candidate must degrade into failed passes, never throw.
    const rawCandidate = input.candidate
    const candidate: LearningCandidate = {
      ...((rawCandidate ?? {}) as LearningCandidate),
      hypothesis: typeof rawCandidate?.hypothesis === 'string' ? rawCandidate.hypothesis : '',
      evidence: Array.isArray(rawCandidate?.evidence) ? rawCandidate.evidence : [],
    }
    const evidenceRows = Array.isArray(input.evidence) ? input.evidence : []
    // Caller thresholds ride over the defaults so a partial port cannot crash a pass.
    const thresholds: LearningPromotionThresholds = this.ports.thresholds
      ? { ...DEFAULT_LEARNING_THRESHOLDS, ...this.ports.thresholds }
      : DEFAULT_LEARNING_THRESHOLDS

    const existingRules = this.listExistingRulesSafe()
    const repoSignals = this.readRepositorySignalsSafe(input.workspaceRoot)
    const priorOutcomes = input.taskFingerprint ? this.listOutcomesSafe(input.taskFingerprint) : []

    const resolved = resolveEvidence(candidate, evidenceRows)
    const components = computeConfidenceComponents({
      candidate,
      evidence: evidenceRows,
      repoSignals: repoSignals ?? [],
      priorOutcomes,
    })
    const confidence = computeConfidence(components)

    // Exact pass order per ValidationPassId (PRD §37) — all passes always run.
    const passes: ValidationPassResult[] = [
      duplicatePass(candidate, existingRules),
      contradictionPass(candidate, existingRules),
      scopePass(candidate),
      sensitivePass(candidate),
      evidenceCountPass(candidate, resolved, thresholds),
      repositoryEvidencePass(candidate, resolved, repoSignals),
      outcomeEvidencePass(candidate, resolved),
      consistencyPass(candidate, confidence),
    ]

    const minConfidence = thresholds[thresholdKeys(candidate.type).confidence]
    const threshold = typeof minConfidence === 'number' && Number.isFinite(minConfidence) ? minConfidence : 1
    const promotable = passes.every(pass => pass.ok) && confidence >= threshold

    const validation: CandidateValidation = { passes, promotable, checkedAt: new Date().toISOString() }

    if (typeof input.judge === 'function') {
      const judged = await this.runJudgeSafe(input.judge, candidate, resolved)
      if (judged) {
        validation.judged = judged
        // The judge is the final gate (PRD §37): a rejection blocks promotion.
        if (judged.verdict === 'reject') validation.promotable = false
      }
    }

    return validation
  }

  /** Judge failures never fail validation — the verdict is simply absent. */
  private async runJudgeSafe(
    judge: NonNullable<ValidateCandidateInput['judge']>,
    candidate: LearningCandidate,
    resolved: ResolvedEvidence[],
  ): Promise<CandidateValidation['judged']> {
    try {
      return parseJudgeVerdict(await judge(buildJudgePrompt(candidate, resolved)))
    } catch {
      return undefined
    }
  }

  private listExistingRulesSafe(): ExistingRule[] | null {
    try {
      const rules = this.ports.listExistingRules()
      return Array.isArray(rules) ? rules : null
    } catch {
      return null
    }
  }

  private readRepositorySignalsSafe(workspaceRoot: string): string[] | null {
    try {
      const signals = this.ports.readRepositorySignals(workspaceRoot)
      return Array.isArray(signals) ? signals : null
    } catch {
      return null
    }
  }

  private listOutcomesSafe(fingerprint: string): TaskOutcome[] {
    try {
      const outcomes = this.ports.listOutcomesByFingerprint(fingerprint)
      return Array.isArray(outcomes) ? outcomes : []
    } catch {
      return []
    }
  }
}