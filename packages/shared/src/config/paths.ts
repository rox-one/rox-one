/**
 * Centralized path configuration for Craft Agent.
 *
 * Supports multi-instance development via CRAFT_CONFIG_DIR environment variable.
 * When running from a numbered folder (e.g., craft-tui-agent-1), the detect-instance.sh
 * script sets CRAFT_CONFIG_DIR to ~/.craft-agent-1, allowing multiple instances to run
 * simultaneously with separate configurations.
 *
 * Default (non-numbered folders): ~/.craft-agent/
 * Instance 1 (-1 suffix): ~/.craft-agent-1/
 * Instance 2 (-2 suffix): ~/.craft-agent-2/
 */

import { homedir } from 'os';
import { join } from 'path';

/**
 * Resolve the config root from the environment at call time.
 *
 * `CONFIG_DIR` below captures this once, at first import, which is what
 * production wants — the variable is fixed before the app starts. Under `bun
 * test` the first import happens in the preload, long before any test runs, so
 * a module that wants to honour a later `CRAFT_CONFIG_DIR` change has to call
 * this instead of reading the constant.
 */
export function resolveConfigDir(): string {
  return process.env.CRAFT_CONFIG_DIR || join(homedir(), '.craft-agent');
}

// Allow override via environment variable for multi-instance dev
// Falls back to default ~/.craft-agent/ for production and non-numbered dev folders
export const CONFIG_DIR = resolveConfigDir();
