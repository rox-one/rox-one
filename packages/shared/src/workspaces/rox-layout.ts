/**
 * User-facing `~/rox` folder layout (Program 35 / P35-08).
 *
 * Prefer `$HOME/rox`. If home is unavailable or mkdir fails, fall back to
 * `<workspaceRoot>/rox`. Isolated test runs (`NODE_ENV=test` or `BUN_TEST`)
 * always use the workspace fallback so they never write into `$HOME/rox`.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const ROX_LAYOUT_FOLDERS = [
  'notes',
  'audio',
  'transcripts',
  'sessions',
  'imports',
  'passwords',
  'extensions',
  'mcp',
  'tools',
  'agents',
  'rules',
  'skills',
  'memory',
] as const;

export type RoxLayoutFolder = (typeof ROX_LAYOUT_FOLDERS)[number];

export interface RoxLayoutOptions {
  homeDir?: string;
  workspaceRoot?: string;
}

function isIsolatedLayoutEnv(): boolean {
  return process.env.NODE_ENV === 'test' || Boolean(process.env.BUN_TEST);
}

export function resolveRoxRoot(opts: RoxLayoutOptions = {}): string {
  const override = opts.homeDir !== undefined ? opts.homeDir : process.env.ROX_LAYOUT_HOME;
  if (typeof override === 'string' && override.length > 0) {
    return join(override, 'rox');
  }
  const preferWorkspace =
    (typeof override === 'string' && override.length === 0) || isIsolatedLayoutEnv();
  if (preferWorkspace && opts.workspaceRoot) {
    return join(opts.workspaceRoot, 'rox');
  }
  try {
    const home = homedir();
    if (home) return join(home, 'rox');
  } catch {
    // fall through to workspace
  }
  if (opts.workspaceRoot) return join(opts.workspaceRoot, 'rox');
  throw new Error('Cannot resolve rox layout root');
}

export function ensureRoxLayout(opts: RoxLayoutOptions = {}): {
  root: string;
  created: string[];
} {
  const created: string[] = [];
  let root = resolveRoxRoot(opts);

  const mkdirRoot = (target: string): boolean => {
    try {
      if (!existsSync(target)) {
        mkdirSync(target, { recursive: true });
        created.push(target);
      }
      return true;
    } catch {
      return false;
    }
  };

  if (!mkdirRoot(root) && opts.workspaceRoot) {
    root = join(opts.workspaceRoot, 'rox');
    if (!mkdirRoot(root)) {
      throw new Error(`Cannot create rox layout at ${root}`);
    }
  }

  for (const folder of ROX_LAYOUT_FOLDERS) {
    const dir = join(root, folder);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      created.push(dir);
    }
  }

  return { root, created };
}

export function roxFolderPath(folder: RoxLayoutFolder, opts: RoxLayoutOptions = {}): string {
  return join(resolveRoxRoot(opts), folder);
}
