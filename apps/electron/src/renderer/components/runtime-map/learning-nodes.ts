/**
 * Learning nodes for the runtime map — PRD §30.
 *
 * PRD §30 asks the live map to carry five first-class learning kinds —
 * `Memory`, `Skill`, `Policy`, `Evidence`, `Outcome` — and shows the evolution
 * chain `Skill: auth-debug → Session #183 → user correction → Candidate v2 →
 * Test validation → Success +23%`.
 *
 * This module is the pure, DOM-free half of that feature:
 *
 *  - `LEARNING_NODE_REGISTRY` registers the five kinds with stable
 *    code-constant labels. The map's `runtimeMap.kind.*` locale entries live
 *    outside this package, so learning labels are not routed through i18n; the
 *    renderer falls back to these constants.
 *  - `deriveLearningMap` turns the real learning DTOs
 *    (`@rox/shared/memory/learning`) into the documented chain with
 *    deterministic node ids, labels and edges. It reads no runtime state and
 *    fabricates no events: the same input always yields the same output.
 *
 * Live source: `learning-overlay.ts` reads the read-only `learning:*` RPC
 * surface (failing soft when a host has no learning API), and
 * `mergeLearningOverlay` adds these nodes and their causal edges to the map's
 * effective node set alongside the event-derived ones. `deriveLearningMap`
 * returns a dedicated view model instead of inventing synthetic
 * `RuntimeNode`s/`RuntimeEvent`s for state the trace never observed.
 */
import type { RuntimeGraphEdge } from '@rox/core/runtime-trace'
import type {
  EvidenceRef,
  LearningCandidate,
  LearningCandidateType,
  LearningEvidence,
  LearningEvidenceType,
  LearningMutation,
  LearningPolicy,
  TaskOutcome,
  UserCorrection,
} from '@rox/shared/memory/learning'

/** PRD §30 — the five learning node kinds, in registry order. */
export const LEARNING_NODE_KINDS = ['memory', 'skill', 'policy', 'evidence', 'outcome'] as const
export type LearningNodeKind = (typeof LEARNING_NODE_KINDS)[number]

export interface LearningNodeKindMeta {
  readonly kind: LearningNodeKind
  /** Stable code-constant label used when the map has no locale entry. */
  readonly label: string
  /** PRD §30 role of the kind in the evolution chain. */
  readonly description: string
}

/** Single source of truth for the five learning kinds added to the map (PRD §30). */
export const LEARNING_NODE_REGISTRY: Readonly<Record<LearningNodeKind, LearningNodeKindMeta>> = Object.freeze({
  memory: { kind: 'memory', label: 'Memory', description: 'Durable lesson or preference memory (PRD §3.2).' },
  skill: { kind: 'skill', label: 'Skill', description: 'Durable skill and its candidate revisions (PRD §28).' },
  policy: { kind: 'policy', label: 'Policy', description: 'Learned orchestration policy for a task class (PRD §3.7).' },
  evidence: { kind: 'evidence', label: 'Evidence', description: 'Session, user correction or test result backing a candidate (PRD §3.3).' },
  outcome: { kind: 'outcome', label: 'Outcome', description: 'Comparable-task result confirming or contradicting a candidate (PRD §3.5).' },
})

export function isLearningNodeKind(value: string): value is LearningNodeKind {
  return (LEARNING_NODE_KINDS as readonly string[]).includes(value)
}

export function learningNodeLabel(kind: LearningNodeKind): string {
  return LEARNING_NODE_REGISTRY[kind].label
}

/** PRD §30 chain steps; `durable` is the existing entity a candidate revises. */
export const LEARNING_CHAIN_ROLES = ['durable', 'session', 'correction', 'candidate', 'validation', 'outcome'] as const
export type LearningChainRole = (typeof LEARNING_CHAIN_ROLES)[number]

/** A learning map node. Shaped so a future map data source can project it 1:1. */
export interface LearningMapNode {
  /** Deterministic id: `learning:<kind>:<ref>` / `learning:candidate:<id>` / `learning:outcome:<id>`. */
  id: string
  kind: LearningNodeKind
  role: LearningChainRole
  /** Deterministic human label, e.g. `Skill: auth-debug`, `Candidate v2`. */
  label: string
  subtitle?: string
  /** Ids of the learning DTO(s) this node was derived from — never producer text. */
  provenance: { candidateId?: string; evidenceId?: string; outcomeId?: string }
}

