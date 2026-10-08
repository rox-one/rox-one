/**
 * W1-02 (#1499) note-mention indexer through the real Notes handlers
 * (fix5 B). Each scenario runs in a child process with its own config dir so
 * the workspace it registers never leaks into other suites.
 */
import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const repoRoot = join(import.meta.dir, '../../../../../..')
const probe = join(import.meta.dir, 'fixtures', 'note-links-indexer-probe.ts')

test.each(['flag-on', 'flag-off', 'native'])('notes save/edit/delete reconcile note links (%s)', scenario => {
  const root = mkdtempSync(join(tmpdir(), 'rox-note-links-'))
  const config = join(root, 'config')
  mkdirSync(config)
  try {
    const env: Record<string, string | undefined> = { ...process.env, ROX_CONFIG_DIR: config, CRAFT_CONFIG_DIR: config,
      ROX_NOTE_LINKS_ROOT: root, ROX_NOTE_LINKS_SCENARIO: scenario }
    delete env.CRAFT_FEATURE_ENTITIES_LINKS
    const result = Bun.spawnSync([process.execPath, '--preload', join(repoRoot, 'scripts/test-config-isolation.ts'), probe], {
      cwd: repoRoot, env, stdout: 'pipe', stderr: 'pipe', timeout: 60_000,
    })
    if (result.exitCode !== 0) throw new Error(`${result.stdout.toString()}\n${result.stderr.toString()}`)
    expect(result.stdout.toString()).toContain(`verified-${scenario}`)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 90_000)
