/**
 * W1-13 (#1510): `resolveConfigDir()` flag semantics.
 *
 * Flag OFF (default): today's exact order, no migration, no new writes.
 * Flag ON (`storage.visible-root.v1`): always `~/rox` (0700), hidden home
 * migrated first. `rox migrate-config` (manual path) works either way.
 *
 * SAFETY: temp HOME + explicit env only. Never the real home.
 */
import { describe, expect, it } from 'bun:test'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isVisibleRoxHomeActive, resolveConfigDir } from '../env.ts'
import { isStorageVisibleRootEnabled } from '../../feature-flags.ts'

function withHome(run: (home: string) => void): void {
  const home = mkdtempSync(join(tmpdir(), 'rox-visible-root-env-'))
  try {
    run(home)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

describe('isStorageVisibleRootEnabled', () => {
  it('defaults OFF with no set and no env', () => {
    expect(isStorageVisibleRootEnabled(undefined, {})).toBe(false)
    expect(isStorageVisibleRootEnabled(new Set(), {})).toBe(false)
  })

  it('reads the workbench flag set when tracked', () => {
    expect(isStorageVisibleRootEnabled(new Set(['storage.visible-root.v1']), {})).toBe(true)
    expect(isStorageVisibleRootEnabled(new Set(['other.flag']), {})).toBe(false)
  })

  it('supports ROX_STORAGE_VISIBLE_ROOT=1 for tests', () => {
    expect(isStorageVisibleRootEnabled(undefined, { ROX_STORAGE_VISIBLE_ROOT: '1' })).toBe(true)
    expect(isStorageVisibleRootEnabled(undefined, { ROX_STORAGE_VISIBLE_ROOT: '0' })).toBe(false)
  })

  it('env override wins over the flag set', () => {
    expect(isStorageVisibleRootEnabled(new Set(['storage.visible-root.v1']), { ROX_STORAGE_VISIBLE_ROOT: '0' })).toBe(
      false,
    )
  })
})

describe('resolveConfigDir flag OFF (default)', () => {
  it('keeps the legacy order and runs no migration', () =>
    withHome((home) => {
      mkdirSync(join(home, '.rox'), { recursive: true })
      writeFileSync(join(home, '.rox', 'marker.txt'), 'hidden')
      expect(resolveConfigDir({}, home)).toBe(join(home, '.rox'))
      // No ~/rox created, no symlink left behind.
      expect(existsSync(join(home, 'rox'))).toBe(false)
      expect(lstatSync(join(home, '.rox')).isSymbolicLink()).toBe(false)
    }))

  it('still prefers ~/rox when it exists (unchanged precedence)', () =>
    withHome((home) => {
      mkdirSync(join(home, 'rox'), { recursive: true })
      mkdirSync(join(home, '.rox'), { recursive: true })
      expect(resolveConfigDir({}, home)).toBe(join(home, 'rox'))
      expect(lstatSync(join(home, '.rox')).isSymbolicLink()).toBe(false)
    }))
})

describe('resolveConfigDir flag ON', () => {
  it('always resolves ~/rox and migrates the hidden home', () =>
    withHome((home) => {
      mkdirSync(join(home, '.rox'), { recursive: true })
      writeFileSync(join(home, '.rox', 'marker.txt'), 'hidden')
      const dir = resolveConfigDir({ ROX_STORAGE_VISIBLE_ROOT: '1' }, home)
      expect(dir).toBe(join(home, 'rox'))
      expect(readFileSync(join(home, 'rox', 'marker.txt'), 'utf8')).toBe('hidden')
      expect(lstatSync(join(home, '.rox')).isSymbolicLink()).toBe(true)
    }))

  it('fresh home creates only ~/rox (0700)', () =>
    withHome((home) => {
      const dir = resolveConfigDir({ ROX_STORAGE_VISIBLE_ROOT: '1' }, home)
      expect(dir).toBe(join(home, 'rox'))
      expect(existsSync(join(home, 'rox'))).toBe(true)
      expect(existsSync(join(home, '.rox'))).toBe(false)
      expect(lstatSync(join(home, 'rox')).mode & 0o777).toBe(0o700)
    }))

  it('reads the enabled workbench flag set', () =>
    withHome((home) => {
      const dir = resolveConfigDir({}, home, { enabledWorkbenchFlags: new Set(['storage.visible-root.v1']) })
      expect(dir).toBe(join(home, 'rox'))
      expect(existsSync(join(home, '.rox'))).toBe(false)
    }))

  it('reads the persisted flag from the hidden candidate dir', () =>
    withHome((home) => {
      mkdirSync(join(home, '.rox'), { recursive: true })
      writeFileSync(
        join(home, '.rox', 'workbench-flags.json'),
        JSON.stringify({ enabled: ['storage.visible-root.v1'] }),
      )
      expect(resolveConfigDir({}, home)).toBe(join(home, 'rox'))
    }))

  it('legacy ~/.craft-agent import lands in ~/rox when ON', () =>
    withHome((home) => {
      mkdirSync(join(home, '.craft-agent'), { recursive: true })
      writeFileSync(join(home, '.craft-agent', 'legacy.txt'), 'legacy')
      const dir = resolveConfigDir({ ROX_STORAGE_VISIBLE_ROOT: '1' }, home)
      expect(dir).toBe(join(home, 'rox'))
      expect(readFileSync(join(home, 'rox', 'legacy.txt'), 'utf8')).toBe('legacy')
      // Source preserved, ~/.rox never created as a real dir.
      expect(existsSync(join(home, '.craft-agent', 'legacy.txt'))).toBe(true)
      expect(existsSync(join(home, '.rox'))).toBe(false)
    }))
})

describe('isVisibleRoxHomeActive', () => {
  it('is false with an explicit config dir override', () =>
    withHome((home) => {
      expect(
        isVisibleRoxHomeActive({ ROX_CONFIG_DIR: '/tmp/x', ROX_STORAGE_VISIBLE_ROOT: '1' }, home),
      ).toBe(false)
    }))
})
