/**
 * OMP Skills Discovery
 *
 * Scans OMP skill directories — `~/.omp/agent/skills` (global) and
 * `{workspaceRoot}/.omp/skills` (workspace-level) — and returns lightweight
 * metadata for each skill (SKILL.md YAML frontmatter: name/description).
 *
 * OMP skills are read-only in the ROX UI; the user can export them into
 * workspace ROX skills (see the `skills:importOmp` RPC handler).
 *
 * Caching: results are cached per directory with a 60s TTL plus a directory
 * mtime check (short-circuits a rescan when nothing was added/removed).
 * No fs watcher — deferred refresh only (PRD §5 Phase 1).
 */

import { existsSync, readdirSync, statSync } from 'fs';
import { homedir } from 'os';
import { join, resolve, sep } from 'path';
import matter from 'gray-matter';
import { readSkillHead } from './skill-head.ts';

/** Global OMP skills directory: ~/.omp/agent/skills/ */
export const OMP_GLOBAL_SKILLS_DIR = join(homedir(), '.omp', 'agent', 'skills');

/** Shared multi-agent skills directory also used by OMP-family CLIs: ~/.agents/skills/ */
export const OMP_SHARED_SKILLS_DIR = join(homedir(), '.agents', 'skills');

/** Workspace-level OMP skills relative directory name */
export const OMP_WORKSPACE_SKILLS_DIR = '.omp/skills';

export interface OmpSkillInfo {
  /** Directory name (slug) */
  slug: string;
  /** Display name from SKILL.md frontmatter (falls back to slug) */
  name: string;
  /** Description from SKILL.md frontmatter (may be empty) */
  description: string;
  /** Always 'omp' */
  source: 'omp';
  /** Absolute path to the skill directory */
  path: string;
}

interface DirCacheEntry {
  ts: number;
  dirMtimeMs: number;
  skills: OmpSkillInfo[];
}

const OMP_CACHE_TTL = 60_000; // 60 seconds (PRD: simple TTL cache, no watcher)
const dirCache = new Map<string, DirCacheEntry>();

/** Clear the OMP skills cache (called when a skill is imported or dirs change externally). */
export function invalidateOmpSkillsCache(): void {
  dirCache.clear();
}

/** OMP listing rule for one SKILL.md head: frontmatter name (slug fallback) and description. */
export function ompSkillFromHead(slug: string, path: string, text: string): OmpSkillInfo | null {
  try {
    const parsed = matter(text, {});
    return {
      slug,
      name: typeof parsed.data.name === 'string' && parsed.data.name ? parsed.data.name : slug,
      description: typeof parsed.data.description === 'string' ? parsed.data.description : '',
      source: 'omp',
      path,
    };
  } catch {
    return null;
  }
}

function scanDir(skillsDir: string): OmpSkillInfo[] {
  if (!existsSync(skillsDir)) return [];
  const resolvedDir = resolve(skillsDir);

  const now = Date.now();
  let dirMtimeMs = 0;
  try {
    dirMtimeMs = statSync(resolvedDir).mtimeMs;
  } catch {
    return [];
  }

  const cached = dirCache.get(resolvedDir);
  if (cached && now - cached.ts < OMP_CACHE_TTL && cached.dirMtimeMs === dirMtimeMs) {
    return cached.skills;
  }

  const skills: OmpSkillInfo[] = [];
  try {
    const entries = readdirSync(resolvedDir, { withFileTypes: true });
    for (const entry of entries) {
      // OMP skills are commonly symlinked directories (e.g. shared skill hubs)
      if (!entry.isDirectory()) {
        if (!entry.isSymbolicLink()) continue;
        try {
          if (!statSync(join(resolvedDir, entry.name)).isDirectory()) continue;
        } catch {
          continue;
        }
      }
      const skillDir = join(resolvedDir, entry.name);
      try {
        const head = readSkillHead(skillDir);
        const skill = head && ompSkillFromHead(entry.name, skillDir, head.text);
        if (skill) skills.push(skill);
      } catch {
        // An unsafe or invalid entry cannot expose bytes or hide its neighbours.
      }
    }
  } catch {
    // Ignore errors reading skills directory
  }

  dirCache.set(resolvedDir, { ts: now, dirMtimeMs, skills });
  return skills;
}

/**
 * List all OMP skills visible for a workspace.
/**
 * Sources (later entries win on slug conflict):
 * 1. Global OMP: `~/.omp/agent/skills/`
 * 2. Shared multi-agent: `~/.agents/skills/`
 * 3. Workspace: `{workspaceRootPath}/.omp/skills/`
 *
 * @param workspaceRootPath - Optional workspace root (enables workspace-level OMP skills)
 */
export function listOmpSkills(workspaceRootPath?: string): OmpSkillInfo[] {
  return listOmpSkillsWithShared(scanDir(OMP_SHARED_SKILLS_DIR), workspaceRootPath);
}

/**
 * {@link listOmpSkills} for a caller that already scanned the shared root
 * (`~/.agents/skills`) itself, so that root is read once per catalog walk.
 */
export function listOmpSkillsWithShared(shared: readonly OmpSkillInfo[], workspaceRootPath?: string): OmpSkillInfo[] {
  const bySlug = new Map<string, OmpSkillInfo>();
  for (const skill of scanDir(OMP_GLOBAL_SKILLS_DIR)) {
    bySlug.set(skill.slug, skill);
  }
  for (const skill of shared) {
    bySlug.set(skill.slug, skill);
  }
  if (workspaceRootPath) {
    for (const skill of scanDir(join(workspaceRootPath, OMP_WORKSPACE_SKILLS_DIR))) {
      bySlug.set(skill.slug, skill);
    }
  }
  return Array.from(bySlug.values());
}

/**
 * The entry {@link listOmpSkills} reports for one slug, reading only that
 * slug's directory in each root (workspace > shared > global). An unreadable
 * entry yields to the next root, exactly as it is skipped by a full scan.
 */
export function findOmpSkill(slug: string, workspaceRootPath?: string): OmpSkillInfo | null {
  if (!slug || slug === '.' || slug === '..' || /[/\\\0]/.test(slug)) return null;
  const roots = [...(workspaceRootPath ? [join(workspaceRootPath, OMP_WORKSPACE_SKILLS_DIR)] : []), OMP_SHARED_SKILLS_DIR, OMP_GLOBAL_SKILLS_DIR];
  for (const root of roots) {
    const skillDir = join(resolve(root), slug);
    try {
      const head = readSkillHead(skillDir);
      const skill = head && ompSkillFromHead(slug, skillDir, head.text);
      if (skill) return skill;
    } catch {
      // Same isolation as scanDir: the next root may still provide the slug.
    }
  }
  return null;
}

/**
 * Check that `skillPath` is a legit OMP skill directory (inside the global
 * OMP skills dir or the workspace OMP skills dir). Used by the import RPC to
 * avoid copying arbitrary filesystem paths.
 */
export function isOmpSkillPath(skillPath: string, workspaceRootPath?: string): boolean {
  const resolved = resolve(skillPath);
  const roots = [resolve(OMP_GLOBAL_SKILLS_DIR), resolve(OMP_SHARED_SKILLS_DIR)];
  if (workspaceRootPath) roots.push(resolve(join(workspaceRootPath, OMP_WORKSPACE_SKILLS_DIR)));
  return roots.some((root) => resolved.startsWith(root + sep) && existsSync(join(resolved, 'SKILL.md')));
}
