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
 * Flag ON: always `~/rox` (0700), with `migrateHiddenRoxHome()` running
 * before any store opens (and before the legacy `~/.craft-agent` import).
 * `rox migrate-config` works regardless of the flag; it is the manual path.
 *
 * The flag must be readable before the config dir is resolved, so it comes
 * from (in priority order):
 *  1. the explicit `options.enabledWorkbenchFlags` set (callers that already
 *     track workbench flags, e.g. Electron main after loading settings);
 *  2. the env override `ROX_STORAGE_VISIBLE_ROOT=1|0` (tests/ops only),
 *     with the deprecated `CRAFT_FEATURE_STORAGE_VISIBLE_ROOT` alias;
 *  3. the persisted workbench flag, read from `workbench-flags.json` in
 *     whichever candidate dir (`~/rox`, then `~/.rox`) exists.
 */
import { importLegacyConfig } from './legacy-config-migration.ts';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  ROX_CONFIG_DIR_NAME,
  ROX_VISIBLE_CONFIG_DIR_NAME,
} from '../identity/manifest.ts';
import { isStorageVisibleRootEnabled } from '../feature-flags.ts';
import {
  migrateHiddenRoxHome,
  readPersistedVisibleRootFlag,
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

/**
 * Config dir: ROX_CONFIG_DIR, then the deprecated explicit alias.
 *
 * With `storage.visible-root.v1` OFF (default): then `~/rox` if it exists,
 * else `~/.rox`. Before using the default, missing legacy data is imported
 * once, preserving conflicts.
 *
 * With the flag ON: always `~/rox` (created 0700 on first use); the hidden
 * home is migrated first (never deleted, left as a symlink).
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
  if (
    isStorageVisibleRootEnabled(options?.enabledWorkbenchFlags, env) ||
    (options?.enabledWorkbenchFlags === undefined &&
      readPersistedVisibleRootFlag(homeDir))
  ) {
    try {
      migrateHiddenRoxHome({ homeDir, env });
    } catch (error) {
      console.warn(
        '[rox] Visible-home migration deferred:',
        error instanceof Error ? error.message : error,
      );
    }
    importLegacyConfig(homeDir, visibleDir);
    return visibleDir;
  }
  const roxDir = existsSync(visibleDir) ? visibleDir : hiddenDir;
  importLegacyConfig(homeDir, roxDir);
  return roxDir;
}

/**
 * Whether the visible Rox home is active for this resolution: explicit flag
 * set, env override, or persisted workbench flag in a candidate dir.
 * Exported for `rox migrate-config` status output and tests.
 */
export function isVisibleRoxHomeActive(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  homeDir: string = homedir(),
  enabledWorkbenchFlags?: ReadonlySet<string>,
): boolean {
  if (getEnv('CONFIG_DIR', env)) return false;
  if (isStorageVisibleRootEnabled(enabledWorkbenchFlags, env)) return true;
  if (enabledWorkbenchFlags === undefined && readPersistedVisibleRootFlag(homeDir)) {
    return true;
  }
  return false;
}
