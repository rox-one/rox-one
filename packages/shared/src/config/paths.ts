/**
 * Centralized path configuration for Craft Agent.
 *
 * Supports multi-instance development via ROX_CONFIG_DIR (preferred) or
 * CRAFT_CONFIG_DIR. When running from a numbered folder (e.g., craft-tui-agent-1),
 * detect-instance.sh sets the override to ~/.craft-agent-1 so instances stay isolated.
 *
 * Default (non-numbered folders): ~/.craft-agent/
 * Instance 1 (-1 suffix): ~/.craft-agent-1/
 * Instance 2 (-2 suffix): ~/.craft-agent-2/
 *
 * The default directory is not moved. CRAFT_CONFIG_DIR still works and logs
 * one deprecation warning per process (ticket 07).
 */

export { getEnv, resolveConfigDir } from './env.ts';
import { resolveConfigDir } from './env.ts';

// Import-time snapshot. Test preload must set ROX_CONFIG_DIR / CRAFT_CONFIG_DIR
// before any config module loads (see scripts/test-config-isolation.ts).
export const CONFIG_DIR = resolveConfigDir();
