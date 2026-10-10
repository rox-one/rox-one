/**
 * rovers_list / rovers_search / rovers_show — read-only access to the curated
 * Rovers service catalog (binding cross-slice contract §2).
 *
 * All three are thin facades over the registered Rovers catalog view
 * (`@rox/rovers-core-lite`): the query logic (category filter, keyword AND
 * tokens, bounded limit, entry lookup) lives in rovers-core-lite, so the same
 * behavior powers the `rovers:list` RPC. The tool result is the entry JSON the
 * agent embeds in a ```rovers-card fenced block — the renderer reconstructs the
 * card from that self-contained payload without any RPC at render time.
 *
 * Info-only slice: no tool here ever deploys, installs, or mutates anything, and
 * every entry's `deploy.kind` is `none`.
 */

import { RoversCatalogError, roversList, roversSearch, roversShow } from '@rox/rovers-core-lite';
import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse, successResponse } from '../response.ts';
import { getRoversToolRuntime } from '../rovers/runtime.ts';
import type { RoversListArgs, RoversSearchArgs, RoversShowArgs } from '../tool-defs.ts';

function unavailableResponse(): ToolResult {
  return errorResponse(
    'ROVERS_UNAVAILABLE: Rovers catalog tools are unavailable in this process — no Rovers ' +
      'catalog is registered. They run where the rovers:list RPC layer runs (the main server); ' +
      'they are not available in this session backend.',
  );
}

/** Map a typed catalog error to its wire code; anything else is a generic ROvers failure. */
function roversErrorResponse(error: unknown): ToolResult {
  if (error instanceof RoversCatalogError) {
    return errorResponse(`ROVERS_${error.code}: ${error.message}`);
  }
  const message = error instanceof Error ? error.message : String(error);
  return errorResponse(`ROVERS_ERROR: ${message}`);
}

/** rovers_list — bounded card list with optional category and keyword filters. */
export async function handleRoversList(_ctx: SessionToolContext, args: RoversListArgs): Promise<ToolResult> {
  const query = getRoversToolRuntime();
  if (!query) return unavailableResponse();
  try {
    const result = roversList(query, {
      category: args?.category,
      query: args?.query,
      limit: args?.limit,
    });
    return successResponse(JSON.stringify(result, null, 2));
  } catch (error) {
    return roversErrorResponse(error);
  }
}

/** rovers_search — keyword search over the same catalog view. */
export async function handleRoversSearch(_ctx: SessionToolContext, args: RoversSearchArgs): Promise<ToolResult> {
  const query = getRoversToolRuntime();
  if (!query) return unavailableResponse();
  const text = typeof args?.query === 'string' ? args.query.trim() : '';
  if (!text) return errorResponse('INVALID_ARGS: rovers_search requires a non-empty "query" string.');
  try {
    const result = roversSearch(query, { query: text, limit: args?.limit });
    return successResponse(JSON.stringify(result, null, 2));
  } catch (error) {
    return roversErrorResponse(error);
  }
}

/** rovers_show — the full entry (summary + description + homepage + spdx + deploy). */
export async function handleRoversShow(_ctx: SessionToolContext, args: RoversShowArgs): Promise<ToolResult> {
  const query = getRoversToolRuntime();
  if (!query) return unavailableResponse();
  const id = typeof args?.id === 'string' ? args.id.trim() : '';
  if (!id) return errorResponse('INVALID_ARGS: rovers_show requires a non-empty "id" string.');
  try {
    const entry = roversShow(query, { id });
    return successResponse(JSON.stringify({ entry }, null, 2));
  } catch (error) {
    return roversErrorResponse(error);
  }
}