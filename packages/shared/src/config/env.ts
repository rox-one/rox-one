/**
 * Identity expand (ticket 07) + Issue 33 directory cutover
 * + W1-13 (#1510) visible Rox home (`~/rox`, flag `storage.visible-root.v1`).
 * ROX_* names work beside CRAFT_*. A CRAFT_* fallback logs one
 * deprecation warning per process per name.
 *
 * Flag OFF (default): today's exact order — ROX_CONFIG_DIR (or the
 * deprecated CRAFT_CONFIG_DIR), else `~/rox` if it exists, else `~/.rox`.
 * No migration runs.
 *
 * Flag ON: resolution is read-only (`resolveVisibleHomeWithoutMigration`):
 * `~/rox` once it is the home (migrated / visible-only / fresh machine),
 * else the legacy dir — never an empty, foreign or half-merged `~/rox`.
 * The move itself runs only in Electron main right after its single-instance
 * lock (`runVisibleHomeAutoMigration`) or via an explicit
 * `rox migrate-config`; never as an import-time side effect.
 *
 * The flag must be readable before the config dir is resolved, so it comes
 * from (in priority order):
 *  1. the env override `ROX_STORAGE_VISIBLE_ROOT=1|0` (tests/ops only),
 *     with the deprecated `CRAFT_FEATURE_STORAGE_VISIBLE_ROOT` alias;
 *  2. the explicit `options.enabledWorkbenchFlags` set (callers that already
 *     track workbench flags);
 *  3. the persisted workbench flag in `workbench-flags.json`
 *     (`visibleRootFlagFilePath()`: `~/rox`'s file only once `~/rox` is a
 *     Rox home, else the legacy file, so a foreign `~/rox` never flips it), written by
 *     Electron main when the user toggles it in Settings; it takes effect on
 *     the next launch. The file probe and the flag-ON resolution are cached
 *     per process, so the flag-OFF hot path does a single fs read.
 */
import { importLegacyConfig } from './legacy-config-migration.ts';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  ROX_CONFIG_DIR_NAME,
  ROX_VISIBLE_CONFIG_DIR_NAME,
} from '../identity/manifest.ts';
import {
  ROX_STORAGE_VISIBLE_ROOT_FLAG_ID,
  VISIBLE_HOME_USABLE_OUTCOMES,
  clearStorageMigrationState,
  migrateHiddenRoxHome,
  recordStorageMigrationOutcome,
  readPersistedVisibleRootFlag,
  resolveVisibleHomeWithoutMigration,
  visibleRootEnvOverride,
  type VisibleHomeMigrationResult,
} from '../identity/config-migration.ts';

const warnedCraftNames = new Set<string>();

export function _resetEnvDeprecationWarnings(): void {
  warnedCraftNames.clear();
}

function warnCraftDeprecated(craftName: string, roxName: string): void {
  if (warnedCraftNames.has(craftName)) return;
  warnedCraftNames.add(craftName);
  console.warn(
    `[rox] ${craftName} is deprecated; set ${roxName} instead. ${craftName} still works.`,
  );
}

/**
 * Read ROX_<suffix> if set, else CRAFT_<suffix>.
 * Example: getEnv('SERVER_TOKEN') → ROX_SERVER_TOKEN || CRAFT_SERVER_TOKEN.
 */
