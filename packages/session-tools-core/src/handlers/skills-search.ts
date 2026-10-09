/**
 * skills_search — keyword search over the eligible skill catalog.
 *
 * Thin facade over the registered SkillsToolRuntime: bounded (limit clamped to
 * SKILLS_SEARCH_MAX_LIMIT, excerpts truncated), provenance-rich (slug, source,
 * absolute path), typed errors. Mirrors the knowledge_search handler shape.
 */

import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse, successResponse } from '../response.ts';
import type { SkillSearchHit } from '../skills/runtime.ts';
import { requireSkillsRuntime, skillsRuntimeScope } from '../skills/scope.ts';
import type { SkillsSearchArgs } from '../tool-defs.ts';

/** Hard cap on requested hits — the tool description advertises 10 default / 25 max. */
export const SKILLS_SEARCH_MAX_LIMIT = 25;
const DEFAULT_LIMIT = 10;
const MAX_EXCERPT_CHARS = 240;

function formatHit(index: number, hit: SkillSearchHit): string {
  const lines = [
    `${index + 1}. **${hit.name}** (\`${hit.slug}\`)`,
    `   source: ${hit.source}`,
    `   path: ${hit.path}`,
    `   ${hit.description.replace(/\s+/g, ' ').trim() || '(no description)'}`,
  ];
  if (hit.excerpt) {
    const excerpt = hit.excerpt.replace(/\s+/g, ' ').trim();
    if (excerpt) lines.push(`   > ${excerpt.length <= MAX_EXCERPT_CHARS ? excerpt : `${excerpt.slice(0, MAX_EXCERPT_CHARS - 1)}…`}`);
  }
  return lines.join('\n');
}

export async function handleSkillsSearch(
  ctx: SessionToolContext,
  args: SkillsSearchArgs,
): Promise<ToolResult> {
  const query = typeof args?.query === 'string' ? args.query.trim() : '';
  if (!query) {
    return errorResponse('INVALID_ARGUMENT: skills_search requires a non-empty "query" string.');
  }

  const resolved = requireSkillsRuntime();
  if (!resolved.ok) return resolved.response;

  const scope = skillsRuntimeScope(ctx);
  if (!scope.workspaceRoot) {
    return errorResponse('SKILLS_UNAVAILABLE: session has no workspace root to resolve skills against.');
  }

  const requested = typeof args?.limit === 'number' && Number.isFinite(args.limit) ? args.limit : DEFAULT_LIMIT;
  const limit = Math.min(Math.max(Math.trunc(requested), 1), SKILLS_SEARCH_MAX_LIMIT);

  try {
    const hits = (await resolved.runtime.search({ ...scope, query, limit })).slice(0, SKILLS_SEARCH_MAX_LIMIT);
    const header = hits.length === 0
      ? `## Skills search: "${query}"\nNo skills matched.`
      : `## Skills search: "${query}"\n${hits.length} skill(s)`;
    const body = hits.map((hit, index) => formatHit(index, hit)).join('\n\n');
    return successResponse(body ? `${header}\n\n${body}` : header);
  } catch (error) {
    return errorResponse(`SKILLS_ERROR: ${error instanceof Error ? error.message : String(error)}`);
  }
}