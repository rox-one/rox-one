/**
 * Default-on local "microservice" folder sources (Program 35 / P35-08).
 *
 * These are local folder sources pointing at real directories. They are not
 * live importers (no browser-profile scrape, no running-app enumerator).
 * Existing preferences are preserved; exact obsolete native defaults can migrate
 * on Windows when the old path is absent and the replacement is verified.
 */

import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, posix, win32 } from 'node:path';
import type { FolderSourceConfig } from './types.ts';
import { toPortablePath } from '../utils/paths.ts';
import { ensureLocalNotesSource } from './builtin-sources.ts';
import { isReadableDirectory } from './storage.ts';

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
  /** Runtime defaults; injectable so migration tests only probe temporary paths. */
  platform?: NodeJS.Platform;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
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
    // Native app folders may not exist on this machine. A pointer is not proof
    // of a successful connection; leave it enabled and available for testing.
    connectionStatus: isReadableDirectory(spec.path) ? 'connected' : 'untested',
    createdAt: now,
    updatedAt: now,
  };

  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
  writeFileSync(join(dir, 'guide.md'), spec.guide, 'utf-8');
}

/** Native folder locations, without creating directories or probing app data. */
export function resolveNativeFolderSourcePaths(
  platform: NodeJS.Platform = process.platform,
  homeDir: string = homedir(),
  env: NodeJS.ProcessEnv = process.env,
): { applications: string; telegram: string } {
  if (platform === 'win32') {
    const appData = env.APPDATA || win32.join(homeDir, 'AppData', 'Roaming');
    return {
      applications: win32.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
      telegram: win32.join(appData, 'Telegram Desktop'),
    };
  }
  if (platform === 'darwin') {
    return {
      applications: posix.join(homeDir, 'Applications'),
      telegram: posix.join(homeDir, 'Library', 'Application Support', 'Telegram'),
    };
  }
  const dataHome = env.XDG_DATA_HOME || posix.join(homeDir, '.local', 'share');
  return {
    applications: posix.join(dataHome, 'applications'),
    telegram: posix.join(dataHome, 'TelegramDesktop'),
  };
}

function buildSpecs(workspaceRootPath: string, opts: MicroserviceSeedOptions): MicroserviceSpec[] {
  const tasksPath = join(workspaceRootPath, 'tasks');
  const projectsPath = join(workspaceRootPath, 'projects');
  const memoryPath = join(opts.roxRoot, 'memory');
  const sessionsPath = join(opts.roxRoot, 'sessions');
  const platform = opts.platform ?? process.platform;
  const { applications: applicationsPath, telegram: telegramPath } = resolveNativeFolderSourcePaths(platform, opts.homeDir, opts.env);

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
      tagline: 'Native application folder and launch shortcuts',
      path: applicationsPath,
      mkdir: false,
      guide: `# Applications\n\nNative application folder (${platform}):\n\n${applicationsPath}\n\n${platform === 'darwin' ? 'Other macOS application folders: /Applications and ~/Library/Applications.\n\n' : ''}This is a folder pointer, not a live process enumerator. The folder may be absent if no applications have been installed there.\n`,
    },
    {
      slug: 'telegram-support',
      name: 'Telegram Desktop data',
      icon: '✈️',
      tagline: 'Native Telegram Desktop data folder',
      path: telegramPath,
      mkdir: false,
      guide: `# Telegram Desktop data\n\nNative folder (${platform}):\n\n${telegramPath}\n\nThis is a folder pointer, not a Telegram API importer. The folder may be absent if Telegram Desktop is not installed or uses a portable/custom data directory.\n`,
    },
  ];
}

/** ENOENT is evidence of absence; a permissions failure is not. */
function isAbsent(path: string): boolean {
  try {
    lstatSync(path);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT';
  }
}

function migrateLegacyNativeDefault(
  configPath: string,
  spec: MicroserviceSpec,
  opts: MicroserviceSeedOptions,
  now: number,
): void {
  if ((opts.platform ?? process.platform) !== 'win32') return;
  if (spec.slug !== 'applications' && spec.slug !== 'telegram-support') return;
  try {
    // Read raw config: expansion would erase the exact legacy-path signature.
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as FolderSourceConfig;
    const applications = spec.slug === 'applications';
    const suffix = applications ? ['Applications'] : ['Library', 'Application Support', 'Telegram'];
    const oldPath = join(opts.homeDir ?? homedir(), ...suffix);
    const portable = `~/${suffix.join('/')}`;
    const oldName = applications ? 'Applications' : 'Telegram Application Support';
    const oldTagline = applications ? 'Applications and ~/Library/Applications' : 'Telegram Application Support folder';
    if (config.id !== `ms-${spec.slug}` || config.slug !== spec.slug || config.type !== 'local' ||
        config.provider !== 'craft-local' || config.name !== oldName || config.icon !== spec.icon ||
        config.tagline !== oldTagline || config.local?.format !== 'markdown' ||
        ![portable, portable.replaceAll('/', '\\'), oldPath].includes(config.local.path)) return;
    if (!isAbsent(oldPath) || !isReadableDirectory(spec.path)) return;

    const oldGuide = applications
      ? `# Applications\n\nFolder source for installed apps. Paths (macOS):\n\n- ${oldPath}\n- /Applications\n- ~/Library/Applications\n\nThis is a folder pointer, not a live process enumerator.\n`
      : `# Telegram Application Support\n\nFolder source for:\n\n${oldPath}\n\nThis is a folder pointer, not a Telegram API importer.\n`;
    const guidePath = join(dirname(configPath), 'guide.md');
    // User-authored guides stay authoritative. Only replace the seeder's exact text.
    if (existsSync(guidePath) && readFileSync(guidePath, 'utf8') === oldGuide) {
      writeFileSync(guidePath, spec.guide, 'utf8');
    }
    config.local = { ...config.local, path: toPortablePath(spec.path) };
    config.name = spec.name;
    config.tagline = spec.tagline;
    config.connectionStatus = 'connected';
    delete config.connectionError;
    config.updatedAt = now;
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  } catch {
    // A malformed config or failed filesystem probe must not block bootstrap.
  }
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
  for (const spec of buildSpecs(workspaceRootPath, opts)) {
    const configPath = join(sourcesDir(workspaceRootPath), spec.slug, 'config.json');
    if (existsSync(configPath)) {
      migrateLegacyNativeDefault(configPath, spec, opts, now);
      continue;
    }
    writeLocalSource(workspaceRootPath, spec, now);
    created.push(spec.slug);
  }
  return { created };
}