export function getEnv(
  suffix: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string | undefined {
  const roxName = `ROX_${suffix}`;
  const craftName = `CRAFT_${suffix}`;
  const rox = env[roxName]?.trim();
  if (rox) return rox;
  const craft = env[craftName]?.trim();
  if (craft) {
    warnCraftDeprecated(craftName, roxName);
    return craft;
  }
  return undefined;
}

// Per-process caches (keyed by home dir): the persisted-flag probe and the
// flag-ON resolution. Toggling the flag takes effect on the next launch.
const persistedFlagCache = new Map<string, boolean>();
const visibleResolutionCache = new Map<string, string>();

/** Test hook: forget the per-process flag probe + flag-ON resolution. */
export function resetConfigDirCachesForTests(): void {
  persistedFlagCache.clear();
  visibleResolutionCache.clear();
}

function persistedVisibleRootFlag(homeDir: string): boolean {
  let value = persistedFlagCache.get(homeDir);
  if (value === undefined) {
    value = readPersistedVisibleRootFlag(homeDir);
    persistedFlagCache.set(homeDir, value);
  }
  return value;
}

function visibleRootRequested(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  homeDir: string,
  enabledWorkbenchFlags: ReadonlySet<string> | undefined,
): boolean {
  const override = visibleRootEnvOverride(env);
  if (override !== undefined) return override;
  if (enabledWorkbenchFlags !== undefined) {
    return enabledWorkbenchFlags.has(ROX_STORAGE_VISIBLE_ROOT_FLAG_ID);
  }
  return persistedVisibleRootFlag(homeDir);
}

function resolveVisibleConfigDir(homeDir: string): string {
  const cached = visibleResolutionCache.get(homeDir);
  if (cached) return cached;
  // Read-only: no process migrates as a side effect of resolving (or of
  // importing `CONFIG_DIR`). Only Electron main, after its single-instance
  // lock, runs `runVisibleHomeAutoMigration()`; this process then keeps the
  // dir resolved here for its lifetime (a just-migrated `~/.rox` is the
  // compat link into `~/rox`), and the next launch resolves `~/rox`.
  const dir = resolveVisibleHomeWithoutMigration(homeDir);
  visibleResolutionCache.set(homeDir, dir);
  return dir;
}

export interface VisibleHomeAutoMigration {
  /** Migration result, when it ran (and did not throw). */
  result?: VisibleHomeMigrationResult;
  /** Error message when the migration threw (the legacy tree is kept). */
  error?: string;
}

/**
 * Electron main only, right after `app.requestSingleInstanceLock()`
 * succeeded: run the visible-home migration when `storage.visible-root.v1`
 * is requested (no-op otherwise, and with ROX_CONFIG_DIR). Live writers
 * (including other desktop app locks) defer it; a foreign `~/rox` defers it.
 * Never throws.
 */
export function runVisibleHomeAutoMigration(options?: {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  homeDir?: string;
  migrate?: typeof migrateHiddenRoxHome;
}): VisibleHomeAutoMigration | undefined {
  const env = options?.env ?? process.env;
  const homeDir = options?.homeDir ?? homedir();
  if (!isVisibleRoxHomeActive(env, homeDir)) {
    // Flag OFF: a deferral note from an earlier flag-ON launch no longer
    // applies (only ever removes that file; creates nothing).
    try {
      clearStorageMigrationState(homeDir);
    } catch {
      // best effort
    }
    return undefined;
  }
  try {
    const result = (options?.migrate ?? migrateHiddenRoxHome)({ homeDir, env });
    try {
      // Settings explains a deferral / relaunch; success clears it.
      recordStorageMigrationOutcome(result, homeDir);
    } catch {
      // best effort: never blocks startup
    }
    if (!VISIBLE_HOME_USABLE_OUTCOMES.has(result.outcome)) {
      console.warn(
        `[rox] Visible-home migration ${result.outcome}; keeping the current Rox home.`,
        result.diagnostics.join('; '),
      );
    }
    return { result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[rox] Visible-home migration failed; keeping the current Rox home:', message);
    return { error: message };
  }
}

/**
 * Config dir: ROX_CONFIG_DIR, then the deprecated explicit alias.
 *
 * With `storage.visible-root.v1` OFF (default): then `~/rox` if it exists,
 * else `~/.rox`. Before using the default, missing legacy data is imported
 * once, preserving conflicts.
 *
 * With the flag ON: `~/rox` once it is the Rox home (see
 * `resolveVisibleHomeWithoutMigration`); this never migrates.
 */
export function resolveConfigDir(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  homeDir: string = homedir(),
  options?: { enabledWorkbenchFlags?: ReadonlySet<string> },
): string {
  const override = getEnv('CONFIG_DIR', env);
  if (override) return override;
  const visibleDir = join(homeDir, ROX_VISIBLE_CONFIG_DIR_NAME);
  const hiddenDir = join(homeDir, ROX_CONFIG_DIR_NAME);
  if (visibleRootRequested(env, homeDir, options?.enabledWorkbenchFlags)) {
    const dir = resolveVisibleConfigDir(homeDir);
    importLegacyConfig(homeDir, dir);
    return dir;
  }
  const roxDir = existsSync(visibleDir) ? visibleDir : hiddenDir;
  importLegacyConfig(homeDir, roxDir);
  return roxDir;
}

/**
 * Whether the visible Rox home is requested for this resolution: env
 * override, explicit flag set, or persisted workbench flag. False with an
 * explicit config dir override. Exported for `rox migrate-config`, remote
 * bootstrap and Settings.
 */
export function isVisibleRoxHomeActive(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  homeDir: string = homedir(),
  enabledWorkbenchFlags?: ReadonlySet<string>,
): boolean {
  if (getEnv('CONFIG_DIR', env)) return false;
  return visibleRootRequested(env, homeDir, enabledWorkbenchFlags);
}
