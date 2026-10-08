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
 * Flag ON: `~/rox` (0700), with `migrateHiddenRoxHome()` running before any
 * store opens (and before the legacy `~/.craft-agent` import). `~/rox` is
 * returned only when the migration outcome says it holds the user's data
 * (clean-install / already-* / migrated / merged). Deferred (live locks),
 * symlink-elsewhere and failed migrations fall back to the flag-OFF choice,
 * never to an empty `~/rox` (see `fallbackConfigDir`).
 * `rox migrate-config` works regardless of the flag; it is the manual path.
 *
 * The flag must be readable before the config dir is resolved, so it comes
 * from (in priority order):
 *  1. the env override `ROX_STORAGE_VISIBLE_ROOT=1|0` (tests/ops only),
 *     with the deprecated `CRAFT_FEATURE_STORAGE_VISIBLE_ROOT` alias;
 *  2. the explicit `options.enabledWorkbenchFlags` set (callers that already
 *     track workbench flags);
 *  3. the persisted workbench flag in `workbench-flags.json`
 *     (`visibleRootFlagFilePath()`: the flag-OFF config dir), written by
 *     Electron main when the user toggles it in Settings; it takes effect on
 *     the next launch. The file probe and the flag-ON resolution are cached
 *     per process, so the flag-OFF hot path does a single fs read.
 */
import { importLegacyConfig } from './legacy-config-migration.ts';
import { existsSync, lstatSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  ROX_CONFIG_DIR_NAME,
  ROX_VISIBLE_CONFIG_DIR_NAME,
} from '../identity/manifest.ts';
import {
  ROX_STORAGE_VISIBLE_ROOT_FLAG_ID,
  VISIBLE_HOME_USABLE_OUTCOMES,
  migrateHiddenRoxHome,
  readPersistedVisibleRootFlag,
  roxHomeHasUserData,
  visibleRootEnvOverride,
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

function pathPresent(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Flag ON but `~/rox` is not (yet) safe to use: keep the flag-OFF choice
 * (`~/rox` if it exists, else `~/.rox`, i.e. exactly main), except that an
 * existing `~/rox` without user data never wins over a legacy home that
 * still holds it — nobody is stranded on an empty `~/rox`.
 */
function fallbackConfigDir(hiddenDir: string, visibleDir: string): string {
  const hidden = pathPresent(hiddenDir);
  const visible = existsSync(visibleDir);
  if (!hidden) return visible ? visibleDir : hiddenDir;
  if (!visible) return hiddenDir;
  return roxHomeHasUserData(visibleDir) ? visibleDir : hiddenDir;
}

function resolveVisibleConfigDir(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  homeDir: string,
  hiddenDir: string,
  visibleDir: string,
): string {
  const cached = visibleResolutionCache.get(homeDir);
  if (cached) return cached;
  let dir: string;
  try {
    const result = migrateHiddenRoxHome({ homeDir, env });
    if (VISIBLE_HOME_USABLE_OUTCOMES.has(result.outcome)) {
      dir = visibleDir;
    } else {
      dir = fallbackConfigDir(hiddenDir, visibleDir);
      console.warn(
        `[rox] Visible-home migration ${result.outcome}; using ${dir} for this run.`,
        result.diagnostics.join('; '),
      );
    }
  } catch (error) {
    dir = fallbackConfigDir(hiddenDir, visibleDir);
    console.warn(
      `[rox] Visible-home migration failed; using ${dir} for this run:`,
      error instanceof Error ? error.message : error,
    );
  }
  visibleResolutionCache.set(homeDir, dir);
  return dir;
}

/**
 * Config dir: ROX_CONFIG_DIR, then the deprecated explicit alias.
 *
 * With `storage.visible-root.v1` OFF (default): then `~/rox` if it exists,
 * else `~/.rox`. Before using the default, missing legacy data is imported
 * once, preserving conflicts.
 *
 * With the flag ON: `~/rox` (created 0700 on first use) once the hidden home
 * has been migrated (never deleted, left as a symlink); otherwise the
 * fallback above.
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
    const dir = resolveVisibleConfigDir(env, homeDir, hiddenDir, visibleDir);
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
