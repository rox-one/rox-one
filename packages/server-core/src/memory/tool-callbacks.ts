/**
 * tool-callbacks — the `ctx.memory` seam implementation for session host tools
 * (spec c1.3/c1.8): `memory_search` / `memory_get` / `memory_forget`.
 *
 * Formats MemoryIndexService results into `ToolResult`s. Every hit carries its
 * provenance path/span and a gated badge stating whether the chunk is eligible
 * for automatic prompt injection — untrusted chunks are surfaced but explicitly
 * marked so the model never treats them as trusted instructions. Forget delegates
 * to the workspace forget service, which removes every copy of the content.
 */
import { successResponse, errorResponse, type MemoryToolCallbacks, type MemoryWikiCallbacks } from '@rox/session-tools-core'
import type { SessionMemoryMode } from '@rox/core/types'
import type { WikiClaimEvidence, WikiMutation } from '@rox/shared/memory/types'
import type { MemoryForgetResult } from '@rox/shared/memory/types'
import { join } from 'path'
import { isMemoryOriginEligibleForAutomaticInjection } from './provenance-gate'
import type { MemoryIndexService } from './MemoryIndexService'
import { WikiClaimStore, wikiClaimContradicts } from './WikiClaimStore'

const SNIPPET_CHARS = 240
const GATED_ORIGINS = new Set(['untrusted', 'system'])

/** c1.8: executor wired by SessionManager to the workspace forget service. */
export type MemoryForgetExecutor = (args: { ids: string[]; reason?: string }) => MemoryForgetResult

function gatedBadge(origin: string): string {
  return GATED_ORIGINS.has(origin) ? `gated: ${origin} (never auto-injected)` : `injectable: ${origin}`
}

function formatEvidence(evidence: WikiClaimEvidence[]): string[] {
  if (evidence.length === 0) return ['   evidence: (none — the claim is unsupported)']
  return evidence.map((entry) => {
    const locator = entry.locator ? ` @ ${entry.locator}` : ''
    const quote = entry.quote ? ` — "${entry.quote.length > SNIPPET_CHARS ? `${entry.quote.slice(0, SNIPPET_CHARS)}…` : entry.quote}"` : ''
    return `   - ${entry.source}${locator}${quote}`
  })
}

/**
 * c1.7 — build the wiki (claims/evidence) callbacks over one workspace store.
 * The wiki is a human/agent-inspected document surface: these callbacks READ and
 * WRITE claims, and are never used by the prompt-injection path.
 */
