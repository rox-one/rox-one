/**
 * Identity expand (ticket 07) + Issue 33 directory cutover:
 * ROX_* names work beside CRAFT_*. A CRAFT_* fallback logs one
 * deprecation warning per process per name.
 *
 * Default directory: ~/.rox when present or on a clean install.
 * Existing ~/.craft-agent trees stay readable until brand migration
 * copies them (see identity/config-migration.ts).
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  ROX_CONFIG_DIR_NAME,
  ROX_LEGACY_CONFIG_DIR_NAME,
} from '../identity/manifest.ts';

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
 * Config dir: ROX_CONFIG_DIR, then CRAFT_CONFIG_DIR, then ~/.rox when
 * it exists or neither tree exists (clean install). A Craft-era
 * ~/.craft-agent without ~/.rox stays in place until migration runs.
 */
export function resolveConfigDir(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  homeDir: string = homedir(),
): string {
  const override = getEnv('CONFIG_DIR', env);
  if (override) return override;
  const roxDir = join(homeDir, ROX_CONFIG_DIR_NAME);
  const legacyDir = join(homeDir, ROX_LEGACY_CONFIG_DIR_NAME);
  if (existsSync(roxDir)) return roxDir;
  if (existsSync(legacyDir)) {
    warnCraftDeprecated(`~/${ROX_LEGACY_CONFIG_DIR_NAME}`, `~/${ROX_CONFIG_DIR_NAME}`);
    return legacyDir;
  }
  return roxDir;
}
