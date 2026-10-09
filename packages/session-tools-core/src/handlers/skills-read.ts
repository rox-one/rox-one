/**
 * skills_read — load one skill's SKILL.md body by slug.
 *
 * The slug is validated at the tool boundary and resolution happens through the
 * registered SkillsToolRuntime, which confines reads to the skill roots: the
 * production implementation advertises only skills whose realpath stays inside
 * their discovered root and resolves bodies through the hardened, symlink-safe
 * `readSkillInstructions` reader. A raw path never crosses this boundary.
 */

import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse, successResponse } from '../response.ts';
import { isSafeSkillSlug, requireSkillsRuntime, skillsRuntimeScope } from '../skills/scope.ts';
import type { SkillsReadArgs } from '../tool-defs.ts';

/** Bound on returned body characters; truncation is signposted. */
export const SKILLS_READ_MAX_CHARS = 100_000;

export async function handleSkillsRead(
  ctx: SessionToolContext,
  args: SkillsReadArgs,
): Promise<ToolResult> {
  const rawSlug = typeof args?.slug === 'string' ? args.slug.trim() : '';
  if (!rawSlug) {
    return errorResponse('INVALID_ARGUMENT: skills_read requires a non-empty "slug" string.');
  }
  if (!isSafeSkillSlug(rawSlug)) {
    return errorResponse(
      `INVALID_ARGUMENT: unsafe skill slug ${JSON.stringify(args?.slug)} — skill slugs never ` +
        'contain path separators, "..", or leading dots.',
    );
  }

  const resolved = requireSkillsRuntime();
  if (!resolved.ok) return resolved.response;

  const scope = skillsRuntimeScope(ctx);
  if (!scope.workspaceRoot) {
    return errorResponse('SKILLS_UNAVAILABLE: session has no workspace root to resolve skills against.');
  }

  let skill;
  try {
    skill = await resolved.runtime.read({ ...scope, slug: rawSlug });
  } catch (error) {
    return errorResponse(`SKILLS_ERROR: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!skill) {
    return errorResponse(`SKILL_NOT_FOUND: no eligible skill "${rawSlug}" in this workspace.`);
  }

  const truncated = skill.content.length > SKILLS_READ_MAX_CHARS
    ? `${skill.content.slice(0, SKILLS_READ_MAX_CHARS)}\n\n_[content truncated at ${SKILLS_READ_MAX_CHARS} characters]_`
    : skill.content;
  const body = [`## ${skill.name} (${skill.slug})`, `_path: ${skill.path}_`, '', truncated].join('\n');
  return successResponse(body);
}