/**
 * W1-13 (#1510): `resolveConfigDir()` flag semantics.
 *
 * Flag OFF (default): today's exact order, no migration, no new writes.
 * Flag ON (`storage.visible-root.v1`): always `~/rox` (0700), hidden home
 * migrated first. `rox migrate-config` (manual path) works either way.
 *
 * SAFETY: temp HOME + explicit env only. Never the real home.
 */
import { beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isVisibleRoxHomeActive, resetConfigDirCachesForTests, resolveConfigDir } from '../env.ts'
import { writePersistedVisibleRootFlag } from '../../identity/config-migration.ts'
import { isStorageVisibleRootEnabled } from '../../feature-flags.ts'

beforeEach(() => resetConfigDirCachesForTests())

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

// ---------------------------------------------------------------------------
// fix1 regressions (review 1510-review1)
// ---------------------------------------------------------------------------

const ON = { ROX_STORAGE_VISIBLE_ROOT: '1' }
const livePidLock = (): string => JSON.stringify({ pid: process.ppid, startedAt: Date.now() })

describe('flag ON never strands the user on an empty ~/rox', () => {
  it('deferred (live lock) → keeps ~/.rox and does not create ~/rox', () =>
    withHome((home) => {
      mkdirSync(join(home, '.rox'), { recursive: true })
      writeFileSync(join(home, '.rox', 'config.json'), '{"workspaces":[{"id":"a"}]}')
      writeFileSync(join(home, '.rox', '.server.lock'), livePidLock())
      expect(resolveConfigDir(ON, home)).toBe(join(home, '.rox'))
      expect(existsSync(join(home, 'rox'))).toBe(false)
      expect(lstatSync(join(home, '.rox')).isSymbolicLink()).toBe(false)
    }))

  it('deferred with an empty pre-existing ~/rox → still ~/.rox (the data)', () =>
    withHome((home) => {
      mkdirSync(join(home, 'rox', 'downloads'), { recursive: true })
      mkdirSync(join(home, '.rox', 'workspaces', 'a'), { recursive: true })
      writeFileSync(join(home, '.rox', '.server.lock'), livePidLock())
      expect(resolveConfigDir(ON, home)).toBe(join(home, '.rox'))
    }))

  it('deferred while ~/rox is the active home with user data → ~/rox (as flag OFF)', () =>
    withHome((home) => {
      mkdirSync(join(home, 'rox', 'workspaces', 'b'), { recursive: true })
      mkdirSync(join(home, '.rox'), { recursive: true })
      writeFileSync(join(home, '.rox', '.server.lock'), livePidLock())
      expect(resolveConfigDir(ON, home)).toBe(join(home, 'rox'))
    }))

  it('symlink elsewhere → follows ~/.rox, no ~/rox created', () =>
    withHome((home) => {
      mkdirSync(join(home, 'elsewhere'), { recursive: true })
      symlinkSync(join(home, 'elsewhere'), join(home, '.rox'))
      expect(resolveConfigDir(ON, home)).toBe(join(home, '.rox'))
      expect(existsSync(join(home, 'rox'))).toBe(false)
      expect(readlinkSync(join(home, '.rox'))).toBe(join(home, 'elsewhere'))
    }))

  it('a thrown migration error falls back instead of returning ~/rox', () =>
    withHome((home) => {
      mkdirSync(join(home, '.rox'), { recursive: true })
      writeFileSync(join(home, '.rox', 'marker.txt'), 'hidden')
      // Dangling ~/rox symlink: rename(dir → symlink path) fails (ENOTDIR).
      symlinkSync(join(home, 'missing-target'), join(home, 'rox'))
      expect(resolveConfigDir(ON, home)).toBe(join(home, '.rox'))
      expect(readFileSync(join(home, '.rox', 'marker.txt'), 'utf8')).toBe('hidden')
      // No migration scaffolding left behind in the legacy tree.
      expect(existsSync(join(home, '.rox', '.migration-manifest.json'))).toBe(false)
    }))
})

describe('persisted flag (Settings toggle → workbench-flags.json → next launch)', () => {
  it('a toggle written by main is read by resolveConfigDir on the next launch', () =>
    withHome((home) => {
      mkdirSync(join(home, '.rox'), { recursive: true })
      writeFileSync(join(home, '.rox', 'marker.txt'), 'hidden')
      expect(resolveConfigDir({}, home)).toBe(join(home, '.rox'))
      writePersistedVisibleRootFlag(true, home)
      // Same process: the probe is cached, the change applies on next launch.
      expect(resolveConfigDir({}, home)).toBe(join(home, '.rox'))
      expect(existsSync(join(home, 'rox'))).toBe(false)
      resetConfigDirCachesForTests() // "next launch"
      expect(resolveConfigDir({}, home)).toBe(join(home, 'rox'))
      expect(readFileSync(join(home, 'rox', 'marker.txt'), 'utf8')).toBe('hidden')
    }))

  it('malformed workbench-flags.json reads as OFF', () =>
    withHome((home) => {
      mkdirSync(join(home, '.rox'), { recursive: true })
      writeFileSync(join(home, '.rox', 'workbench-flags.json'), '{"enabled": [')
      expect(resolveConfigDir({}, home)).toBe(join(home, '.rox'))
      expect(existsSync(join(home, 'rox'))).toBe(false)
    }))

  it('env override 0 beats a persisted ON flag', () =>
    withHome((home) => {
      mkdirSync(join(home, '.rox'), { recursive: true })
      writePersistedVisibleRootFlag(true, home)
      expect(resolveConfigDir({ ROX_STORAGE_VISIBLE_ROOT: '0' }, home)).toBe(join(home, '.rox'))
      expect(existsSync(join(home, 'rox'))).toBe(false)
      expect(isVisibleRoxHomeActive({ ROX_STORAGE_VISIBLE_ROOT: '0' }, home)).toBe(false)
    }))

  it('flag-OFF hot path probes the file once per process', () =>
    withHome((home) => {
      mkdirSync(join(home, '.rox'), { recursive: true })
      expect(resolveConfigDir({}, home)).toBe(join(home, '.rox'))
      // Planting the flag without a reset proves later calls use the cache.
      writeFileSync(join(home, '.rox', 'workbench-flags.json'), JSON.stringify({ enabled: ['storage.visible-root.v1'] }))
      for (let i = 0; i < 5; i++) expect(resolveConfigDir({}, home)).toBe(join(home, '.rox'))
      expect(existsSync(join(home, 'rox'))).toBe(false)
    }))
})
