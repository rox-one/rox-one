/**
 * Live learning source for the runtime map — PRD §30.
 *
 * `learning-nodes.ts` derives the PRD §30 chain from real learning DTOs but the
 * live map is assembled from `RuntimeEvent`s, so nothing ever fed learning
 * entities into it. This module is the missing seam:
 *
 *  - `loadLearningMapInput` reads the read-only `learning:*` RPC surface
 *    (`listLearningCandidates` / `listLearningEvidence` / `getLearningOutcome` /
 *    `getLearningPolicy`) and fails soft: an absent API, an
 *    `UNSUPPORTED_OPERATION` host or any failed read yields `undefined`, i.e.
 *    zero extra nodes and no error.
 *  - `learningOverlay` runs `deriveLearningMap` over that input (empty overlay
 *    when there is nothing to derive — never a fabricated chain).
 *  - `mergeLearningOverlay` is the real merge: it returns the effective node set
 *    of the map, the untouched event-derived graph plus the learning chain nodes
 *    and their causal edges, without disturbing any runtime node or edge.
 *
 * Nothing here invents `RuntimeEvent`s: learning entities are served by a
 * separate RPC surface and keep their own `LearningMapNode` view model. The
 * canvas receives them as a supplementary node source.
 */
import type { RuntimeGraph } from '@rox/core/runtime-trace'
import type {
  LearningCandidate,
  LearningEvidence,
  LearningEvidenceType,
  LearningPolicy,
  TaskOutcome,
} from '@rox/shared/memory/learning'
import { deriveLearningMap, type LearningMapEdge, type LearningMapInput, type LearningMapNode } from './learning-nodes'

/** The read-only `learning:*` methods the overlay uses. */
export interface LearningReadApi {
  listLearningCandidates(workspaceId: string): Promise<LearningCandidate[]>
  listLearningEvidence(workspaceId: string, candidateId?: string): Promise<LearningEvidence[]>
  getLearningOutcome(workspaceId: string, id: string): Promise<TaskOutcome | null>
  getLearningPolicy(workspaceId: string, id?: string): Promise<LearningPolicy[]>
}

export interface LearningOverlay {
  nodes: readonly LearningMapNode[]
  edges: readonly LearningMapEdge[]
}

export const EMPTY_LEARNING_OVERLAY: LearningOverlay = Object.freeze({ nodes: [], edges: [] })

/** Evidence kinds whose `ref` is a `TaskOutcome` id. */
const OUTCOME_EVIDENCE: Partial<Record<LearningEvidenceType, true>> = { successful_outcome: true, failed_outcome: true }
/** Bounded fan-out: one `getLearningOutcome` call per referenced outcome. */
const MAX_OUTCOME_LOOKUPS = 24

export function learningOverlay(input: LearningMapInput | undefined | null): LearningOverlay {
  if (!input || input.candidates.length === 0) return EMPTY_LEARNING_OVERLAY
  const map = deriveLearningMap(input)
  return map.nodes.length ? map : EMPTY_LEARNING_OVERLAY
}

export interface MapNodeRef {
  id: string
  kind: string
  origin: 'runtime' | 'learning'
  /** Learning chains carry their derived label; runtime nodes render through i18n. */
  label?: string
}

export interface MergedLearningOverlay {
  /** The event-derived graph, returned unchanged. */
  graph: RuntimeGraph
  learning: LearningOverlay
  /** Effective node set of the map: runtime nodes first, then learning chain nodes. */
  nodes: MapNodeRef[]
}

/**
 * The learning nodes that actually join the map: dropped in context mode (its
 * kind allowlist does not cover learning kinds) and in an empty trace, kept only
 * when `mergeLearningOverlay` joined them (id de-duplication against runtime
 * nodes) and the toolbar query/filter still matches.
 */
export function visibleLearningNodes(
  graph: RuntimeGraph,
  overlay: LearningOverlay,
  options: { query: string; filter: string; context: boolean },
): LearningMapNode[] {
  if (options.context || graph.nodes.length === 0) return []
  const joined = new Set(mergeLearningOverlay(graph, overlay).nodes.filter(node => node.origin === 'learning').map(node => node.id))
  return overlay.nodes.filter(node => joined.has(node.id) && learningNodeMatches(node, options.query, options.filter))
}

