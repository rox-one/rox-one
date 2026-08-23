/**
 * Test-only preload: point the config root at a throwaway directory.
 *
 * `CONFIG_DIR` (config/paths.ts) is resolved once, when that module is first
 * loaded, and the very first thing a `bun test` process loads is the preload
 * list. Without this file neither config-dir variable is set at that moment, so
 * `CONFIG_DIR` freezes to the real `~/.craft-agent` and tests can write into
 * the developer's actual installation.
 *
 * Setting the preferred variable here before any config import keeps the run in
 * one disposable directory. Tests can still override `ROX_CONFIG_DIR` or the
 * legacy `CRAFT_CONFIG_DIR` before the preload runs.
 *
 * Wired through `[test].preload` in `bunfig.toml`. An externally supplied
 * config directory always wins.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if (!process.env.ROX_CONFIG_DIR && !process.env.CRAFT_CONFIG_DIR) {
  process.env.ROX_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'rox-agent-test-'));
}