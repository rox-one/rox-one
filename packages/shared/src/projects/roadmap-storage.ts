/**
 * Project roadmap disk IO: roadmap.json (canonical) + roadmap.md (mirror)
 * next to the project's config.json.
 */

import { copyFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { atomicWriteFileSync } from '../utils/files.ts';
import { debug } from '../utils/debug.ts';
import { getProjectPath, listProjectAssets, loadProjectConfig } from './storage.ts';
import {
  normalizeRoadmap,
  ROADMAP_FILENAME,
  ROADMAP_MARKDOWN_FILENAME,
  roadmapToMarkdown,
  roadmapToPromptText,
  type ProjectRoadmap,
} from './roadmap.ts';

export interface LoadedRoadmap {
  roadmap: ProjectRoadmap;
  /** roadmap.json exists on disk. */
  exists: boolean;
  /** roadmap.json exists but could not be parsed; it is backed up before the next save. */
  corrupt: boolean;
}

export function getProjectRoadmapPath(workspaceRootPath: string, projectSlug: string): string {
  return join(getProjectPath(workspaceRootPath, projectSlug), ROADMAP_FILENAME);
}

export function getProjectRoadmapMarkdownPath(workspaceRootPath: string, projectSlug: string): string {
  return join(getProjectPath(workspaceRootPath, projectSlug), ROADMAP_MARKDOWN_FILENAME);
}

function readRaw(path: string): { ok: true; value: unknown } | { ok: false } {
  try {
    const text = readFileSync(path, 'utf-8').replace(/^\uFEFF/, '');
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    debug('[roadmap] failed to parse', path, error);
    return { ok: false };
  }
}

/**
 * Load a project's roadmap. Projects created before roadmaps existed have no
 * roadmap.json → an empty roadmap (config.json is never touched).
 */
export function loadProjectRoadmap(workspaceRootPath: string, projectSlug: string): LoadedRoadmap {
  const path = getProjectRoadmapPath(workspaceRootPath, projectSlug);
  if (!existsSync(path)) return { roadmap: normalizeRoadmap(undefined), exists: false, corrupt: false };
  const raw = readRaw(path);
  if (!raw.ok) return { roadmap: normalizeRoadmap(undefined), exists: true, corrupt: true };
  return { roadmap: normalizeRoadmap(raw.value), exists: true, corrupt: false };
}

/**
 * Save roadmap.json (atomic) and regenerate roadmap.md. An unparseable
 * existing roadmap.json is copied to roadmap.corrupt-<ts>.json first so a bad
 * edit by hand is never silently lost.
 */
export function saveProjectRoadmap(workspaceRootPath: string, projectSlug: string, input: unknown): ProjectRoadmap {
  const config = loadProjectConfig(workspaceRootPath, projectSlug);
  if (!config) throw new Error(`Project not found: ${projectSlug}`);
  const path = getProjectRoadmapPath(workspaceRootPath, projectSlug);
  if (existsSync(path) && !readRaw(path).ok) {
    try {
      copyFileSync(path, join(getProjectPath(workspaceRootPath, projectSlug), `roadmap.corrupt-${Date.now()}.json`));
    } catch (error) {
      debug('[roadmap] failed to back up corrupt roadmap', error);
    }
  }
  const roadmap: ProjectRoadmap = { ...normalizeRoadmap(input), updatedAt: Date.now() };
  atomicWriteFileSync(path, JSON.stringify(roadmap, null, 2) + '\n');
  try {
    const files = listProjectAssets(workspaceRootPath, projectSlug)
      .map((a) => a.filename)
      .filter((f) => f !== config.icon);
    atomicWriteFileSync(
      getProjectRoadmapMarkdownPath(workspaceRootPath, projectSlug),
      roadmapToMarkdown(roadmap, config.name, undefined, { includeGeneratedNote: true, files }),
    );
  } catch (error) {
    debug('[roadmap] failed to write roadmap.md', error);
  }
  return roadmap;
}

/** Roadmap text for system-prompt injection, or undefined when empty/missing. */
export function loadProjectRoadmapPromptText(workspaceRootPath: string, projectSlug: string): string | undefined {
  try {
    const { roadmap, exists } = loadProjectRoadmap(workspaceRootPath, projectSlug);
    if (!exists) return undefined;
    return roadmapToPromptText(roadmap) ?? undefined;
  } catch {
    return undefined;
  }
}
