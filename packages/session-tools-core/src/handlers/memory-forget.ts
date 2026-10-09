/**
 * memory_forget — explicit memory forget by chunk id (c1.8).
 *
 * Thin facade over the injected `ctx.memory.forget` callback. The callback
 * removes the chunk's corpus line, index chunk and embedding artifacts and
 * records a content-free lineage entry in the workspace audit log. An unknown
 * or already-forgotten id is a clean no-op, reported truthfully.
 *
 * Mutating (not read-only) and blocked in Explore/Safe mode, like the other
 * memory-write tools.
 */
import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse } from '../response.ts';
import type { MemoryForgetToolArgs } from '../tool-defs.ts';

/** Hard cap on how many ids one forget call may target. */
export const MEMORY_FORGET_MAX_IDS = 100;

export async function handleMemoryForget(
  ctx: SessionToolContext,
  args: MemoryForgetToolArgs,
): Promise<ToolResult> {
  const ids = (Array.isArray(args?.ids) ? args.ids : [])
    .map(id => (typeof id === 'string' ? id.trim() : ''))
    .filter(id => id.length > 0);
  if (ids.length === 0) {
    return errorResponse('memory_forget requires at least one non-empty "chunkId" in "ids".');
  }
  if (!ctx.memory?.forget) {
    return errorResponse('memory_forget is unavailable in this backend (no workspace memory forget service wired).');
  }
  const capped = ids.slice(0, MEMORY_FORGET_MAX_IDS);
  const reason = typeof args.reason === 'string' ? args.reason : undefined;
  try {
    return await ctx.memory.forget({ ids: capped, ...(reason ? { reason } : {}) });
  } catch (error) {
    return errorResponse(`memory_forget failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}