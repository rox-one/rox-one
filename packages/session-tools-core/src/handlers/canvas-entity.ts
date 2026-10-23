/**
 * canvas_create_entity_card / canvas_link_entity — place live entity cards on
 * a «Доска» board. Storage, ACL, flags, and entity minting live behind
 * `ctx.canvas`, injected by SessionManager over the same CanvasFileStore /
 * entity-links path the surface UI uses.
 */
import type { SessionToolContext, CanvasEntityCardResult } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { successResponse, errorResponse } from '../response.ts';

const CANVAS_UNAVAILABLE = 'Canvas entity tools are not available in this context.';

function toError(error: unknown): string {
  if (error instanceof Error) {
    if ('code' in error && typeof (error as { code?: unknown }).code === 'string') {
      return `${(error as { code: string }).code}: ${error.message}`;
    }
    return error.message;
  }
  return 'Unknown error';
}

export interface CanvasCreateEntityCardArgs {
  boardId: string;
  kind: string;
  title?: string;
  props?: Record<string, unknown>;
  x?: number;
  y?: number;
}

export interface CanvasLinkEntityArgs {
  boardId: string;
  kind: string;
  entityId: string;
  x?: number;
  y?: number;
}

function formatResult(result: CanvasEntityCardResult): ToolResult {
  return successResponse(JSON.stringify(result, null, 2));
}

export async function handleCanvasCreateEntityCard(
  ctx: SessionToolContext,
  args: CanvasCreateEntityCardArgs,
): Promise<ToolResult> {
  if (!ctx.canvas) return errorResponse(CANVAS_UNAVAILABLE);
  if (!args?.boardId?.trim()) return errorResponse('boardId is required.');
  if (!args?.kind?.trim()) return errorResponse('kind is required.');

  try {
    const result = await ctx.canvas.createEntityCard({
      boardId: args.boardId.trim(),
      kind: args.kind.trim(),
      title: typeof args.title === 'string' ? args.title : undefined,
      props: args.props && typeof args.props === 'object' ? args.props : undefined,
      x: typeof args.x === 'number' ? args.x : undefined,
      y: typeof args.y === 'number' ? args.y : undefined,
    });
    return formatResult(result);
  } catch (error) {
    return errorResponse(`Failed to create entity card: ${toError(error)}`);
  }
}

export async function handleCanvasLinkEntity(
  ctx: SessionToolContext,
  args: CanvasLinkEntityArgs,
): Promise<ToolResult> {
  if (!ctx.canvas) return errorResponse(CANVAS_UNAVAILABLE);
  if (!args?.boardId?.trim()) return errorResponse('boardId is required.');
  if (!args?.kind?.trim()) return errorResponse('kind is required.');
  if (!args?.entityId?.trim()) return errorResponse('entityId is required.');

  try {
    const result = await ctx.canvas.linkEntity({
      boardId: args.boardId.trim(),
      kind: args.kind.trim(),
      entityId: args.entityId.trim(),
      x: typeof args.x === 'number' ? args.x : undefined,
      y: typeof args.y === 'number' ? args.y : undefined,
    });
    return formatResult(result);
  } catch (error) {
    return errorResponse(`Failed to link entity: ${toError(error)}`);
  }
}
