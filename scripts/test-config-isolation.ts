/**
 * Test-only preload: point the config root at a throwaway directory.
 *
 * `CONFIG_DIR` (config/paths.ts) is resolved once, when that module is first
 * loaded, and the very first thing a `bun test` process loads is the preload
 * list. Without this file `CRAFT_CONFIG_DIR` is still unset at that moment, so
 * `CONFIG_DIR` freezes to the real `~/.craft-agent` and every test that writes
 * config lands in the developer's actual Craft Agents installation — creating
 * workspaces, rotating config backups and clobbering whatever was there.
 *
 * Setting the variable here, before anything reads it, keeps the whole run
 * inside one disposable directory. Tests that need their own config root still
 * override `CRAFT_CONFIG_DIR` themselves and re-import the storage module.
 *
 * Wired through `[test].preload` in `bunfig.toml`. An externally supplied
 * `CRAFT_CONFIG_DIR` wins, so a caller can still aim a run at a specific
 * directory.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if (!process.env.CRAFT_CONFIG_DIR) {
  process.env.CRAFT_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'craft-agent-test-'));
}
