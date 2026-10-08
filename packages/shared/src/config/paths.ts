/**
 * Centralized path configuration for ROX.
 *
 * Supports multi-instance development via ROX_CONFIG_DIR (preferred) or
 * CRAFT_CONFIG_DIR as a deprecated compatibility alias.
 *
 * Default: `~/rox` (visible home) when `storage.visible-root.v1` is on;
 * otherwise `~/rox` if it exists, else the legacy `~/.rox`.
 * Legacy configuration is imported once without removing its source.
 * Explicit overrides isolate development instances and skip global import.
 *
 * CRAFT_CONFIG_DIR still works and logs
 * one deprecation warning per process (ticket 07).
 */

export { getEnv, resolveConfigDir } from './env.ts';
export { getConfigDir, setOwnedRootAdapter } from './owned-root-policy.ts';
import { resolveConfigDir } from './env.ts';

// Import-time snapshot. Test preload must set ROX_CONFIG_DIR / CRAFT_CONFIG_DIR
// before any config module loads (see scripts/test-config-isolation.ts).
export const CONFIG_DIR = resolveConfigDir();
