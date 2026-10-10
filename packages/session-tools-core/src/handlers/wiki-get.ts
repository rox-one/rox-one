/**
 * wiki_get — read one wiki claim by id (c1.7).
 *
 * Thin facade over the injected `ctx.memory.wiki.get` callback. A missing id is
 * a truthful "not found", never a fabricated claim.
 */
import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse } from '../response.ts';
import type { WikiGetToolArgs } from '../tool-defs.ts';

export async function handleWikiGet(
  ctx: SessionToolContext,
  args: WikiGetToolArgs,
): Promise<ToolResult> {
  const id = typeof args?.id === 'string' ? args.id.trim() : '';
  if (!id) {
    return errorResponse('wiki_get requires a non-empty "id" string (from wiki_search).');
  }
  if (!ctx.memory?.wiki) {
    return errorResponse('wiki_get is unavailable in this backend (no workspace wiki wired).');
  }
  try {
    return await ctx.memory.wiki.get({ id });
  } catch (error) {
    return errorResponse(`wiki_get failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}