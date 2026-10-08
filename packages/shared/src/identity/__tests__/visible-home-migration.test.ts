/**
 * W1-13 (#1510): `migrateHiddenRoxHome()` — all six start states, EXDEV,
 * Windows junction, manifest equality, negatives (locked → deferred,
 * symlink-elsewhere → no-op), revert, dry-run.
 *
 * SAFETY: every case runs with a temp HOME (`mkdtemp`) and an injected
 * `homeDir` + explicit `env` (the bun preload sets ROX_CONFIG_DIR, which
 * would otherwise force `skipped-env-override`). Never touches the real home.
 */
import { describe, expect, it } from 'bun:test'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildVisibleHomeManifest,
  migrateHiddenRoxHome,
  readPersistedVisibleRootFlag,
  revertVisibleRoxHome,
  visibleHomeManifestsEqual,
  ROX_HOME_MIGRATION_DIR_NAME,
  type MigrateHiddenRoxHomeOptions,
} from '../config-migration.ts'

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), 'rox-visible-home-'))
}

function withHome(run: (home: string) => void): void {
  const home = tempHome()
  try {
    run(home)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

function baseOptions(home: string, extra?: Partial<MigrateHiddenRoxHomeOptions>): MigrateHiddenRoxHomeOptions {
  return {
    homeDir: home,
    env: {},
    timestamp: 'ts-001',
    skipProcessLock: true,
    ...(extra ?? {}),
  }
}

function writeHiddenFile(home: string, rel: string, content: string): void {
  const full = join(home, '.rox', rel)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content)
}

describe('migrateHiddenRoxHome start states', () => {
  it('neither exists → clean-install creates ~/rox (0700) only', () =>
    withHome((home) => {
      const result = migrateHiddenRoxHome(baseOptions(home))
      expect(result.outcome).toBe('clean-install')
      expect(existsSync(join(home, 'rox'))).toBe(true)
      expect(existsSync(join(home, '.rox'))).toBe(false)
      expect(lstatSync(join(home, 'rox')).mode & 0o777).toBe(0o700)
    }))

  it('only ~/rox → already-visible, untouched', () =>
    withHome((home) => {
      mkdirSync(join(home, 'rox'), { recursive: true })
      writeFileSync(join(home, 'rox', 'keep.txt'), 'keep')
      const result = migrateHiddenRoxHome(baseOptions(home))
      expect(result.outcome).toBe('already-visible')
      expect(readFileSync(join(home, 'rox', 'keep.txt'), 'utf8')).toBe('keep')
      expect(existsSync(join(home, '.rox'))).toBe(false)
    }))

  it('~/.rox symlink → ~/rox → already-symlinked, untouched', () =>
    withHome((home) => {
      mkdirSync(join(home, 'rox'), { recursive: true })
      symlinkSync(join(home, 'rox'), join(home, '.rox'))
      const result = migrateHiddenRoxHome(baseOptions(home))
      expect(result.outcome).toBe('already-symlinked')
      expect(lstatSync(join(home, '.rox')).isSymbolicLink()).toBe(true)
    }))

  it('only ~/.rox → migrated: identical checksums, symlink left, nothing deleted', () =>
    withHome((home) => {
      writeHiddenFile(home, 'config.json', '{"workspaces":[]}')
      writeHiddenFile(home, 'workspaces/ws/config.json', '{"id":"ws"}')
      writeHiddenFile(home, 'models/ggml.bin', 'binary-bytes')
      const before = buildVisibleHomeManifest(join(home, '.rox'))
      expect(before.length).toBeGreaterThan(0)

      const result = migrateHiddenRoxHome(baseOptions(home))
      expect(result.outcome).toBe('migrated')
      expect(result.announceToast).toBe(true)
      // Identical checksums through both paths.
      expect(visibleHomeManifestsEqual(before, buildVisibleHomeManifest(join(home, 'rox')))).toBe(true)
      expect(visibleHomeManifestsEqual(before, result.manifest)).toBe(true)
      expect(readFileSync(join(home, '.rox', 'config.json'), 'utf8')).toBe('{"workspaces":[]}')
      // `~/.rox` is a symlink to `~/rox`, nothing deleted.
      expect(lstatSync(join(home, '.rox')).isSymbolicLink()).toBe(true)
      expect(result.reportPath).toBe(join(home, 'rox', ROX_HOME_MIGRATION_DIR_NAME, 'report-ts-001.json'))
      expect(existsSync(result.reportPath!)).toBe(true)
    }))

  it('both real dirs → merged: newer mtime wins, loser kept under .migration/conflicts', () =>
    withHome((home) => {
      mkdirSync(join(home, 'rox'), { recursive: true })
      writeFileSync(join(home, 'rox', 'only-visible.txt'), 'visible')
      writeFileSync(join(home, 'rox', 'conflict.txt'), 'old-visible')
      writeHiddenFile(home, 'only-hidden.txt', 'hidden')
      writeHiddenFile(home, 'conflict.txt', 'new-hidden')
      // Make the hidden copy newer.
      const oldDate = new Date('2020-01-01')
      const newDate = new Date('2026-01-01')
      utimesSync(join(home, 'rox', 'conflict.txt'), oldDate, oldDate)
      utimesSync(join(home, '.rox', 'conflict.txt'), newDate, newDate)

      const result = migrateHiddenRoxHome(baseOptions(home))
      expect(result.outcome).toBe('merged')
      expect(readFileSync(join(home, 'rox', 'only-visible.txt'), 'utf8')).toBe('visible')
      expect(readFileSync(join(home, 'rox', 'only-hidden.txt'), 'utf8')).toBe('hidden')
      expect(readFileSync(join(home, 'rox', 'conflict.txt'), 'utf8')).toBe('new-hidden')
      expect(result.conflicts).toEqual(['conflict.txt'])
      expect(readFileSync(join(home, 'rox', ROX_HOME_MIGRATION_DIR_NAME, 'conflicts', 'conflict.txt'), 'utf8')).toBe(
        'old-visible',
      )
      expect(lstatSync(join(home, '.rox')).isSymbolicLink()).toBe(true)
      // Original kept under a timestamped name — never deleted.
      expect(existsSync(join(home, '.rox.migrated-ts-001'))).toBe(true)
    }))

  it('negative: ~/.rox symlink elsewhere → no-op with warning', () =>
    withHome((home) => {
      mkdirSync(join(home, 'elsewhere'), { recursive: true })
      symlinkSync(join(home, 'elsewhere'), join(home, '.rox'))
      const result = migrateHiddenRoxHome(baseOptions(home))
      expect(result.outcome).toBe('symlink-elsewhere')
      expect(result.diagnostics).toContain('storage.migration.symlinkElsewhere')
      expect(existsSync(join(home, 'rox'))).toBe(false)
      expect(readlinkSync(join(home, '.rox'))).toBe(join(home, 'elsewhere'))
    }))
})

describe('migrateHiddenRoxHome safety', () => {
  it('negative: locked files → deferred, nothing written', () =>
    withHome((home) => {
      writeHiddenFile(home, 'config.json', '{}')
      writeHiddenFile(home, 'config.json.lock', '1234\n')
      const result = migrateHiddenRoxHome(baseOptions(home))
      expect(result.outcome).toBe('deferred-locked')
      expect(result.diagnostics).toContain('storage.migration.deferredLocked')
      expect(existsSync(join(home, 'rox'))).toBe(false)
      expect(lstatSync(join(home, '.rox')).isSymbolicLink()).toBe(false)
    }))

  it('skips when ROX_CONFIG_DIR is set', () =>
    withHome((home) => {
      writeHiddenFile(home, 'config.json', '{}')
      const result = migrateHiddenRoxHome(baseOptions(home, { env: { ROX_CONFIG_DIR: '/tmp/x' } }))
      expect(result.outcome).toBe('skipped-env-override')
    }))

  it('cross-device (EXDEV) → copy + verify + swap, original kept as .migrated-<ts>', () =>
    withHome((home) => {
      writeHiddenFile(home, 'a.txt', 'aaa')
      writeHiddenFile(home, 'sub/b.txt', 'bbb')
      const before = buildVisibleHomeManifest(join(home, '.rox'))
      const rename: MigrateHiddenRoxHomeOptions['rename'] = (src, dst) => {
        if (src === join(home, '.rox') && dst === join(home, 'rox')) {
          throw Object.assign(new Error('EXDEV'), { code: 'EXDEV' })
        }
        renameSync(src, dst)
      }
      const result = migrateHiddenRoxHome(baseOptions(home, { rename }))
      expect(result.outcome).toBe('migrated')
      expect(visibleHomeManifestsEqual(before, buildVisibleHomeManifest(join(home, 'rox')))).toBe(true)
      expect(existsSync(join(home, '.rox.migrated-ts-001', 'a.txt'))).toBe(true)
      expect(lstatSync(join(home, '.rox')).isSymbolicLink()).toBe(true)
      expect(existsSync(join(home, 'rox.tmp-process'))).toBe(false)
    }))

  it('Windows platform → directory junction via linkDir', () =>
    withHome((home) => {
      writeHiddenFile(home, 'a.txt', 'aaa')
      const calls: Array<{ target: string; path: string; type: string }> = []
      const result = migrateHiddenRoxHome(
        baseOptions(home, {
          platform: 'win32',
          linkDir: (target, path, type) => {
            calls.push({ target, path, type })
            symlinkSync(target, path, 'junction')
          },
        }),
      )
      expect(result.outcome).toBe('migrated')
      expect(calls).toEqual([{ target: join(home, 'rox'), path: join(home, '.rox'), type: 'junction' }])
      expect(readFileSync(join(home, '.rox', 'a.txt'), 'utf8')).toBe('aaa')
    }))

  it('dry-run writes nothing', () =>
    withHome((home) => {
      writeHiddenFile(home, 'a.txt', 'aaa')
      const result = migrateHiddenRoxHome(baseOptions(home, { dryRun: true }))
      expect(result.outcome).toBe('migrated')
      expect(result.dryRun).toBe(true)
      expect(existsSync(join(home, 'rox'))).toBe(false)
      expect(lstatSync(join(home, '.rox')).isSymbolicLink()).toBe(false)
    }))
})

describe('revertVisibleRoxHome', () => {
  it('removes the symlink and renames ~/rox back to ~/.rox', () =>
    withHome((home) => {
      writeHiddenFile(home, 'a.txt', 'aaa')
      expect(migrateHiddenRoxHome(baseOptions(home)).outcome).toBe('migrated')
      const reverted = revertVisibleRoxHome(baseOptions(home))
      expect(reverted.outcome).toBe('reverted')
      expect(lstatSync(join(home, '.rox')).isSymbolicLink()).toBe(false)
      expect(readFileSync(join(home, '.rox', 'a.txt'), 'utf8')).toBe('aaa')
      expect(existsSync(join(home, 'rox'))).toBe(false)
    }))

  it('refuses when .migration/conflicts is non-empty', () =>
    withHome((home) => {
      mkdirSync(join(home, 'rox'), { recursive: true })
      writeFileSync(join(home, 'rox', 'same.txt'), 'same')
      writeHiddenFile(home, 'same.txt', 'same')
      writeHiddenFile(home, 'other.txt', 'other')
      // Force a conflict entry.
      mkdirSync(join(home, 'rox', ROX_HOME_MIGRATION_DIR_NAME, 'conflicts'), { recursive: true })
      writeFileSync(join(home, 'rox', ROX_HOME_MIGRATION_DIR_NAME, 'conflicts', 'x.txt'), 'x')
      rmSync(join(home, '.rox'), { recursive: true, force: true })
      mkdirSync(join(home, '.rox'), { recursive: true })
      writeFileSync(join(home, '.rox', 'same.txt'), 'same')
      const merged = migrateHiddenRoxHome(baseOptions(home))
      expect(merged.outcome).toBe('merged')
      const reverted = revertVisibleRoxHome(baseOptions(home))
      expect(reverted.outcome).toBe('revert-refused')
      expect(reverted.diagnostics).toContain('storage.migration.revertRefusedConflicts')
      expect(lstatSync(join(home, '.rox')).isSymbolicLink()).toBe(true)
    }))

  it('noop when ~/.rox is not a compat symlink', () =>
    withHome((home) => {
      const reverted = revertVisibleRoxHome(baseOptions(home))
      expect(reverted.outcome).toBe('noop')
    }))
})

describe('readPersistedVisibleRootFlag', () => {
  it('reads workbench-flags.json from whichever candidate exists', () =>
    withHome((home) => {
      expect(readPersistedVisibleRootFlag(home)).toBe(false)
      mkdirSync(join(home, '.rox'), { recursive: true })
      writeFileSync(
        join(home, '.rox', 'workbench-flags.json'),
        JSON.stringify({ enabled: ['storage.visible-root.v1'] }),
      )
      expect(readPersistedVisibleRootFlag(home)).toBe(true)
    }))

  it('malformed JSON reads as OFF, never throws', () =>
    withHome((home) => {
      mkdirSync(join(home, 'rox'), { recursive: true })
      writeFileSync(join(home, 'rox', 'workbench-flags.json'), '{broken')
      expect(readPersistedVisibleRootFlag(home)).toBe(false)
    }))
})