export function buildMemoryWikiCallbacks(store: WikiClaimStore): MemoryWikiCallbacks {
  return {
    async search(args) {
      const claims = store.list({
        ...(args.scope ? { scope: args.scope } : {}),
        ...(args.status ? { status: args.status } : {}),
      })
      const query = (args.query ?? '').trim().toLowerCase()
      const matched = query ? claims.filter((claim) => claim.text.toLowerCase().includes(query)) : claims
      const hits = matched.slice(0, args.limit)
      if (hits.length === 0) {
        return successResponse(query ? `No wiki claims matched "${args.query}".` : 'The workspace wiki has no claims yet.')
      }
      const lines = [
        query ? `## Wiki search: "${args.query}"` : '## Workspace wiki claims',
        `${hits.length} of ${matched.length} claim(s)`,
      ]
      hits.forEach((claim, i) => {
        lines.push(
          '',
          `${i + 1}. [${claim.id}] ${claim.status} — ${claim.text} (revision ${claim.revision})`,
          `   evidence: ${claim.evidence.length}`,
          ...formatEvidence(claim.evidence),
        )
        const edges = wikiClaimContradicts(claim)
        if (edges.length) lines.push(`   contradicts: ${edges.join(', ')}`)
      })
      return successResponse(lines.join('\n'))
    },

    async get(args) {
      const claim = store.get(args.id)
      if (!claim) return successResponse(`No wiki claim with id ${args.id}.`)
      const lines = [
        `## Wiki claim ${claim.id}`,
        `status: ${claim.status} · revision: ${claim.revision}${claim.scope ? ` · scope: ${claim.scope}` : ''}`,
        '',
        claim.text,
        '',
        'evidence:',
        ...formatEvidence(claim.evidence),
      ]
      const edges = wikiClaimContradicts(claim)
      if (edges.length) lines.push('', `contradicts: ${edges.join(', ')}`)
      return successResponse(lines.join('\n'))
    },

    async apply(args) {
      const mutation: WikiMutation =
        args.op === 'upsert'
          ? {
              op: 'upsert',
              claim: {
                id: args.claim!.id,
                text: args.claim!.text,
                status: args.claim!.status,
                evidence: args.claim!.evidence ?? [],
                ...(args.claim!.scope ? { scope: args.claim!.scope } : {}),
                revision: args.claim!.revision ?? 0,
                ...(args.claim!.createdAt ? { createdAt: args.claim!.createdAt } : {}),
                ...(args.claim!.updatedAt ? { updatedAt: args.claim!.updatedAt } : {}),
              },
            }
          : { op: 'retract', claimId: args.claimId!, ...(args.reason ? { reason: args.reason } : {}) }
      try {
        const result = store.apply(mutation, { actor: 'agent' })
        const verb = args.op === 'upsert' ? 'Stored' : 'Retracted'
        return successResponse(
          [
            '## Wiki apply',
            `${verb} claim ${result.claim.id} (revision ${result.revision}, status ${result.claim.status}).`,
          ].join('\n'),
        )
      } catch (error) {
        return errorResponse(`wiki_apply failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    },
  }
}

/** Build the host-tool callbacks bound to one workspace's memory index. */
export function buildMemoryToolCallbacks(
  index: MemoryIndexService,
  forget?: MemoryForgetExecutor,
  wiki?: WikiClaimStore,
): MemoryToolCallbacks {
  const wikiStore = wiki ?? new WikiClaimStore(join(index.workspaceRoot, 'memory'), 'workspace')
  return {
    async search(args) {
      const result = await index.searchSemantic(args.query, args.limit ?? 8)
      const hits = args.path ? result.hits.filter(hit => hit.path.startsWith(args.path!)) : result.hits
      if (hits.length === 0) {
        return successResponse(`No memory chunks matched "${args.query}".`)
      }
      const lines = [
        `## Memory search: "${args.query}"`,
        `${hits.length} hit(s) — backend ${result.capability.fts5 ? 'FTS5' : 'JS BM25'}${result.capability.vector || hits.some(h => typeof h.vectorScore === 'number') ? ' + vector' : ''}`,
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

    async forget(args) {
      if (!forget) {
        return errorResponse('memory_forget is unavailable in this backend (no workspace memory forget service wired).')
      }
      const ids = (Array.isArray(args?.ids) ? args.ids : []).filter(
        (id): id is string => typeof id === 'string' && id.trim().length > 0,
      )
      if (ids.length === 0) {
        return errorResponse('memory_forget requires at least one non-empty "chunkId" in "ids".')
      }
      try {
        const result = forget({ ids, ...(args.reason ? { reason: args.reason } : {}) })
        const lines = [`## Memory forget`]
        if (result.forgotten.length > 0) {
          lines.push(`Forgotten ${result.forgotten.length} chunk(s); removed from corpus, index and embeddings.`, ...result.forgotten.map((id) => `- ${id}`))
        } else {
          lines.push('Nothing forgotten.')
        }
        if (result.alreadyForgotten.length > 0) {
          lines.push(`Already forgotten (no-op): ${result.alreadyForgotten.join(', ')}`)
        }
        if (result.lineage) {
          lines.push(`Lineage recorded at ${result.lineage.ts} by ${result.lineage.actor}.`)
        }
        return successResponse(lines.join('\n'))
      } catch (error) {
        return errorResponse(`memory_forget failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    },

    wiki: buildMemoryWikiCallbacks(wikiStore),
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
  forget?: MemoryForgetExecutor,
  wiki?: WikiClaimStore,
): MemoryToolCallbacks | undefined {
  if (mode?.memoryMode === 'temporary' || mode?.memoryScope === 'none') return undefined
  return index ? buildMemoryToolCallbacks(index, forget, wiki) : undefined
}