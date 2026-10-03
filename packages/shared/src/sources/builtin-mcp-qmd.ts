/** Provision a small, isolated collection for the official QMD CLI. */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { FolderSourceConfig } from './types.ts';
import { expandPath } from '../utils/paths.ts';
import { readJsonFileSync } from '../utils/files.ts';

export const BUILTIN_QMD_PACKAGE = '@tobilu/qmd@2.8.3';
export const BUILTIN_QMD_INDEX = 'rox';
const DEFAULT_ARGS = ['-y', BUILTIN_QMD_PACKAGE, 'mcp', '--index', BUILTIN_QMD_INDEX];
const CONFIG_ENV = '${SOURCE_DIR}/config';
const CACHE_ENV = '${SOURCE_DIR}/cache';

export interface BuiltinQmdCollectionResult {
  created: boolean;
  /** Whether startup can run the pinned lexical update without shell hooks. */
  canUpdate: boolean;
  configPath?: string;
  collectionPath?: string;
}

function sameArgs(args: string[] | undefined): boolean {
  return args?.length === DEFAULT_ARGS.length && args.every((arg, index) => arg === DEFAULT_ARGS[index]);
}

function ownsDefaultPaths(config: FolderSourceConfig): boolean {
  const mcp = config.mcp;
  if (config.id !== 'builtin-mcp-qmd' || config.slug !== 'qmd' || config.type !== 'mcp' || !config.enabled || mcp?.transport !== 'stdio') return false;
  if (!['npx', 'npx.cmd'].includes(mcp.command || '') || !sameArgs(mcp.args)) return false;
  if (mcp.env?.QMD_CONFIG_DIR !== CONFIG_ENV || mcp.env?.XDG_CACHE_HOME !== CACHE_ENV || mcp.env?.INDEX_PATH) return false;
  for (const override of Object.values(mcp.platform || {})) {
    if (override.command && !['npx', 'npx.cmd'].includes(override.command)) return false;
    if (override.args && !sameArgs(override.args)) return false;
    if (override.env?.INDEX_PATH) return false;
    if (override.env?.QMD_CONFIG_DIR !== undefined && override.env.QMD_CONFIG_DIR !== CONFIG_ENV) return false;
    if (override.env?.XDG_CACHE_HOME !== undefined && override.env.XDG_CACHE_HOME !== CACHE_ENV) return false;
  }
  return true;
}

function isDirectory(path: string): boolean {
  try { return statSync(path).isDirectory(); } catch { return false; }
}

function notesDirectory(workspaceRootPath: string): string | undefined {
  try {
    const notes = readJsonFileSync<FolderSourceConfig>(join(workspaceRootPath, 'sources', 'notes', 'config.json'));
    // A disabled Notes source is an explicit choice; do not silently index it.
    if (!notes.enabled || notes.type !== 'local' || !notes.local?.path) return undefined;
    const path = expandPath(notes.local.path, workspaceRootPath, {
      WORKSPACE: workspaceRootPath,
      SOURCE_DIR: join(workspaceRootPath, 'sources', 'notes'),
    });
    return isDirectory(path) ? path : undefined;
  } catch { return undefined; }
}

function canUpdateWithoutHooks(configPath: string): boolean {
  try {
    const document = parseYaml(readFileSync(configPath, 'utf-8')) as unknown;
    if (!document || typeof document !== 'object' || Array.isArray(document)) return false;
    const collections = (document as { collections?: unknown }).collections;
    if (!collections || typeof collections !== 'object' || Array.isArray(collections)) return false;
    const values = Object.values(collections);
    return values.length > 0 && values.every(collection => {
      if (!collection || typeof collection !== 'object' || Array.isArray(collection)) return false;
      const entry = collection as { path?: unknown; pattern?: unknown; update?: unknown };
      // `qmd update` executes the collection's update field through bash -c.
      // Startup must never run those custom shell commands.
      return typeof entry.path === 'string' && !!entry.path.trim()
        && (entry.pattern === undefined || typeof entry.pattern === 'string')
        && !entry.update;
    });
  } catch { return false; }
}

/**
 * Seed only the application-owned QMD runtime paths, keeping all user configs
 * authoritative. Only the enabled Notes vault is indexed automatically. If it
 * is absent, an empty documents folder is ready for explicit Markdown imports.
 * No source credentials, session history, workspace-root scan, update hooks,
 * LLM models, or vector embeddings are created by this helper.
 */
export function ensureBuiltinQmdCollection(
  workspaceRootPath: string,
  config: FolderSourceConfig,
): BuiltinQmdCollectionResult {
  if (!ownsDefaultPaths(config)) return { created: false, canUpdate: false };
  const sourcePath = join(workspaceRootPath, 'sources', 'qmd');
  const configPath = join(sourcePath, 'config', `${BUILTIN_QMD_INDEX}.yml`);
  // The runtime pins INDEX_PATH to this isolated database. QMD skips its
  // default cache-directory mkdir when INDEX_PATH is set, including on first
  // launch or after cache cleanup, so provision the parent ourselves.
  mkdirSync(join(sourcePath, 'cache', 'qmd'), { recursive: true });
  if (existsSync(configPath)) {
    return { created: false, canUpdate: canUpdateWithoutHooks(configPath), configPath };
  }
  // Named QMD indices read .yml. Preserve an existing alternate config rather
  // than writing a new .yml beside a user-authored .yaml file.
  if (existsSync(join(sourcePath, 'config', `${BUILTIN_QMD_INDEX}.yaml`))) {
    return { created: false, canUpdate: false };
  }
  const notesPath = notesDirectory(workspaceRootPath);
  const collectionPath = notesPath || join(sourcePath, 'documents');
  const collectionName = notesPath ? 'notes' : 'documents';
  mkdirSync(join(sourcePath, 'config'), { recursive: true });
  if (!notesPath) mkdirSync(collectionPath, { recursive: true });
  const document = {
    collections: {
      [collectionName]: {
        path: collectionPath,
        pattern: '**/*.md',
        context: { '/': notesPath ? 'Workspace Markdown notes' : 'Explicitly imported workspace Markdown documents' },
      },
    },
  };
  try {
    // Exclusive create also preserves a concurrently written user config.
    writeFileSync(configPath, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf-8', flag: 'wx' });
    return { created: true, canUpdate: true, configPath, collectionPath };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return { created: false, canUpdate: canUpdateWithoutHooks(configPath), configPath };
    }
    throw error;
  }
}
