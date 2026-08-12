/**
 * knowledge_search — full-text search over the connected knowledge base (K-10 §3.1
 * `knowledge.search` capability; the wire name uses underscores because Anthropic /
 * OpenAI-compatible tool-name grammars reject dots).
 *
 * Thin facade over the registered KnowledgeToolRuntime (provider.search): bounded
 * (limit clamped to KNOWLEDGE_SEARCH_MAX_LIMIT, snippets truncated), provenance-rich
 * (connection id, serialized refs, siyuan:// deep links), typed errors.
 */

import type { SearchHit, SearchInput } from '@craft-agent/core/knowledge';
import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse, successResponse } from '../response.ts';
import {
  deepLinkFor,
  formatRef,
  knowledgeErrorResponse,
  provenanceLine,
  requireKnowledgeRuntime,
  truncateText,
} from '../knowledge/format.ts';
import type { KnowledgeSearchArgs } from '../tool-defs.ts';

/** Hard cap on requested hits — the tool description advertises 20/default, 50/max. */
export const KNOWLEDGE_SEARCH_MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;
const MAX_SNIPPET_CHARS = 300;

function formatHit(index: number, hit: SearchHit): string {
  const lines = [
    `${index + 1}. **${hit.title || hit.ref.id}** (${hit.ref.kind})`,
    `   ref: ${formatRef(hit.ref)}`,
    `   link: ${deepLinkFor(hit.ref)}`,
  ];
  if (hit.notebookPath) lines.push(`   path: ${hit.notebookPath}`);
  if (hit.updatedAt) lines.push(`   updated: ${new Date(hit.updatedAt).toISOString()}`);
  if (hit.snippet) lines.push(`   > ${truncateText(hit.snippet.replace(/\s+/g, ' ').trim(), MAX_SNIPPET_CHARS)}`);
  return lines.join('\n');
}

export async function handleKnowledgeSearch(
  _ctx: SessionToolContext,
  args: KnowledgeSearchArgs,
): Promise<ToolResult> {
  const query = typeof args?.query === 'string' ? args.query.trim() : '';
  if (!query) {
    return errorResponse('INVALID_REF: knowledge_search requires a non-empty "query" string.');
  }

  const resolved = requireKnowledgeRuntime();
  if (!resolved.ok) return resolved.response;
  const { runtime } = resolved;

  const input: SearchInput = { query };
  if (Array.isArray(args.kinds) && args.kinds.length > 0) input.kinds = args.kinds;
  if (typeof args.notebookId === 'string' && args.notebookId) input.notebookId = args.notebookId;
  if (typeof args.pathPrefix === 'string' && args.pathPrefix) input.pathPrefix = args.pathPrefix;
  const requestedLimit = typeof args.limit === 'number' && Number.isFinite(args.limit) ? args.limit : DEFAULT_LIMIT;
  input.limit = Math.min(Math.max(Math.trunc(requestedLimit), 1), KNOWLEDGE_SEARCH_MAX_LIMIT);
  if (typeof args.cursor === 'string' && args.cursor) input.cursor = args.cursor;

  try {
    const page = await runtime.search({
      input,
      ...(typeof args.connectionId === 'string' && args.connectionId
        ? { connectionId: args.connectionId }
        : {}),
    });
    const items = page.items ?? [];
    const header = [
      `## Knowledge search: "${query}"`,
      provenanceLine(args.connectionId ?? '(default)'),
      items.length === 0
        ? 'No results.'
        : `${items.length} result(s)` +
          (typeof page.totalEstimate === 'number' ? `, ~${page.totalEstimate} total` : '') +
          (page.nextCursor
            ? `. More pages available — pass cursor "${page.nextCursor}" to continue.`
            : ''),
    ].join('\n');
    const body = items.map((hit, i) => formatHit(i, hit)).join('\n\n');
    return successResponse(body ? `${header}\n\n${body}` : header);
  } catch (error) {
    return knowledgeErrorResponse(error);
  }
}