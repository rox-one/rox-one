/**
 * Shared helpers for the skills session tools: resolve the workspace scope from
 * the session context, validate slugs at the tool boundary, and require the
 * registered runtime with a typed error.
 */

import { realpathSync } from 'node:fs';
import { isAbsolute, relative, sep } from 'node:path';
import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse } from '../response.ts';
import { getSkillsToolRuntime, type SkillsRuntimeScope, type SkillsToolRuntime } from './runtime.ts';

/** Skill slug grammar: alnum first char, then alnum/dot/dash/underscore. */
const SAFE_SKILL_SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

/** Reject slugs that could escape the skill roots (separators, `..`, hidden). */
export function isSafeSkillSlug(slug: unknown): slug is string {
  return typeof slug === 'string' && SAFE_SKILL_SLUG.test(slug) && !slug.includes('..');
}

/**
 * True when `candidate`'s REAL path stays inside `root`'s REAL path. Both sides
 * are resolved, so a symlink whose declared path looks contained but whose
 * target escapes the discovered root is rejected. An unresolvable candidate is
 * never treated as confined.
 */
export function isWithinRealRoot(candidate: string, root: string): boolean {
  try {
    const realRoot = realpathSync(root);
    const realCandidate = realpathSync(candidate);
    const rel = relative(realRoot, realCandidate);
    return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
  } catch {
    return false;
  }
}

/** The workspace/project scope a skills tool resolves the catalog against. */
export function skillsRuntimeScope(ctx: SessionToolContext): SkillsRuntimeScope {
  const workspaceRoot = typeof ctx.workspacePath === 'string' ? ctx.workspacePath : '';
  return {
    workspaceRoot,
    ...(ctx.workingDirectory ? { projectRoot: ctx.workingDirectory } : {}),
  };
}

export function skillsUnavailableResponse(): ToolResult {
  return errorResponse(
    'SKILLS_UNAVAILABLE: Skill tools are unavailable in this process — no skills runtime is ' +
      'registered. The skills tools run where the ROX skills RPC layer runs (desktop app / main ' +
      'server); they are not available in this session backend.',
  );
}

/** Fetch the registered runtime or return the typed unavailable error. */
export function requireSkillsRuntime():
  | { ok: true; runtime: SkillsToolRuntime }
  | { ok: false; response: ToolResult } {
  const runtime = getSkillsToolRuntime();
  if (!runtime) return { ok: false, response: skillsUnavailableResponse() };
  return { ok: true, runtime };
}