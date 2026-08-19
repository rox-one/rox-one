/**
 * Shared formatting + error-mapping helpers for the knowledge session tools.
 *
 * Output conventions (agent-readable markdown-ish text):
 * - Every payload carries provenance: connection id, `provider/kind/id` refs and
 *   `siyuan://` deep links (grammar owned by @craft-agent/core/knowledge refs.ts —
 *   never re-implemented here).
 * - Responses are bounded: item/snippet/body caps live next to the handlers that
 *   enforce them; truncation is always signposted with a visible marker.
 * - Errors are typed: KnowledgeError codes cross verbatim (`[ERROR] <CODE>: …`),
 *   unknown errors are wrapped as PROVIDER_ERROR, and a missing runtime (knowledge
 *   layer not running in this process) is a CONNECTION_UNAVAILABLE — handlers
 *   never throw raw and never hang.
 */

import { KnowledgeError, serializeKnowledgeRef, siyuanDeepLink } from '@craft-agent/core/knowledge';
import type { KnowledgeRef } from '@craft-agent/core/knowledge';
import type { ToolResult } from '../types.ts';
import { errorResponse } from '../response.ts';
import { getKnowledgeToolRuntime, type KnowledgeToolRuntime } from './runtime.ts';

/** Ellipsis-truncate to maxChars, appending a marker only when truncation happened. */
export function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}…`;
}

/** '@siyuan/document/<id>'-style serialized ref (provider/kind/id). */
export function formatRef(ref: KnowledgeRef): string {
  return serializeKnowledgeRef(ref);
}

/** Native deep link for a ref (siyuan://blocks/<id> for document/block). */
export function deepLinkFor(ref: KnowledgeRef): string {
  return siyuanDeepLink(ref);
}

/** One-line provenance header shared by all knowledge tool responses. */
export function provenanceLine(connectionId: string): string {
  return `_connection: ${connectionId}_`;
}

/** Map any thrown value onto a typed tool error; KnowledgeError codes pass through verbatim. */
export function knowledgeErrorResponse(error: unknown): ToolResult {
  if (error instanceof KnowledgeError) {
    return errorResponse(`${error.code}: ${error.message}`);
  }
  const message = error instanceof Error ? error.message : String(error);
  return errorResponse(`PROVIDER_ERROR: ${message}`);
}

/** Error text when the knowledge layer is not running in this process. */
export function knowledgeUnavailableResponse(): ToolResult {
  return errorResponse(
    'CONNECTION_UNAVAILABLE: Knowledge tools are unavailable in this process — no knowledge ' +
      'runtime is registered. The SiYuan knowledge tools run where the Craft knowledge RPC ' +
      'layer runs (desktop app / main server); they are not available in this session backend.',
  );
}

/** Fetch the registered runtime or return the typed unavailable error. */
export function requireKnowledgeRuntime():
  | { ok: true; runtime: KnowledgeToolRuntime }
  | { ok: false; response: ToolResult } {
  const runtime = getKnowledgeToolRuntime();
  if (!runtime) return { ok: false, response: knowledgeUnavailableResponse() };
  return { ok: true, runtime };
}
