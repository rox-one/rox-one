/**
 * memory_get — read one memory chunk by id (c1.3).
 *
 * Thin facade over the injected `ctx.memory.get` callback. Returns the full
 * chunk text with its path, line span and provenance (including the gated
 * badge for `untrusted` content). A missing id is a truthful "not found",
 * never a fabricated chunk.
 */
import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse } from '../response.ts';
import type { MemoryGetToolArgs } from '../tool-defs.ts';

export async function handleMemoryGet(
  ctx: SessionToolContext,
  args: MemoryGetToolArgs,
): Promise<ToolResult> {
  const chunkId = typeof args?.chunkId === 'string' ? args.chunkId.trim() : '';
  if (!chunkId) {
    return errorResponse('memory_get requires a non-empty "chunkId" string (from memory_search).');
  }
  if (!ctx.memory) {
    return errorResponse('memory_get is unavailable in this backend (no workspace memory index wired).');
  }
  try {
    return await ctx.memory.get({ chunkId });
  } catch (error) {
    return errorResponse(`memory_get failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}