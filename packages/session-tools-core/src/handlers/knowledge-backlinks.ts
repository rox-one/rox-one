/**
 * knowledge_get_backlinks — list the documents/blocks that reference a knowledge
 * node (K-10 §3.1 `knowledge.get_backlinks` capability: the backlinks slice of
 * provider.getContext(ref, 'snapshot'); wire name uses underscores — Anthropic /
 * OpenAI-compatible tool-name grammars reject dots).
 *
 * Bounded at KNOWLEDGE_BACKLINKS_MAX_ITEMS with a visible truncation note.
 * Provenance: connection id + per-entry refs and siyuan:// deep links.
 */

import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse, successResponse } from '../response.ts';
import {
  deepLinkFor,
  formatRef,
  knowledgeErrorResponse,
  provenanceLine,
  requireKnowledgeRuntime,
} from '../knowledge/format.ts';
import {
  KNOWLEDGE_REF_ACCEPTED_FORMS,
  parseKnowledgeRefArg,
} from '../knowledge/parse-ref.ts';
import type { KnowledgeGetBacklinksArgs } from '../tool-defs.ts';

/** Cap on listed backlinks — keeps the map of adjacent documents scannable. */
export const KNOWLEDGE_BACKLINKS_MAX_ITEMS = 50;

export async function handleKnowledgeGetBacklinks(
  _ctx: SessionToolContext,
  args: KnowledgeGetBacklinksArgs,
): Promise<ToolResult> {
  const ref = parseKnowledgeRefArg(args?.ref);
  if (!ref) {
    return errorResponse(
      `INVALID_REF: knowledge_get_backlinks could not parse ref ${JSON.stringify(args?.ref)}. ` +
        `Accepted forms: ${KNOWLEDGE_REF_ACCEPTED_FORMS}`,
    );
  }

  const resolved = requireKnowledgeRuntime();
  if (!resolved.ok) return resolved.response;
  const { runtime } = resolved;
  const connectionId = typeof args.connectionId === 'string' && args.connectionId ? args.connectionId : undefined;

  try {
    const backlinks = await runtime.getBacklinks({
      ref,
      ...(connectionId ? { connectionId } : {}),
    });

    const header = [
      `## Backlinks for ${formatRef(ref)}`,
      provenanceLine(connectionId ?? '(default)'),
    ].join('\n');

    if (backlinks.length === 0) {
      return successResponse(`${header}\n\nNo backlinks — nothing references this node yet.`);
    }

    const shown = backlinks.slice(0, KNOWLEDGE_BACKLINKS_MAX_ITEMS);
    const lines = shown.map(
      (link, i) => `${i + 1}. **${link.title || link.ref.id}** (${link.ref.kind})\n   ref: ${formatRef(link.ref)}\n   link: ${deepLinkFor(link.ref)}`,
    );
    const footer =
      backlinks.length > shown.length
        ? `\n\n_Truncated: showing ${shown.length} of ${backlinks.length} backlinks._`
        : '';
    return successResponse(`${header}\n\n${lines.join('\n')}${footer}`);
  } catch (error) {
    return knowledgeErrorResponse(error);
  }
}