export interface LearningMapEdge {
  id: string
  source: string
  target: string
  /** Reuses the runtime graph edge vocabulary so both graphs can be merged later. */
  kind: RuntimeGraphEdge['kind']
}

export interface LearningMap {
  nodes: LearningMapNode[]
  edges: LearningMapEdge[]
}

/** Real learning DTOs; `candidates` drives the chains, the rest is lookup context. */
export interface LearningMapInput {
  candidates: readonly LearningCandidate[]
  evidence?: readonly LearningEvidence[]
  corrections?: readonly UserCorrection[]
  outcomes?: readonly TaskOutcome[]
  mutations?: readonly LearningMutation[]
  policies?: readonly LearningPolicy[]
}

const CANDIDATE_KIND: Readonly<Record<LearningCandidateType, LearningNodeKind>> = {
  lesson: 'memory',
  preference: 'memory',
  skill: 'skill',
  policy: 'policy',
}

/** The node kind a candidate targets: lesson/preference → Memory, else the type itself. */
export function learningNodeKindForCandidate(type: LearningCandidateType): LearningNodeKind {
  return CANDIDATE_KIND[type]
}

/** Which usage evidence ref carries the durable entity id for a kind. */
const USAGE_EVIDENCE: Partial<Record<LearningNodeKind, LearningEvidenceType>> = {
  skill: 'skill_usage',
  memory: 'memory_usage',
}

/** PRD §30 chain edges read as the evolution story, so they are causal, not structural. */
export const LEARNING_CHAIN_EDGE_KIND: RuntimeGraphEdge['kind'] = 'causal'

function byTimeThenId<T extends { id: string }>(items: readonly T[], at: (item: T) => string): T[] {
  return [...items].sort((a, b) => {
    const left = at(a), right = at(b)
    return left === right ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : left < right ? -1 : 1
  })
}

