/**
 * wiki_search — read-only search over the workspace wiki claims (c1.7).
 *
 * Thin facade over the injected `ctx.memory.wiki.search` callback. The wiki is
 * the evidence-backed layer built on durable memory; it is inspected, never
 * injected into prompts. An unwired backend reports a typed "unavailable", so
 * the tool is listed only when the wiki callbacks are present.
 */
import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse } from '../response.ts';
import type { WikiSearchToolArgs } from '../tool-defs.ts';

/** Hard cap on claims returned by one search. */
export const WIKI_SEARCH_MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

export async function handleWikiSearch(
  ctx: SessionToolContext,
  args: WikiSearchToolArgs,
): Promise<ToolResult> {
  if (!ctx.memory?.wiki) {
    return errorResponse('wiki_search is unavailable in this backend (no workspace wiki wired).');
  }
  const query = typeof args?.query === 'string' ? args.query.trim() : '';
  const requested = typeof args.limit === 'number' && Number.isFinite(args.limit) ? args.limit : DEFAULT_LIMIT;
  const limit = Math.min(Math.max(Math.trunc(requested), 1), WIKI_SEARCH_MAX_LIMIT);
  const scope = typeof args.scope === 'string' && args.scope.trim() ? args.scope.trim() : undefined;
  const status = args.status;
  try {
    return await ctx.memory.wiki.search({ query, limit, ...(scope ? { scope } : {}), ...(status ? { status } : {}) });
  } catch (error) {
    return errorResponse(`wiki_search failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}