/**
 * knowledge_read — read a knowledge node (document/block/notebook) by ref, with an
 * optional bounded context snapshot (K-10 §3.1 `knowledge.read` capability: provider.get
 * + optional provider.getContext; wire name uses underscores — Anthropic / OpenAI-compatible
 * tool-name grammars reject dots).
 *
 * Bounded: markdown bodies truncate at KNOWLEDGE_READ_MAX_MARKDOWN_CHARS; context
 * children/backlinks lists are capped with visible truncation markers. Provenance:
 * connection id, serialized ref, siyuan:// deep link, content hash.
 */

import type { KnowledgeNode } from '@craft-agent/core/knowledge';
import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse, successResponse } from '../response.ts';
import {
  deepLinkFor,
  formatRef,
  knowledgeErrorResponse,
  provenanceLine,
  requireKnowledgeRuntime,
  truncateText,
} from '../knowledge/format.ts';
import {
  KNOWLEDGE_REF_ACCEPTED_FORMS,
  parseKnowledgeRefArg,
} from '../knowledge/parse-ref.ts';
import type { KnowledgeReadArgs } from '../tool-defs.ts';
import type { KnowledgeReadContextMode } from '../knowledge/runtime.ts';

/** Markdown body cap — a full SiYuan document otherwise blows past tool-result budgets. */
export const KNOWLEDGE_READ_MAX_MARKDOWN_CHARS = 32_000;
const MAX_CONTEXT_LIST_ITEMS = 50;
const MAX_CHILD_CHARS = 500;

const CONTEXT_MODES: ReadonlySet<string> = new Set(['none', 'snapshot', 'live-reference']);

function formatNode(node: KnowledgeNode, connectionId: string): string {
  const lines = [
    `## ${node.title || node.ref.id}`,
    provenanceLine(connectionId),
    `ref: ${formatRef(node.ref)}`,
    `link: ${deepLinkFor(node.ref)}`,
  ];
  if (node.path) lines.push(`path: ${node.path}`);
  lines.push(`contentHash: ${node.contentHash}`);
  if (node.updatedAt) lines.push(`updated: ${new Date(node.updatedAt).toISOString()}`);
  if (node.attributes.length > 0) {
    lines.push(`attributes: ${node.attributes.map((a) => `${a.key}=${a.value}`).join(', ')}`);
  }
  if (typeof node.markdown === 'string' && node.markdown.length > 0) {
    const truncated = node.markdown.length > KNOWLEDGE_READ_MAX_MARKDOWN_CHARS;
    lines.push(
      '',
      '---',
      '',
      truncateText(node.markdown, KNOWLEDGE_READ_MAX_MARKDOWN_CHARS),
      ...(truncated
        ? [`\n_[markdown truncated at ${KNOWLEDGE_READ_MAX_MARKDOWN_CHARS} characters]_`]
        : []),
    );
  }
  return lines.join('\n');
}

export async function handleKnowledgeRead(
  _ctx: SessionToolContext,
  args: KnowledgeReadArgs,
): Promise<ToolResult> {
  const ref = parseKnowledgeRefArg(args?.ref);
  if (!ref) {
    return errorResponse(
      `INVALID_REF: knowledge_read could not parse ref ${JSON.stringify(args?.ref)}. ` +
        `Accepted forms: ${KNOWLEDGE_REF_ACCEPTED_FORMS}`,
    );
  }
  const contextMode: KnowledgeReadContextMode =
    typeof args?.contextMode === 'string' && CONTEXT_MODES.has(args.contextMode)
      ? (args.contextMode as KnowledgeReadContextMode)
      : 'none';

  const resolved = requireKnowledgeRuntime();
  if (!resolved.ok) return resolved.response;
  const { runtime } = resolved;
  const connectionId = typeof args.connectionId === 'string' && args.connectionId ? args.connectionId : undefined;

  try {
    const { node, context } = await runtime.read({
      ref,
      contextMode,
      ...(connectionId ? { connectionId } : {}),
    });
    const parts = [formatNode(node, connectionId ?? runtime.defaultConnectionId?.() ?? '(default)')];

    if (context) {
      const sections: string[] = [];
      if (context.children.length > 0) {
        const shown = context.children.slice(0, MAX_CONTEXT_LIST_ITEMS);
        sections.push(
          `### Children (${context.children.length}${context.children.length > shown.length ? `, first ${shown.length} shown — truncated` : ''})`,
          ...shown.map((child) => `- \`${child.blockId}\`: ${truncateText(child.content.replace(/\s+/g, ' ').trim(), MAX_CHILD_CHARS)}`),
        );
      }
      if (context.backlinks.length > 0) {
        const shown = context.backlinks.slice(0, MAX_CONTEXT_LIST_ITEMS);
        sections.push(
          `### Backlinks (${context.backlinks.length}${context.backlinks.length > shown.length ? `, first ${shown.length} shown — truncated` : ''})`,
          ...shown.map((link) => `- **${link.title || link.ref.id}** — ${formatRef(link.ref)} · ${deepLinkFor(link.ref)}`),
        );
      }
      if (sections.length > 0) {
        parts.push('', `## Context (mode: ${context.mode})`, '', ...sections);
      }
    }

    return successResponse(parts.join('\n'));
  } catch (error) {
    return knowledgeErrorResponse(error);
  }
}
