/**
 * Spawn env for config-isolation tests.
 *
 * `bun test` preload (`scripts/test-config-isolation.ts`) sets ROX_CONFIG_DIR.
 * `resolveConfigDir()` prefers ROX_* over CRAFT_*, so spreading process.env and
 * overriding only CRAFT_CONFIG_DIR still reads the shared preload directory.
 */
export function isolatedConfigEnv(
  configDir: string,
  extra: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ROX_CONFIG_DIR: configDir,
    CRAFT_CONFIG_DIR: configDir,
    ...extra,
  }
}
