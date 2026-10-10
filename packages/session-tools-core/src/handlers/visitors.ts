/**
 * Visitor access tools (port-matrix row a1.6) — thin facades over the injected
 * `ctx.visitors` callbacks (wired by SessionManager to the VisitorAccessService).
 *
 * The handlers validate the argument shape (exactly one of email / github) and
 * report a typed VISITOR_STORE_UNAVAILABLE when no service is wired, so the model
 * never believes a grant was created when the store is absent.
 */
import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse } from '../response.ts';
import type { VisitorInviteToolArgs, VisitorRevokeToolArgs, VisitorListToolArgs } from '../tool-defs.ts';

const UNAVAILABLE =
  'visitor access is unavailable in this backend (no VisitorAccessService wired — VISITOR_STORE_UNAVAILABLE).';

export async function handleVisitorInvite(
  ctx: SessionToolContext,
  args: VisitorInviteToolArgs,
): Promise<ToolResult> {
  if (!ctx.visitors) return errorResponse(`visitor_invite: ${UNAVAILABLE}`);
  try {
    return await ctx.visitors.invite(args);
  } catch (error) {
    return errorResponse(`visitor_invite failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function handleVisitorRevoke(
  ctx: SessionToolContext,
  args: VisitorRevokeToolArgs,
): Promise<ToolResult> {
  if (!ctx.visitors) return errorResponse(`visitor_revoke: ${UNAVAILABLE}`);
  try {
    return await ctx.visitors.revoke(args);
  } catch (error) {
    return errorResponse(`visitor_revoke failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function handleVisitorList(
  ctx: SessionToolContext,
  args: VisitorListToolArgs,
): Promise<ToolResult> {
  if (!ctx.visitors) return errorResponse(`visitor_list: ${UNAVAILABLE}`);
  try {
    return await ctx.visitors.list(args);
  } catch (error) {
    return errorResponse(`visitor_list failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}