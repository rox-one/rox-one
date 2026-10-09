/**
 * memory_search — provenance-aware search over the workspace memory index (c1.3).
 *
 * Thin facade over the injected `ctx.memory` callbacks (wired by SessionManager
 * to the workspace MemoryIndexService). Retrieval is real: hits come from the
 * FTS5/JS chunk index. Results carry provenance and a gated badge — an
 * `untrusted` hit is returned but explicitly marked as never injected into the
 * prompt, so the model can reason about it without treating it as trust.
 *
 * Read-only and safe in Explore mode: no side effects, no permission dialog.
 */
import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse } from '../response.ts';
import type { MemorySearchToolArgs } from '../tool-defs.ts';

/** Hard cap on requested hits — the tool description advertises 20/default, 50/max. */
export const MEMORY_SEARCH_MAX_LIMIT = 50;
const DEFAULT_LIMIT = 8;

export async function handleMemorySearch(
  ctx: SessionToolContext,
  args: MemorySearchToolArgs,
): Promise<ToolResult> {
  const query = typeof args?.query === 'string' ? args.query.trim() : '';
  if (!query) {
    return errorResponse('memory_search requires a non-empty "query" string.');
  }
  if (!ctx.memory) {
    return errorResponse('memory_search is unavailable in this backend (no workspace memory index wired).');
  }
  const requested = typeof args.limit === 'number' && Number.isFinite(args.limit) ? args.limit : DEFAULT_LIMIT;
  const limit = Math.min(Math.max(Math.trunc(requested), 1), MEMORY_SEARCH_MAX_LIMIT);
  const path = typeof args.path === 'string' && args.path.trim() ? args.path.trim() : undefined;
  try {
    return await ctx.memory.search({ query, limit, ...(path ? { path } : {}) });
  } catch (error) {
    return errorResponse(`memory_search failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}