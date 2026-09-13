/**
 * Default-on local "microservice" folder sources (Program 35 / P35-08).
 *
 * These are local folder sources pointing at real directories. They are not
 * live importers (no browser-profile scrape, no running-app enumerator).
 * Existing source configs are never overwritten.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { FolderSourceConfig } from './types.ts';
import { toPortablePath } from '../utils/paths.ts';
import { ensureLocalNotesSource } from './builtin-sources.ts';

export const DEFAULT_ENABLED_LOCAL_SOURCE_SLUGS = [
  'notes',
  'memory',
  'sessions',
  'tasks',
  'projects',
  'workspace-tree',
  'applications',
  'telegram-support',
] as const;

export const DEFAULT_ENABLED_MCP_SOURCE_SLUGS = ['craft-agents-docs'] as const;

export const DEFAULT_ENABLED_SOURCE_SLUGS = [
  ...DEFAULT_ENABLED_LOCAL_SOURCE_SLUGS,
  ...DEFAULT_ENABLED_MCP_SOURCE_SLUGS,
] as const;

export function collectDefaultEnabledSourceSlugs(): string[] {
  return [...DEFAULT_ENABLED_SOURCE_SLUGS];
}

export interface MicroserviceSeedOptions {
  roxRoot: string;
  notesPath: string;
}

interface MicroserviceSpec {
  slug: string;
  name: string;
  icon: string;
  tagline: string;
  path: string;
  mkdir: boolean;
  guide: string;
}

function sourcesDir(workspaceRootPath: string): string {
  return join(workspaceRootPath, 'sources');
}

function writeLocalSource(
  workspaceRootPath: string,
  spec: MicroserviceSpec,
  now: number,
): void {
  const dir = join(sourcesDir(workspaceRootPath), spec.slug);
  const configPath = join(dir, 'config.json');
  if (existsSync(configPath)) return;

  if (spec.mkdir) {
    mkdirSync(spec.path, { recursive: true });
  }
  mkdirSync(dir, { recursive: true });

  const config: FolderSourceConfig = {
    id: `ms-${spec.slug}`,
    name: spec.name,
    slug: spec.slug,
    enabled: true,
    provider: 'craft-local',
    type: 'local',
    local: {
      path: toPortablePath(spec.path),
      format: 'markdown',
    },
    icon: spec.icon,
    tagline: spec.tagline,
    isAuthenticated: true,
    connectionStatus: 'connected',
    createdAt: now,
    updatedAt: now,
  };

  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
  writeFileSync(join(dir, 'guide.md'), spec.guide, 'utf-8');
}

function homeJoin(...parts: string[]): string {
  try {
    return join(homedir(), ...parts);
  } catch {
    return join('~', ...parts);
  }
}

function buildSpecs(workspaceRootPath: string, roxRoot: string): MicroserviceSpec[] {
  const tasksPath = join(workspaceRootPath, 'tasks');
  const projectsPath = join(workspaceRootPath, 'projects');
  const memoryPath = join(roxRoot, 'memory');
  const sessionsPath = join(roxRoot, 'sessions');
  const applicationsPath = homeJoin('Applications');
  const telegramPath = homeJoin('Library', 'Application Support', 'Telegram');

  return [
    {
      slug: 'memory',
      name: 'Memory',
      icon: '🧠',
      tagline: 'Self-learning memory files',
      path: memoryPath,
      mkdir: true,
      guide: `# Memory\n\nLocal memory files live at:\n\n${memoryPath}\n`,
    },
    {
      slug: 'sessions',
      name: 'Last sessions',
      icon: '💬',
      tagline: 'Imported and archived session transcripts',
      path: sessionsPath,
      mkdir: true,
      guide: `# Last sessions\n\nSession transcripts and imports live at:\n\n${sessionsPath}\n`,
    },
    {
      slug: 'tasks',
      name: 'Tasks',
      icon: '✅',
      tagline: 'Workspace task specs',
      path: tasksPath,
      mkdir: true,
      guide: `# Tasks\n\nWorkspace tasks live at:\n\n${tasksPath}\n`,
    },
    {
      slug: 'projects',
      name: 'Projects',
      icon: '📁',
      tagline: 'Workspace projects',
      path: projectsPath,
      mkdir: true,
      guide: `# Projects\n\nWorkspace projects live at:\n\n${projectsPath}\n`,
    },
    {
      slug: 'workspace-tree',
      name: 'Folder tree',
      icon: '🗂️',
      tagline: 'Workspace folder tree',
      path: workspaceRootPath,
      mkdir: false,
      guide: `# Folder tree\n\nThe workspace root:\n\n${workspaceRootPath}\n`,
    },
    {
      slug: 'applications',
      name: 'Applications',
      icon: '🧩',
      tagline: 'Applications and ~/Library/Applications',
      path: applicationsPath,
      mkdir: false,
      guide: `# Applications\n\nFolder source for installed apps. Paths (macOS):\n\n- ${applicationsPath}\n- /Applications\n- ~/Library/Applications\n\nThis is a folder pointer, not a live process enumerator.\n`,
    },
    {
      slug: 'telegram-support',
      name: 'Telegram Application Support',
      icon: '✈️',
      tagline: 'Telegram Application Support folder',
      path: telegramPath,
      mkdir: false,
      guide: `# Telegram Application Support\n\nFolder source for:\n\n${telegramPath}\n\nThis is a folder pointer, not a Telegram API importer.\n`,
    },
  ];
}

/**
 * Seed default-on local microservice sources when missing.
 * Notes uses the existing seeder so a custom/disabled Notes config stays authoritative.
 */
export function ensureDefaultMicroserviceSources(
  workspaceRootPath: string,
  opts: MicroserviceSeedOptions,
): { created: string[] } {
  mkdirSync(sourcesDir(workspaceRootPath), { recursive: true });
  ensureLocalNotesSource(workspaceRootPath, opts.notesPath);

  const now = Date.now();
  const created: string[] = [];
  for (const spec of buildSpecs(workspaceRootPath, opts.roxRoot)) {
    const configPath = join(sourcesDir(workspaceRootPath), spec.slug, 'config.json');
    if (existsSync(configPath)) continue;
    writeLocalSource(workspaceRootPath, spec, now);
    created.push(spec.slug);
  }
  return { created };
}
