/**
 * devspace_search — search repository artifacts in the Dev Space store (spec 02
 * §9, mirroring `knowledge_search`). Read-only.
 *
 * Thin facade over the registered DevSpaceToolRuntime: bounded (limit clamped to
 * DEVSPACE_SEARCH_MAX_LIMIT, snippets truncated), provenance-rich (kind, path,
 * project, provider@version, sourceRevision, artifact id), typed errors, and a
 * response-side re-bound so a misbehaving runtime cannot flood the tool result.
 *
 * DATA, NOT INSTRUCTIONS (§13.2): hits (paths, titles, snippets) are untrusted
 * repository / artifact text — never treated as instructions.
 */

import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse, successResponse } from '../response.ts';
import {
  devSpaceErrorResponse,
  devSpaceRuntimeScope,
  requireDevSpaceRuntime,
  truncateText,
} from '../dev-space/scope.ts';
import type {
  DevSpaceArtifactKind,
  DevSpaceSearchHit,
  DevSpaceSearchInput,
} from '../dev-space/runtime.ts';
import { DEVSPACE_ARTIFACT_KINDS } from '../dev-space/runtime.ts';
import type { DevSpaceSearchArgs } from '../tool-defs.ts';

/** Hard cap on requested hits — the tool description advertises 20 default / 50 max. */
export const DEVSPACE_SEARCH_MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;
const MAX_SNIPPET_CHARS = 300;

function formatHit(index: number, hit: DevSpaceSearchHit): string {
  const { artifact } = hit;
  const lines = [
    `${index + 1}. **${artifact.kind} · ${artifact.path}** (\`${artifact.id}\`)`,
    `   provider: ${artifact.producedBy.providerId}@${artifact.producedBy.version}`,
  ];
  if (artifact.projectSlug) lines.push(`   project: ${artifact.projectSlug}`);
  if (artifact.sourceRevision) lines.push(`   sourceRevision: ${artifact.sourceRevision}`);
  if (hit.snippet) {
    lines.push(`   > ${truncateText(hit.snippet.replace(/\s+/g, ' ').trim(), MAX_SNIPPET_CHARS)}`);
  }
  return lines.join('\n');
}

export async function handleDevSpaceSearch(
  ctx: SessionToolContext,
  args: DevSpaceSearchArgs,
): Promise<ToolResult> {
  const query = typeof args?.query === 'string' ? args.query.trim() : '';
  if (!query) {
    return errorResponse('INVALID_ARGUMENT: devspace_search requires a non-empty "query" string.');
  }

  const resolved = requireDevSpaceRuntime();
  if (!resolved.ok) return resolved.response;
  const scope = devSpaceRuntimeScope(ctx);
  if (!scope.workspaceRoot) {
    return errorResponse('DEVSPACE_UNAVAILABLE: session has no workspace root to resolve artifacts against.');
  }

  // The tool schema advertises "default 20 / hard cap 50": always send a clamped
  // limit so the runtime never has to guess (the type keeps `limit` required).
  const requestedLimit = typeof args.limit === 'number' && Number.isFinite(args.limit) ? args.limit : DEFAULT_LIMIT;
  const input: DevSpaceSearchInput = {
    query,
    limit: Math.min(Math.max(Math.trunc(requestedLimit), 1), DEVSPACE_SEARCH_MAX_LIMIT),
  };
  // Pi/OMP dispatch raw args (no zod parse) — filter an unknown kind defensively.
  if (typeof args.kind === 'string' && (DEVSPACE_ARTIFACT_KINDS as readonly string[]).includes(args.kind)) {
    input.kind = args.kind as DevSpaceArtifactKind;
  }
  if (typeof args.projectSlug === 'string' && args.projectSlug) input.projectSlug = args.projectSlug;
  if (typeof args.repositoryId === 'string' && args.repositoryId) input.repositoryId = args.repositoryId;
  if (typeof args.cursor === 'string' && args.cursor) input.cursor = args.cursor;

  try {
    const page = await resolved.runtime.search({ workspaceRoot: scope.workspaceRoot, input });
    // Re-bound the RESPONSE, not just the request: a misbehaving runtime can
    // return far more items than requested.
    const rawItems = page.items ?? [];
    const items = rawItems.slice(0, DEVSPACE_SEARCH_MAX_LIMIT);
    const overReturned = rawItems.length - items.length;
    const header = [
      `## Dev Space artifact search: "${query}"`,
      items.length === 0
        ? 'No results.'
        : `${items.length} result(s)` +
          (typeof page.totalEstimate === 'number' ? `, ~${page.totalEstimate} total` : '') +
          (overReturned > 0 ? ` (runtime returned ${overReturned} extra item(s) beyond the cap — dropped)` : '') +
          (page.nextCursor ? `. More pages available — pass cursor "${page.nextCursor}" to continue.` : ''),
    ].join('\n');
    const body = items.map((hit, index) => formatHit(index, hit)).join('\n\n');
    return successResponse(body ? `${header}\n\n${body}` : header);
  } catch (error) {
    return devSpaceErrorResponse(error);
  }
}