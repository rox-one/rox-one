/** Project roadmap canonical JSON and derived Markdown persistence. */

import { closeSync, existsSync, openSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'fs';
import { createHash } from 'node:crypto';
import { isAbsolute, join, relative, resolve } from 'path';
import { atomicWriteFileSync } from '../utils/files.ts';
import { debug } from '../utils/debug.ts';
import { getProjectPath, listProjectAssets, loadProjectConfig } from './storage.ts';
import {
  isRoadmapRevision,
  normalizeRoadmap,
  ROADMAP_FILENAME,
  ROADMAP_MARKDOWN_FILENAME,
  roadmapToMarkdown,
  roadmapToPromptText,
  type ProjectRoadmap,
} from './roadmap.ts';

export interface LoadedRoadmap {
  roadmap: ProjectRoadmap;
  exists: boolean;
  corrupt: boolean;
  /** Hash of the exact file bytes, or "missing" before the first save. */
  revision: string;
}

export interface SaveRoadmapOptions {
  /** Omit only for compatibility with existing unversioned local callers. */
  expectedRevision?: string;
}

function inside(base: string, candidate: string): boolean {
  const path = relative(base, candidate);
  return path === '' || (path !== '..' && !path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(path));
}

function projectPath(workspaceRootPath: string, projectSlug: string): string {
  if (!projectSlug || projectSlug === '.' || projectSlug === '..' || /[/\\\0]/.test(projectSlug)) {
    throw new Error('PROJECT_ROADMAP_PATH: invalid project slug');
  }
  const base = resolve(workspaceRootPath, 'projects');
  if (existsSync(base) && !inside(realpathSync(workspaceRootPath), realpathSync(base))) {
    throw new Error('PROJECT_ROADMAP_PATH: projects directory escapes workspace');
  }
  const path = resolve(getProjectPath(workspaceRootPath, projectSlug));
  if (!inside(base, path)) throw new Error('PROJECT_ROADMAP_PATH: project escapes workspace');
  if (existsSync(path) && !inside(realpathSync(base), realpathSync(path))) {
    throw new Error('PROJECT_ROADMAP_PATH: project symlink escapes workspace');
  }
  return path;
}

export function getProjectRoadmapPath(workspaceRootPath: string, projectSlug: string): string {
  const dir = projectPath(workspaceRootPath, projectSlug);
  const path = join(dir, ROADMAP_FILENAME);
  if (existsSync(path) && !inside(realpathSync(dir), realpathSync(path))) {
    throw new Error('PROJECT_ROADMAP_PATH: roadmap symlink escapes project');
  }
  return path;
}

export function getProjectRoadmapMarkdownPath(workspaceRootPath: string, projectSlug: string): string {
  return join(projectPath(workspaceRootPath, projectSlug), ROADMAP_MARKDOWN_FILENAME);
}

function digest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function snapshot(path: string): { bytes: Buffer | null; value?: unknown; corrupt: boolean; revision: string } {
  let bytes: Buffer;
  try { bytes = readFileSync(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { bytes: null, corrupt: false, revision: 'missing' };
    }
    // Unreadable files are not empty/corrupt drafts that a caller can replace.
    throw error;
  }
  const revision = digest(bytes);
  try { return { bytes, value: JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')), corrupt: false, revision }; }
  catch { return { bytes, corrupt: true, revision }; }
}

export function loadProjectRoadmap(workspaceRootPath: string, projectSlug: string): LoadedRoadmap {
  const current = snapshot(getProjectRoadmapPath(workspaceRootPath, projectSlug));
  return {
    roadmap: { ...normalizeRoadmap(current.value), revision: current.revision },
    exists: current.bytes !== null,
    corrupt: current.corrupt,
    revision: current.revision,
  };
}

/**
 * Compare and replace under an exclusive lock shared by cooperating processes.
 * Unversioned callers remain compatible; every new read/save caller carries
 * the exact observed token. A failed corrupt-file backup stops before commit.
 */
export function saveProjectRoadmap(
  workspaceRootPath: string,
  projectSlug: string,
  input: unknown,
  options: SaveRoadmapOptions = {},
): ProjectRoadmap {
  const path = getProjectRoadmapPath(workspaceRootPath, projectSlug);
  const inputRevision = input && typeof input === 'object' ? (input as { revision?: unknown }).revision : undefined;
  const expectedRevision = options.expectedRevision ?? inputRevision;
  if (expectedRevision !== undefined && !isRoadmapRevision(expectedRevision)) {
    throw new Error('PROJECT_ROADMAP_INVALID_REVISION: invalid expected revision');
  }
  const config = loadProjectConfig(workspaceRootPath, projectSlug);
  if (!config) throw new Error(`Project not found: ${projectSlug}`);
  const lockPath = `${path}.lock`;
  let lock: number;
  try { lock = openSync(lockPath, 'wx', 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error('PROJECT_ROADMAP_BUSY: another writer holds the roadmap lock');
    }
    throw error;
  }
  try {
    writeFileSync(lock, JSON.stringify({ pid: process.pid, acquiredAt: Date.now() }));
    const current = snapshot(path);
    if (expectedRevision !== undefined && expectedRevision !== current.revision) {
      throw new Error('PROJECT_ROADMAP_CONFLICT: roadmap changed; reload before saving');
    }
    if (current.corrupt && current.bytes) {
      const backup = join(projectPath(workspaceRootPath, projectSlug), `roadmap.corrupt-${Date.now()}.json`);
      // Exclusive creation preserves an earlier backup. Failure is deliberately
      // propagated; canonical bytes must never be replaced without this copy.
      writeFileSync(backup, current.bytes, { flag: 'wx', mode: 0o600 });
    }
    const { revision: _inputRevision, ...normalized } = normalizeRoadmap(input);
    const roadmap: ProjectRoadmap = { ...normalized, updatedAt: Date.now() };
    const bytes = Buffer.from(JSON.stringify(roadmap, null, 2) + '\n');
    atomicWriteFileSync(path, bytes.toString('utf8'));
    try {
      const files = listProjectAssets(workspaceRootPath, projectSlug)
        .map((a) => a.filename).filter((f) => f !== config.icon);
      atomicWriteFileSync(getProjectRoadmapMarkdownPath(workspaceRootPath, projectSlug),
        roadmapToMarkdown(roadmap, config.name, undefined, { includeGeneratedNote: true, files }));
    } catch (error) {
      debug('[roadmap] failed to write roadmap.md', error);
    }
    return { ...roadmap, revision: digest(bytes) };
  } finally {
    try { closeSync(lock); }
    finally { unlinkSync(lockPath); }
  }
}

export function loadProjectRoadmapPromptText(workspaceRootPath: string, projectSlug: string): string | undefined {
  try {
    const { roadmap, exists } = loadProjectRoadmap(workspaceRootPath, projectSlug);
    return exists ? roadmapToPromptText(roadmap) ?? undefined : undefined;
  } catch { return undefined; }
}
