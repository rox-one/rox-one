/**
 * Graph-memory provider seam (cognee integration, PR1).
 *
 * An ADDITIVE knowledge-graph layer behind the native memory stack: the native
 * index stays the source of truth, a provider only contributes extra recall
 * hits that are fused (Reciprocal Rank Fusion) into `memory_search`.
 *
 * Contract:
 *  - `search` must be cheap to abandon: callers race it against a budget
 *    (default {@link GRAPH_SEARCH_BUDGET_MS}) and drop late results.
 *  - A provider that is not warm returns `[]` (and may start warming in the
 *    background); it never blocks a turn and never throws into recall.
 *  - Every hit carries provenance; only injectable origins are fused.
 */
import type { MemoryChunkProvenance, MemorySearchHit } from './types.ts'

/** Default retrieval budget for one graph search inside a recall. */
export const GRAPH_SEARCH_BUDGET_MS = 300

/** RRF constant (standard value from Cormack et al.). */
export const RRF_K = 60

export type GraphMemorySource = 'session' | 'notes' | 'tasks' | 'chats' | 'calls' | 'mail' | 'files' | 'lessons'

export type GraphSearchMode = 'chunks' | 'graph_completion' | 'insights'

export interface GraphMemoryDocument {
  /** Stable id of the source document (used for forget / incremental re-ingest). */
  id: string
  source: GraphMemorySource
  text: string
  provenance: MemoryChunkProvenance
  /** Optional human-readable locator (path, task id, chat id). */
  ref?: string
}

export interface GraphMemoryHit {
  id: string
  source: GraphMemorySource
  text: string
  /** Provider-native relevance (higher = better); only the rank is used for fusion. */
  score: number
  provenance: MemoryChunkProvenance
  ref?: string
}

export type GraphMemoryState = 'disabled' | 'not_installed' | 'installing' | 'cold' | 'warming' | 'ready' | 'failed'

export interface GraphMemoryStatus {
  state: GraphMemoryState
  provider: string
  documents?: number
  safeError?: string
}

export interface GraphMemoryProvider {
  readonly id: string
  ingest(docs: readonly GraphMemoryDocument[]): Promise<void>
  search(query: string, opts?: { mode?: GraphSearchMode; limit?: number; signal?: AbortSignal }): Promise<GraphMemoryHit[]>
  forget(ids: readonly string[]): Promise<void>
  status(): GraphMemoryStatus
}

/** Provider used when graph memory is disabled or unavailable. */
export class NoopGraphMemoryProvider implements GraphMemoryProvider {
  readonly id = 'noop'
  async ingest(): Promise<void> {}
  async search(): Promise<GraphMemoryHit[]> {
    return []
  }
  async forget(): Promise<void> {}
  status(): GraphMemoryStatus {
    return { state: 'disabled', provider: this.id }
  }
}

/** Origins that may be fused into recall (mirrors the injection gate: never `untrusted`). */
export function isFusableGraphHit(hit: GraphMemoryHit): boolean {
  return hit.provenance?.originClass !== 'untrusted' && typeof hit.text === 'string' && hit.text.trim().length > 0
}

/** Chunk-id namespace for graph hits so they never collide with native chunk ids. */
export const GRAPH_CHUNK_PREFIX = 'graph:'

export function graphHitToSearchHit(hit: GraphMemoryHit, snippetChars = 240): MemorySearchHit {
  const flat = hit.text.replace(/\s+/g, ' ').trim()
  return {
    chunkId: `${GRAPH_CHUNK_PREFIX}${hit.id}`,
    path: `graph/${hit.source}${hit.ref ? `/${hit.ref}` : ''}`,
    startLine: 1,
    endLine: 1,
    score: 0,
    snippet: flat.length > snippetChars ? `${flat.slice(0, snippetChars)}…` : flat,
    text: hit.text,
    origin: hit.provenance.originClass,
    provenance: hit.provenance,
  }
}

/**
 * Reciprocal Rank Fusion of ranked lists. Items are keyed by `chunkId`; the
 * fused score is Σ 1/(k + rank). Ties keep first-list order (stable), so with
 * an empty graph list the native order is preserved exactly.
 */
export function rrfFuse(lists: readonly (readonly MemorySearchHit[])[], limit: number, k = RRF_K): MemorySearchHit[] {
  const acc = new Map<string, { hit: MemorySearchHit; score: number; order: number }>()
  let order = 0
  for (const list of lists) {
    list.forEach((hit, rank) => {
      const inc = 1 / (k + rank + 1)
      const prev = acc.get(hit.chunkId)
      if (prev) prev.score += inc
      else acc.set(hit.chunkId, { hit, score: inc, order: order++ })
    })
  }
  return [...acc.values()]
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, Math.max(0, limit))
    .map(({ hit, score }) => ({ ...hit, score }))
}

/** Race a promise against a budget; resolves `fallback` on timeout or rejection. */
export async function withBudget<T>(p: Promise<T>, ms: number, fallback: T, onAbort?: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      p.catch(() => fallback),
      new Promise<T>(resolve => {
        timer = setTimeout(() => {
          onAbort?.()
          resolve(fallback)
        }, ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