function clip(value: string, max = 80): string {
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function percent(value: number): string {
  return `${value >= 0 ? '+' : ''}${Math.round(value * 100)}%`
}

/** PRD §30 — `Success +23%` when a mutation recorded an effect, else `Success`. */
export function learningOutcomeLabel(outcome: TaskOutcome, mutation?: LearningMutation): string {
  const rate = (mutation?.actualEffect ?? mutation?.expectedEffect)?.successRate
  return `${capitalize(outcome.status)}${typeof rate === 'number' ? ` ${percent(rate)}` : ''}`
}

/** PRD §30 — `Test validation` for the deterministic pass set behind a candidate. */
export function learningValidationSubtitle(candidate: LearningCandidate): string {
  const passes = candidate.validation.passes
  if (passes.length === 0) return candidate.validation.promotable ? 'promotable · no passes recorded' : 'not validated'
  const failed = passes.filter(pass => !pass.ok).map(pass => pass.pass)
  const summary = `${passes.length - failed.length}/${passes.length} passes`
  return `${summary}${failed.length ? ` · failed: ${failed.join(', ')}` : ''}${candidate.validation.promotable ? ' · promotable' : ''}`
}

/**
 * Turns learning DTOs into the PRD §30 chain, once per candidate:
 *
 *   durable (Skill|Memory|Policy) → Session → user correction → Candidate vN
 *     → Test validation → Outcome
 *
 * Nodes are deduplicated by id (shared durable entities stay single), chains stay
 * in causal order, and a step without evidence is skipped rather than faked.
 * `version` counts candidates that target the same durable entity, so a
 * re-proposal after a rollback (`rollbackOf`) is never reported below `v2`.
 */
export function deriveLearningMap(input: LearningMapInput): LearningMap {
  const candidates = byTimeThenId(input.candidates, candidate => candidate.createdAt)
  const outcomes = byTimeThenId(input.outcomes ?? [], outcome => outcome.ts)
  const mutations = byTimeThenId(input.mutations ?? [], mutation => mutation.ts)
  const corrections = input.corrections ?? []
  const policies = input.policies ?? []
  const evidenceById = new Map((input.evidence ?? []).map(item => [item.id, item]))
  const evidenceRecord = (ref: EvidenceRef | undefined) => ref ? evidenceById.get(ref.evidenceId) : undefined

  const nodes: LearningMapNode[] = []
  const edges: LearningMapEdge[] = []
  const nodeIds = new Set<string>()
  const edgeIds = new Set<string>()
  const versions = new Map<string, number>()

  const addNode = (node: LearningMapNode) => {
    if (nodeIds.has(node.id)) return
    nodeIds.add(node.id)
    nodes.push(node)
  }
  const addEdge = (source: string, target: string) => {
    const id = `learning-edge:${source}->${target}`
    if (edgeIds.has(id)) return
    edgeIds.add(id)
    edges.push({ id, source, target, kind: LEARNING_CHAIN_EDGE_KIND })
  }

  for (const candidate of candidates) {
    const kind = learningNodeKindForCandidate(candidate.type)
    const kindLabel = LEARNING_NODE_REGISTRY[kind].label
    const usageType = USAGE_EVIDENCE[kind]
    const mutation = mutations.find(item => item.candidateId === candidate.id)
    const policy = policies.find(item => item.id === (mutation?.targetId ?? candidate.id) || item.fingerprint === candidate.fingerprint)
    const durableRef = mutation?.targetId ?? candidate.evidence.find(item => item.type === usageType)?.ref ?? policy?.id ?? candidate.id
    const versionKey = `${kind}:${durableRef}`
    const groupVersion = (versions.get(versionKey) ?? 0) + 1
    versions.set(versionKey, groupVersion)
    const version = candidate.rollbackOf ? Math.max(2, groupVersion) : groupVersion

    const sessionEvidence = candidate.evidence.find(item => item.type === 'session')
    const correctionEvidence = candidate.evidence.find(item => item.type === 'user_correction')
    const correction = correctionEvidence ? corrections.find(item => item.id === correctionEvidence.ref) : undefined
    const usesDurable = (outcome: TaskOutcome) =>
      usageType === 'skill_usage' ? outcome.skillsUsed.includes(durableRef) : usageType === 'memory_usage' ? outcome.memoryUsed.includes(durableRef) : false
    const sessionRef = sessionEvidence?.ref ?? correction?.sessionId ?? outcomes.find(usesDurable)?.sessionId
    const outcome = outcomes.find(item => item.sessionId === sessionRef || usesDurable(item))

    const durableId = `learning:${kind}:${durableRef}`
    const sessionId = sessionRef ? `learning:evidence:session:${sessionRef}` : undefined
    const correctionId = correctionEvidence ? `learning:evidence:correction:${correctionEvidence.ref}` : undefined
    const candidateId = `learning:candidate:${candidate.id}`
    const validationId = `learning:evidence:validation:${candidate.id}`
    const outcomeId = outcome ? `learning:outcome:${outcome.id}` : undefined

    addNode({
      id: durableId, kind, role: 'durable',
      label: `${kindLabel}: ${clip(durableRef, 48)}`,
      subtitle: mutation ? `${capitalize(mutation.status)} · ${mutation.targetType}` : `no mutation recorded · ${candidate.status}`,
      provenance: { candidateId: candidate.id },
    })
    if (sessionId && sessionRef) addNode({
      id: sessionId, kind: 'evidence', role: 'session',
      label: `Session #${clip(sessionRef, 40)}`,
      subtitle: evidenceRecord(sessionEvidence)?.ts ?? outcome?.ts,
      provenance: { candidateId: candidate.id, evidenceId: evidenceRecord(sessionEvidence)?.id },
    })
    if (correctionId && correctionEvidence) addNode({
      id: correctionId, kind: 'evidence', role: 'correction',
      label: 'user correction',
      subtitle: correction ? `${correction.category} · ${Math.round(correction.confidence * 100)}%` : evidenceRecord(correctionEvidence)?.ts,
      provenance: { candidateId: candidate.id, evidenceId: evidenceRecord(correctionEvidence)?.id },
    })
    addNode({
      id: candidateId, kind, role: 'candidate',
      label: `Candidate v${version}`,
      subtitle: `${kindLabel} · ${candidate.status} · ${Math.round(candidate.confidence * 100)}%`,
      provenance: { candidateId: candidate.id },
    })
    addNode({
      id: validationId, kind: 'evidence', role: 'validation',
      label: 'Test validation',
      subtitle: learningValidationSubtitle(candidate),
      provenance: { candidateId: candidate.id },
    })
    if (outcome && outcomeId) addNode({
      id: outcomeId, kind: 'outcome', role: 'outcome',
      label: learningOutcomeLabel(outcome, mutation),
      subtitle: outcome.taskFingerprint,
      provenance: { candidateId: candidate.id, outcomeId: outcome.id },
    })

    const chain = [durableId, sessionId, correctionId, candidateId, validationId, outcomeId]
      .filter((id): id is string => typeof id === 'string')
    for (let index = 1; index < chain.length; index += 1) addEdge(chain[index - 1]!, chain[index]!)
  }

  return { nodes, edges }
}