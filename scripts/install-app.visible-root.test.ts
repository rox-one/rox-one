/**
 * W1-13 (#1510): install-app.sh keeps the legacy config dir unless
 * `storage.visible-root.v1` is ON, never creates ~/rox next to an
 * unmigrated legacy tree, and only runs `migrate-config --auto` with the
 * flag ON. Runs the extracted resolution block under bash with a temp HOME.
 */
import { describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const script = readFileSync(join(import.meta.dir, 'install-app.sh'), 'utf8')
const start = script.indexOf('legacy_home=')
const end = script.indexOf('download_dir="$config_dir/downloads"')
const block = script.slice(start, end)

function resolveDir(home: string, env: Record<string, string> = {}): string {
  const result = spawnSync('bash', ['-c', `set -euo pipefail\n${block}\nprintf '%s|%s' "$config_dir" "$visible_root"`], {
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, ...env },
    encoding: 'utf8',
  })
  expect(result.status).toBe(0)
  return result.stdout
}

function withHome(run: (home: string) => void): void {
  const home = mkdtempSync(join(tmpdir(), 'rox-install-app-'))
  try {
    run(home)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

describe('install-app.sh config dir (W1-13)', () => {
  it('extracts the resolution block', () => {
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
  })

  it('flag OFF: legacy ~/.rox exactly as before, ~/rox never created', () =>
    withHome((home) => {
      mkdirSync(join(home, '.rox'))
      expect(resolveDir(home)).toBe(`${join(home, '.rox')}|false`)
      expect(existsSync(join(home, 'rox'))).toBe(false)
      // Clean install with the flag OFF also keeps the legacy default.
      rmSync(join(home, '.rox'), { recursive: true })
      expect(resolveDir(home)).toBe(`${join(home, '.rox')}|false`)
    }))

  it('ROX_CONFIG_DIR wins and disables the flag', () =>
    withHome((home) => {
      expect(resolveDir(home, { ROX_CONFIG_DIR: '/tmp/profile', ROX_STORAGE_VISIBLE_ROOT: '1' })).toBe('/tmp/profile|false')
    }))

  it('flag ON via env: ~/rox on clean installs, legacy dir while unmigrated', () =>
    withHome((home) => {
      expect(resolveDir(home, { ROX_STORAGE_VISIBLE_ROOT: '1' })).toBe(`${join(home, 'rox')}|true`)
      mkdirSync(join(home, '.rox'))
      expect(resolveDir(home, { ROX_STORAGE_VISIBLE_ROOT: 'on' })).toBe(`${join(home, '.rox')}|true`)
      // An empty ~/rox next to the legacy tree is not the home yet.
      mkdirSync(join(home, 'rox'))
      expect(resolveDir(home, { ROX_STORAGE_VISIBLE_ROOT: 'TRUE' })).toBe(`${join(home, '.rox')}|true`)
      writeFileSync(join(home, 'rox', 'config.json'), '{}')
      expect(resolveDir(home, { ROX_STORAGE_VISIBLE_ROOT: 'TRUE' })).toBe(`${join(home, 'rox')}|true`)
    }))

  it('flag ON: a foreign ~/rox (no Rox markers) is never chosen, even without a legacy home', () =>
    withHome((home) => {
      mkdirSync(join(home, 'rox'))
      writeFileSync(join(home, 'rox', 'README.md'), '# my project')
      expect(resolveDir(home, { ROX_STORAGE_VISIBLE_ROOT: '1' })).toBe(`${join(home, '.rox')}|true`)
      mkdirSync(join(home, '.rox'))
      expect(resolveDir(home, { ROX_STORAGE_VISIBLE_ROOT: '1' })).toBe(`${join(home, '.rox')}|true`)
    }))

  it('a foreign ~/rox does not hide the persisted legacy flag', () =>
    withHome((home) => {
      mkdirSync(join(home, '.rox'))
      writeFileSync(join(home, '.rox', 'workbench-flags.json'), JSON.stringify({ enabled: ['storage.visible-root.v1'] }))
      mkdirSync(join(home, 'rox'))
      writeFileSync(join(home, 'rox', 'README.md'), '# my project')
      expect(resolveDir(home)).toBe(`${join(home, '.rox')}|true`)
    }))

  it('flag ON via the persisted workbench-flags.json; env 0 overrides it', () =>
    withHome((home) => {
      mkdirSync(join(home, '.rox'))
      writeFileSync(join(home, '.rox', 'workbench-flags.json'), JSON.stringify({ enabled: ['storage.visible-root.v1'] }))
      expect(resolveDir(home)).toBe(`${join(home, '.rox')}|true`)
      expect(resolveDir(home, { ROX_STORAGE_VISIBLE_ROOT: '0' })).toBe(`${join(home, '.rox')}|false`)
      writeFileSync(join(home, '.rox', 'workbench-flags.json'), '{"enabled":[]}')
      expect(resolveDir(home)).toBe(`${join(home, '.rox')}|false`)
    }))

  it('runs migrate-config only behind the flag, with the real CLI bin name', () => {
    const lines = script.split('\n')
    const calls = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => line.includes('migrate-config') && !line.trim().startsWith('#'))
    expect(calls.length).toBe(1)
    expect(calls[0]!.line).toContain('craft-cli migrate-config --auto')
    expect(lines[calls[0]!.index - 1]).toContain('if [ "$visible_root" = true ]')
    expect(script).not.toMatch(/^\s*rox migrate-config/m)
  })
})
