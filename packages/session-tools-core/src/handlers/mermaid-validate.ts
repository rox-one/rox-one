/**
 * Mermaid Validate Handler
 *
 * Validates Mermaid diagram syntax using beautiful-mermaid renderer.
 * No DOM required - works identically in Claude and Codex.
 */

import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { renderMermaidSVG } from 'beautiful-mermaid';
import { normalizeMermaidSource } from '../validation.ts';

export interface MermaidValidateArgs {
  code: string;
  render?: boolean;
}

/** Legacy hidden Rox home as shown in hints (flag OFF default). */
const LEGACY_ROX_HOME_DISPLAY = '~/.rox';

/**
 * Handle the mermaid_validate tool call.
 *
 * Uses renderMermaidSVG from beautiful-mermaid to validate the same diagram
 * families the renderer accepts, including xychart-beta. YAML frontmatter is
 * stripped before validation because it is metadata rather than diagram syntax.
 * If rendering succeeds, the diagram is valid. If rendering throws, returns the
 * error message.
 */
export async function handleMermaidValidate(
  ctx: SessionToolContext,
  args: MermaidValidateArgs
): Promise<ToolResult> {
  const { code } = args;
  // W1-13: the docs live in the Rox home the backend reports; without it,
  // the legacy text (unchanged flag-OFF behaviour).
  const mermaidDoc = `${ctx.roxHomeDisplay ?? LEGACY_ROX_HOME_DISPLAY}/docs/mermaid.md`;

  try {
    // renderMermaidSVG throws if syntax/layout is invalid. Use the renderer path
    // rather than parseMermaid(), which only understands flowchart/state syntax.
    renderMermaidSVG(normalizeMermaidSource(code));

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          valid: true,
          message: 'Diagram syntax is valid',
        }, null, 2),
      }],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown parse error';

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          valid: false,
          error: errorMessage,
          suggestion: `Check the syntax against ${mermaidDoc}`,
        }, null, 2),
      }],
      isError: true,
    };
  }
}