/** Adds the learning node/edge set to the map without touching event-derived nodes or edges. */
export function mergeLearningOverlay(graph: RuntimeGraph, learning: LearningOverlay): MergedLearningOverlay {
  const nodes: MapNodeRef[] = []
  const seen = new Set<string>()
  for (const node of graph.nodes) {
    if (seen.has(node.id)) continue
    seen.add(node.id)
    nodes.push({ id: node.id, kind: node.kind, origin: 'runtime' })
  }
  for (const node of learning.nodes) {
    if (seen.has(node.id)) continue
    seen.add(node.id)
    nodes.push({ id: node.id, kind: node.kind, origin: 'learning', label: node.label })
  }
  return { graph, learning, nodes }
}

function electronLearningApi(): Partial<LearningReadApi> | undefined {
  return typeof window === 'undefined' ? undefined : window.electronAPI
}

/**
 * Mirrors `nodeMatches` for overlay nodes so the toolbar's filter and query also
 * narrow the learning chains. `errors`/`waiting` select runtime statuses that a
 * learning chain does not carry, so those filters hide the overlay.
 */
export function learningNodeMatches(node: LearningMapNode, query: string, filter: string): boolean {
  if (filter === 'errors' || filter === 'waiting') return false
  if (filter !== 'all' && node.kind !== filter) return false
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return true
  return `${node.kind} ${node.role} ${node.label} ${node.subtitle ?? ''}`.toLocaleLowerCase().includes(needle)
}

/** Never rejects: an unsupported or failed read degrades to the fields that did load. */
async function settle<T>(read: () => Promise<T>, fallback: T): Promise<T> {
  try { return await read() } catch { return fallback }
}

/**
 * Reads the learning DTOs the chain needs. Returns `undefined` when the host has
 * no learning API (`UNSUPPORTED_OPERATION` or a missing method) or when the
 * candidate list itself is unavailable — the map then renders zero extra nodes.
 *
 * Corrections and mutations have no read-only RPC method in this build;
 * `deriveLearningMap` skips those steps rather than fabricating them.
 */
export async function loadLearningMapInput(
  workspaceId: string | undefined,
  api: Partial<LearningReadApi> | undefined = electronLearningApi(),
): Promise<LearningMapInput | undefined> {
  if (!workspaceId || typeof api?.listLearningCandidates !== 'function') return undefined
  let candidates: LearningCandidate[]
  try {
    candidates = await api.listLearningCandidates(workspaceId)
  } catch {
    // `UNSUPPORTED_OPERATION` (host without the learning service) and any read
    // failure both degrade to zero learning nodes; nothing is thrown into the map.
    return undefined
  }
  if (candidates.length === 0) return { candidates: [] }

  const listEvidence = api.listLearningEvidence
  const getPolicy = api.getLearningPolicy
  const getOutcome = api.getLearningOutcome
  const [evidence, policies] = await Promise.all([
    typeof listEvidence === 'function' ? settle(() => listEvidence(workspaceId), []) : Promise.resolve([]),
    typeof getPolicy === 'function' ? settle(() => getPolicy(workspaceId), []) : Promise.resolve([]),
  ])

  const outcomeIds: string[] = []
  for (const candidate of candidates) {
    for (const ref of candidate.evidence) {
      if (OUTCOME_EVIDENCE[ref.type] && !outcomeIds.includes(ref.ref)) outcomeIds.push(ref.ref)
    }
  }
  const outcomes: TaskOutcome[] = []
  if (typeof getOutcome === 'function') {
    const settled = await Promise.all(outcomeIds.slice(0, MAX_OUTCOME_LOOKUPS).map(id => settle(() => getOutcome(workspaceId, id), null)))
    for (const outcome of settled) if (outcome) outcomes.push(outcome)
  }

  return { candidates, evidence, policies, outcomes }
}