import { describe, expect, it } from 'bun:test'
import { homedir } from 'os'
import { join } from 'path'
import { CONFIG_DIR } from '../paths.ts'

/**
 * Guards the invariant that a test run never touches the developer's real
 * Craft Agents installation.
 *
 * Without it, `bun test` wrote into `~/.craft-agent`: CONFIG_DIR is resolved
 * when config/paths.ts first loads, which under `bun test` is the bunfig
 * preload, before any test can set CRAFT_CONFIG_DIR. It froze to the real home
 * directory and the suite created workspaces, wrote ssh-hosts.json and rotated
 * a backup of the user's config. `scripts/test-config-isolation.ts` fixes that
 * by setting the variable first; this fails if that preload is dropped,
 * renamed, or ordered after something that reads a config path.
 *
 * Only the frozen `CONFIG_DIR` is asserted on. `process.env.CRAFT_CONFIG_DIR`
 * is deliberately repointed by suites that need their own root, so comparing
 * against it would make this depend on file ordering.
 */
describe('test config isolation', () => {
  it('resolves the config root outside the real ~/.craft-agent', () => {
    const realConfigDir = join(homedir(), '.craft-agent')

    expect(CONFIG_DIR).not.toBe(realConfigDir)
    expect(CONFIG_DIR.startsWith(`${realConfigDir}/`)).toBe(false)
  })
})
