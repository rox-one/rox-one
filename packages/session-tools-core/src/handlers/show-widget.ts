/**
 * show_widget — stage agent-authored widget code as a board widget revision.
 *
 * All storage logic (wrapping, validation, atomic write, revisioning) lives
 * behind `ctx.boardWidgets`, injected by SessionManager over the SAME
 * `WidgetStore` the `board:widgetPut` RPC handler uses — this handler is never a
 * second writer, and this package stays dependency-free of @rox/shared.
 *
 * A widget becomes visible only after the renderer mounts the stored revision
 * through `board:widgetMount`; this tool only commits the revision.
 */

import type { SessionToolContext, BoardWidgetKind } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { successResponse, errorResponse } from '../response.ts';

const BOARD_WIDGETS_UNAVAILABLE =
  'Board widget tools are not available in this context.';

function toError(error: unknown): string {
  if (error instanceof Error) {
    if ('code' in error && typeof error.code === 'string') return `${error.code}: ${error.message}`;
    return error.message;
  }
  return 'Unknown error';
}

export interface ShowWidgetArgs {
  title: string;
  widget_code: string;
  kind?: BoardWidgetKind;
  name: string;
  sessionId?: string;
}

export async function handleShowWidget(
  ctx: SessionToolContext,
  args: ShowWidgetArgs
): Promise<ToolResult> {
  if (!ctx.boardWidgets) return errorResponse(BOARD_WIDGETS_UNAVAILABLE);
  if (!args?.name?.trim()) return errorResponse('name is required.');
  if (!args?.title?.trim()) return errorResponse('title is required.');
  if (!args?.widget_code?.trim()) return errorResponse('widget_code is required.');

  try {
    const record = await ctx.boardWidgets.putWidget({
      name: args.name.trim(),
      title: args.title,
      kind: args.kind ?? 'html',
      widgetCode: args.widget_code,
      sessionId: args.sessionId ?? ctx.sessionId,
    });
    return successResponse(JSON.stringify(record, null, 2));
  } catch (error) {
    return errorResponse(`Failed to stage widget: ${toError(error)}`);
  }
}