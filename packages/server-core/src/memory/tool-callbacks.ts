/**
 * tool-callbacks — the `ctx.memory` seam implementation for session host tools
 * (spec c1.3): `memory_search` / `memory_get`.
 *
 * Formats MemoryIndexService results into `ToolResult`s. Every hit carries its
 * provenance path/span and a gated badge stating whether the chunk is eligible
 * for automatic prompt injection — untrusted chunks are surfaced but explicitly
 * marked so the model never treats them as trusted instructions.
 */
import { successResponse, type MemoryToolCallbacks } from '@rox/session-tools-core'
import type { SessionMemoryMode } from '@rox/core/types'
import { isMemoryOriginEligibleForAutomaticInjection } from './provenance-gate'
import type { MemoryIndexService } from './MemoryIndexService'

const SNIPPET_CHARS = 240
const GATED_ORIGINS = new Set(['untrusted', 'system'])

function gatedBadge(origin: string): string {
  return GATED_ORIGINS.has(origin) ? `gated: ${origin} (never auto-injected)` : `injectable: ${origin}`
}

/** Build the host-tool callbacks bound to one workspace's memory index. */
export function buildMemoryToolCallbacks(index: MemoryIndexService): MemoryToolCallbacks {
  return {
    async search(args) {
      const result = index.search(args.query, args.limit ?? 8)
      const hits = args.path ? result.hits.filter(hit => hit.path.startsWith(args.path!)) : result.hits
      if (hits.length === 0) {
        return successResponse(`No memory chunks matched "${args.query}".`)
      }
      const lines = [
        `## Memory search: "${args.query}"`,
        `${hits.length} hit(s) — backend ${result.capability.fts5 ? 'FTS5' : 'JS BM25'}${result.capability.vector ? ' + vector' : ''}`,
      ]
      hits.forEach((hit, i) => {
        const snippet = hit.snippet.length > SNIPPET_CHARS ? `${hit.snippet.slice(0, SNIPPET_CHARS)}…` : hit.snippet
        lines.push(
          '',
          `${i + 1}. ${hit.path}:${hit.startLine}-${hit.endLine} (score ${hit.score.toFixed(2)}, ${gatedBadge(hit.origin)})`,
          `   chunkId: ${hit.chunkId}`,
          `   > ${snippet}`,
        )
      })
      if (hits.some(hit => !isMemoryOriginEligibleForAutomaticInjection(hit.origin))) {
        lines.push('', 'Note: gated chunks are shown for inspection only and are never injected into prompts.')
      }
      return successResponse(lines.join('\n'))
    },

    async get(args) {
      const chunk = index.get(args.chunkId)
      if (!chunk) return successResponse(`No memory chunk with id ${args.chunkId}.`)
      return successResponse(
        [
          `## Memory chunk ${chunk.chunkId}`,
          `path: ${chunk.path}:${chunk.startLine}-${chunk.endLine}`,
          `provenance: ${gatedBadge(chunk.origin)} (${chunk.provenance.sessionKind}, ${chunk.provenance.observedAt})`,
          '',
          chunk.text,
        ].join('\n'),
      )
    },
  }
}

/**
 * Wire the session's memory tools only when the session may read/write memory.
 *
 * Reuses the prompt path's predicate (spec F3): a `temporary` memory mode or an
 * agent profile captured with `memoryScope: 'none'` means no memory read and no
 * memory write, so the `memory_search` / `memory_get` callbacks are absent
 * entirely (the handlers then report a truthful "unavailable"). Returns
 * undefined when the workspace has no memory service/index either.
 */
export function memoryToolCallbacksForSession(
  mode: { memoryMode?: SessionMemoryMode; memoryScope?: string } | undefined,
  index: MemoryIndexService | undefined,
): MemoryToolCallbacks | undefined {
  if (mode?.memoryMode === 'temporary' || mode?.memoryScope === 'none') return undefined
  return index ? buildMemoryToolCallbacks(index) : undefined
}