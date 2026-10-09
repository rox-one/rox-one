/**
 * wiki_apply — write a wiki claim mutation (c1.7).
 *
 * Thin facade over the injected `ctx.memory.wiki.apply` callback. Upserts and
 * retracts claims; the store rejects empty text and dangling contradiction ids.
 * Mutating (not read-only) and blocked in Explore/Safe mode, like the other
 * memory-write tools.
 */
import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse } from '../response.ts';
import type { WikiApplyToolArgs } from '../tool-defs.ts';

export async function handleWikiApply(
  ctx: SessionToolContext,
  args: WikiApplyToolArgs,
): Promise<ToolResult> {
  if (!ctx.memory?.wiki) {
    return errorResponse('wiki_apply is unavailable in this backend (no workspace wiki wired).');
  }
  if (args?.op !== 'upsert' && args?.op !== 'retract') {
    return errorResponse('wiki_apply requires "op" to be "upsert" or "retract".');
  }
  if (args.op === 'upsert') {
    if (!args.claim || typeof args.claim.id !== 'string' || !args.claim.id.trim()) {
      return errorResponse('wiki_apply upsert requires a "claim" with a non-empty "id".');
    }
    if (typeof args.claim.text !== 'string' || !args.claim.text.trim()) {
      return errorResponse('wiki_apply upsert requires a non-empty claim "text".');
    }
  }
  if (args.op === 'retract' && (typeof args.claimId !== 'string' || !args.claimId.trim())) {
    return errorResponse('wiki_apply retract requires a non-empty "claimId".');
  }
  try {
    return await ctx.memory.wiki.apply(args);
  } catch (error) {
    return errorResponse(`wiki_apply failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}