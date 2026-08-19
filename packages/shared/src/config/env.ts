/**
 * Identity expand (ticket 07): ROX_* names work beside CRAFT_*.
 *
 * Existing ~/.craft-agent installs keep working. A CRAFT_* fallback logs
 * one deprecation warning per process per name. The default config
 * directory is not moved.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

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
 * Config dir: ROX_CONFIG_DIR, then CRAFT_CONFIG_DIR, then ~/.craft-agent.
 * Does not relocate the default directory.
 */
export function resolveConfigDir(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  homeDir: string = homedir(),
): string {
  return getEnv('CONFIG_DIR', env) || join(homeDir, '.craft-agent');
}
