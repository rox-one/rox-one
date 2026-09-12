/**
 * Test-only preload: point the config root at a throwaway directory.
 *
 * `CONFIG_DIR` (config/paths.ts) is resolved once, when that module is first
 * loaded, and the very first thing a `bun test` process loads is the preload
 * list. Without this file neither config-dir variable is set at that moment, so
 * `CONFIG_DIR` freezes to the real `~/.craft-agent` and tests can write into
 * the developer's actual installation.
 *
 * Tests can still override `ROX_CONFIG_DIR` (and the legacy `CRAFT_CONFIG_DIR`)
 * in spawned children — they must set **both**, because `resolveConfigDir()`
 * prefers ROX_*. Overriding only CRAFT_CONFIG_DIR leaves the preload directory
 * in place. See `packages/shared/src/config/isolated-config-env.ts`.
 *
 * Wired through `[test].preload` in `bunfig.toml`. An externally supplied
 * config directory always wins.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if (!process.env.ROX_CONFIG_DIR && !process.env.CRAFT_CONFIG_DIR) {
  const dir = mkdtempSync(join(tmpdir(), 'rox-agent-test-'));
  process.env.ROX_CONFIG_DIR = dir;
  process.env.CRAFT_CONFIG_DIR = dir;
} else {
  const dir = process.env.ROX_CONFIG_DIR || process.env.CRAFT_CONFIG_DIR;
  if (dir) {
    process.env.ROX_CONFIG_DIR ??= dir;
    process.env.CRAFT_CONFIG_DIR ??= dir;
  }
}