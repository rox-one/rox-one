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
  chmodSync,
  existsSync,
  lstatSync,
  readdirSync,
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
  isLockFileLive,
  migrateHiddenRoxHome,
  visibleRootFlagFilePath,
  writePersistedVisibleRootFlag,
  ROX_HOME_MIGRATION_MANIFEST_NAME,
  ROX_MIGRATION_LOCK_TTL_MS,
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
      writeFileSync(join(home, 'rox', 'config.json'), '{}') // a Rox home (marker)
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

  it('both real dirs, data-less ~/rox → merged: ~/.rox takes its place, the differing ~/rox file kept under conflicts', () =>
    withHome((home) => {
      mkdirSync(join(home, 'rox', 'workspaces'), { recursive: true }) // a Rox home (marker), no user data
      writeFileSync(join(home, 'rox', 'only-visible.txt'), 'visible')
      writeFileSync(join(home, 'rox', 'conflict.txt'), 'new-visible')
      writeHiddenFile(home, 'only-hidden.txt', 'hidden')
      writeHiddenFile(home, 'conflict.txt', 'old-hidden')
      // The visible copy is newer: ~/.rox still wins (it is the live tree).
      utimesSync(join(home, '.rox', 'conflict.txt'), new Date('2020-01-01'), new Date('2020-01-01'))

      const result = migrateHiddenRoxHome(baseOptions(home))
      expect(result.outcome).toBe('merged')
      expect(readFileSync(join(home, 'rox', 'only-visible.txt'), 'utf8')).toBe('visible')
      expect(readFileSync(join(home, 'rox', 'only-hidden.txt'), 'utf8')).toBe('hidden')
      expect(readFileSync(join(home, 'rox', 'conflict.txt'), 'utf8')).toBe('old-hidden')
      expect(result.conflicts).toEqual(['ts-001/conflict.txt'])
      expect(readFileSync(join(home, 'rox', ROX_HOME_MIGRATION_DIR_NAME, 'conflicts', 'ts-001', 'conflict.txt'), 'utf8')).toBe(
        'new-visible',
      )
      expect(lstatSync(join(home, '.rox')).isSymbolicLink()).toBe(true)
      // One rename of the legacy tree into place: no archived copy.
      expect(readdirSync(home).sort()).toEqual(['.rox', 'rox'])
    }))

  it('both real dirs, ~/rox with user data → merged: ~/rox wins, legacy leftovers imported, differing legacy file stashed', () =>
    withHome((home) => {
      mkdirSync(join(home, 'rox', 'workspaces', 'ws'), { recursive: true }) // user data
      writeFileSync(join(home, 'rox', 'only-visible.txt'), 'visible')
      writeFileSync(join(home, 'rox', 'conflict.txt'), 'old-visible')
      writeHiddenFile(home, 'only-hidden.txt', 'hidden')
      writeHiddenFile(home, 'conflict.txt', 'new-hidden!')
      // The legacy copy is newer: ~/rox still wins (no mtime rule).
      utimesSync(join(home, 'rox', 'conflict.txt'), new Date('2020-01-01'), new Date('2020-01-01'))

      const result = migrateHiddenRoxHome(baseOptions(home))
      expect(result.outcome).toBe('merged')
      expect(readFileSync(join(home, 'rox', 'only-visible.txt'), 'utf8')).toBe('visible')
      expect(readFileSync(join(home, 'rox', 'only-hidden.txt'), 'utf8')).toBe('hidden')
      expect(readFileSync(join(home, 'rox', 'conflict.txt'), 'utf8')).toBe('old-visible')
      expect(result.conflicts).toEqual(['ts-001/conflict.txt']) // per-attempt stash dir
      expect(readFileSync(join(home, 'rox', ROX_HOME_MIGRATION_DIR_NAME, 'conflicts', 'ts-001', 'conflict.txt'), 'utf8')).toBe(
        'new-hidden!',
      )
      expect(lstatSync(join(home, '.rox')).isSymbolicLink()).toBe(true)
      // Original kept under a timestamped name — never deleted.
      expect(existsSync(join(home, '.rox.migrated-ts-001'))).toBe(true)
      expect(existsSync(join(home, 'rox', ROX_HOME_MIGRATION_DIR_NAME, 'imported.jsonl'))).toBe(false)
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
      // A live holder (the test runner's parent process) defers.
      writeHiddenFile(home, 'config.json.lock', `${process.ppid}\n`)
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

  it('cross-device (EXDEV) → deferred-unmovable: nothing copied, legacy home untouched', () =>
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
      expect(result.outcome).toBe('deferred-unmovable')
      expect(result.diagnostics).toEqual(['storage.migration.legacyNotRenamable', 'rename:EXDEV'])
      expect(visibleHomeManifestsEqual(before, buildVisibleHomeManifest(join(home, '.rox')))).toBe(true)
      expect(readdirSync(home).sort()).toEqual(['.rox'])
      expect(existsSync(join(home, '.rox', ROX_HOME_MIGRATION_MANIFEST_NAME))).toBe(false)
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

describe('manifest equality property (seeded, no new deps)', () => {
  // Mulberry32 — deterministic across runs.
  function rng(seed: number): () => number {
    let state = seed >>> 0
    return () => {
      state |= 0
      state = (state + 0x6d2b79f5) | 0
      let t = Math.imul(state ^ (state >>> 15), 1 | state)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  it('random trees survive the move with identical manifests', () =>
    withHome((home) => {
      const next = rng(0x1510)
      const names = ['config.json', 'state.db', 'notes', 'ws', 'a', 'b', 'deep']
      for (let tree = 0; tree < 5; tree++) {
        const hidden = join(home, '.rox')
        rmSync(hidden, { recursive: true, force: true })
        rmSync(join(home, 'rox'), { recursive: true, force: true })
        try {
          lstatSync(join(home, '.rox')).isSymbolicLink() && rmSync(join(home, '.rox'))
        } catch {
          // no stale link
        }
        const fileCount = 3 + Math.floor(next() * 8)
        for (let i = 0; i < fileCount; i++) {
          const depth = Math.floor(next() * 3)
          const parts = Array.from({ length: depth }, () => names[Math.floor(next() * names.length)])
          const name = `${names[Math.floor(next() * names.length)]}-${i}.json`
          const rel = [...parts, name].join('/')
          const full = join(hidden, rel)
          mkdirSync(join(full, '..'), { recursive: true })
          const size = Math.floor(next() * 300)
          writeFileSync(full, `${tree}/${rel}/`.repeat(size % 7) + `#${i}`)
        }
        const before = buildVisibleHomeManifest(hidden)
        const result = migrateHiddenRoxHome(baseOptions(home, { timestamp: `prop-${tree}` }))
        expect(result.outcome).toBe('migrated')
        expect(visibleHomeManifestsEqual(before, buildVisibleHomeManifest(join(home, 'rox')))).toBe(true)
        const reverted = revertVisibleRoxHome(baseOptions(home, { timestamp: `prop-${tree}` }))
        expect(reverted.outcome).toBe('reverted')
      }
    }))
})

// ---------------------------------------------------------------------------
// fix1 regressions (review 1510-review1)
// ---------------------------------------------------------------------------

const DEAD_PID = 2 ** 22 + 12345 // above any default pid_max on Linux/macOS

describe('lock liveness (PID + timestamp)', () => {
  it('stale config.json.lock with a dead PID does not defer', () =>
    withHome((home) => {
      writeHiddenFile(home, 'config.json', '{}')
      writeHiddenFile(home, 'config.json.lock', `${DEAD_PID}\n`)
      expect(migrateHiddenRoxHome(baseOptions(home)).outcome).toBe('migrated')
    }))

  it('stale .server.lock (dead PID JSON, own PID, previous boot) does not defer', () =>
    withHome((home) => {
      writeHiddenFile(home, 'config.json', '{}')
      writeHiddenFile(home, '.server.lock', JSON.stringify({ pid: DEAD_PID, startedAt: Date.now() }))
      expect(migrateHiddenRoxHome(baseOptions(home, { dryRun: true })).outcome).toBe('migrated')
      writeHiddenFile(home, '.server.lock', JSON.stringify({ pid: process.pid, startedAt: Date.now() }))
      expect(migrateHiddenRoxHome(baseOptions(home, { dryRun: true })).outcome).toBe('migrated')
      writeHiddenFile(home, '.server.lock', JSON.stringify({ pid: process.ppid, startedAt: 1 }))
      expect(migrateHiddenRoxHome(baseOptions(home, { dryRun: true })).outcome).toBe('migrated')
    }))

  it('live .server.lock defers; a long-running server has no TTL', () =>
    withHome((home) => {
      writeHiddenFile(home, 'config.json', '{}')
      writeHiddenFile(home, '.server.lock', JSON.stringify({ pid: process.ppid, startedAt: Date.now() }))
      const result = migrateHiddenRoxHome(baseOptions(home, { now: () => Date.now() + 3 * 24 * 3600 * 1000 }))
      expect(result.outcome).toBe('deferred-locked')
      expect(result.diagnostics).toContain('locked:.server.lock')
    }))

  it('PID-less lock directories expire by age', () =>
    withHome((home) => {
      const lockDir = join(home, 'x.lock')
      mkdirSync(lockDir)
      expect(isLockFileLive(lockDir, { now: Date.now(), isPidAlive: () => true, pidlessTtlMs: 60_000 })).toBe(true)
      const old = new Date(Date.now() - 3600_000)
      utimesSync(lockDir, old, old)
      expect(isLockFileLive(lockDir, { now: Date.now(), isPidAlive: () => true, pidlessTtlMs: 60_000 })).toBe(false)
    }))

  it('process lock: dead PID or expired TTL is taken over; a live fresh lock defers', () =>
    withHome((home) => {
      const processLockPath = join(home, 'proc.lock')
      writeHiddenFile(home, 'config.json', '{}')
      writeFileSync(processLockPath, JSON.stringify({ pid: process.ppid, startedAt: Date.now() }))
      const deferred = migrateHiddenRoxHome(baseOptions(home, { skipProcessLock: false, processLockPath }))
      expect(deferred.outcome).toBe('deferred-locked')
      expect(existsSync(join(home, 'rox'))).toBe(false)

      const expiredAt = Date.now() - ROX_MIGRATION_LOCK_TTL_MS - 1000
      writeFileSync(processLockPath, JSON.stringify({ pid: process.ppid, startedAt: expiredAt }))
      // The TTL is judged on the last heartbeat (mtime) too.
      utimesSync(processLockPath, new Date(expiredAt), new Date(expiredAt))
      const expired = migrateHiddenRoxHome(baseOptions(home, { skipProcessLock: false, processLockPath, dryRun: false }))
      expect(expired.outcome).toBe('migrated')
      // Released afterwards.
      expect(existsSync(processLockPath)).toBe(false)
    }))

  it('process lock: crash leftover with a dead PID is stale', () =>
    withHome((home) => {
      const processLockPath = join(home, 'proc.lock')
      writeHiddenFile(home, 'config.json', '{}')
      writeFileSync(processLockPath, JSON.stringify({ pid: DEAD_PID, startedAt: Date.now() }))
      expect(migrateHiddenRoxHome(baseOptions(home, { skipProcessLock: false, processLockPath })).outcome).toBe('migrated')
    }))
})

describe('private ~/rox (0700) on every flag-ON path', () => {
  it('merge forces a pre-existing 0755 ~/rox to 0700 before copying secrets', () =>
    withHome((home) => {
      mkdirSync(join(home, 'rox'), { recursive: true, mode: 0o755 })
      chmodSync(join(home, 'rox'), 0o755)
      writeHiddenFile(home, 'credentials.enc', 'secret')
      const result = migrateHiddenRoxHome(baseOptions(home))
      expect(result.outcome).toBe('merged')
      expect(lstatSync(join(home, 'rox')).mode & 0o777).toBe(0o700)
      expect(readFileSync(join(home, 'rox', 'credentials.enc'), 'utf8')).toBe('secret')
    }))

  it('already-visible enforces 0700; dry-run does not', () =>
    withHome((home) => {
      mkdirSync(join(home, 'rox'), { recursive: true })
      chmodSync(join(home, 'rox'), 0o755)
      migrateHiddenRoxHome(baseOptions(home, { dryRun: true }))
      expect(lstatSync(join(home, 'rox')).mode & 0o777).toBe(0o755)
      expect(migrateHiddenRoxHome(baseOptions(home)).outcome).toBe('already-visible')
      expect(lstatSync(join(home, 'rox')).mode & 0o777).toBe(0o700)
    }))
})

describe('merge never lets fresh defaults beat user data', () => {
  it('a newer default config.json in ~/rox loses to the real one in ~/.rox', () =>
    withHome((home) => {
      const real = JSON.stringify({ workspaces: [{ id: 'ws1', name: 'Mine' }] })
      writeHiddenFile(home, 'config.json', real)
      writeHiddenFile(home, 'workspaces/ws1/config.json', '{"id":"ws1"}')
      mkdirSync(join(home, 'rox'), { recursive: true })
      writeFileSync(join(home, 'rox', 'config.json'), JSON.stringify({ workspaces: [] }))
      const oldDate = new Date('2020-01-01')
      utimesSync(join(home, '.rox', 'config.json'), oldDate, oldDate)
      const result = migrateHiddenRoxHome(baseOptions(home))
      expect(result.outcome).toBe('merged')
      expect(readFileSync(join(home, 'rox', 'config.json'), 'utf8')).toBe(real)
      // The default is kept, never lost.
      expect(readFileSync(join(home, 'rox', ROX_HOME_MIGRATION_DIR_NAME, 'conflicts', 'ts-001', 'config.json'), 'utf8')).toBe(
        JSON.stringify({ workspaces: [] }),
      )
    }))

  it('an active ~/rox with user data keeps its files against an older-data-less ~/.rox', () =>
    withHome((home) => {
      writeHiddenFile(home, 'config.json', JSON.stringify({ workspaces: [] }))
      mkdirSync(join(home, 'rox', 'workspaces', 'ws2'), { recursive: true })
      const active = JSON.stringify({ workspaces: [{ id: 'ws2' }] })
      writeFileSync(join(home, 'rox', 'config.json'), active)
      const oldDate = new Date('2020-01-01')
      utimesSync(join(home, 'rox', 'config.json'), oldDate, oldDate)
      expect(migrateHiddenRoxHome(baseOptions(home)).outcome).toBe('merged')
      expect(readFileSync(join(home, 'rox', 'config.json'), 'utf8')).toBe(active)
    }))
})

describe('no full-tree hashing on the atomic path', () => {
  it('rename path: manifest without sha256, no manifest file left, report has a summary', () =>
    withHome((home) => {
      writeHiddenFile(home, 'a.txt', 'aaa')
      writeHiddenFile(home, 'models/big.bin', 'x'.repeat(4096))
      const result = migrateHiddenRoxHome(baseOptions(home))
      expect(result.outcome).toBe('migrated')
      expect(result.manifest.every((entry) => entry.sha256 === undefined)).toBe(true)
      expect(existsSync(join(home, 'rox', ROX_HOME_MIGRATION_MANIFEST_NAME))).toBe(false)
      const report = JSON.parse(readFileSync(result.reportPath!, 'utf8'))
      expect(report.summary).toEqual({ files: 2, dirs: 1, symlinks: 0, bytes: 4099 })
    }))

})

describe('revertVisibleRoxHome safety', () => {
  const migrated = (home: string): void => {
    writeHiddenFile(home, 'a.txt', 'aaa')
    expect(migrateHiddenRoxHome(baseOptions(home)).outcome).toBe('migrated')
  }

  it('refuses while the flag is active via env', () =>
    withHome((home) => {
      migrated(home)
      const result = revertVisibleRoxHome(baseOptions(home, { env: { ROX_STORAGE_VISIBLE_ROOT: '1' } }))
      expect(result.outcome).toBe('revert-refused')
      expect(result.diagnostics).toContain('storage.migration.revertRefusedFlagActive')
      expect(lstatSync(join(home, '.rox')).isSymbolicLink()).toBe(true)
    }))

  it('refuses while the flag is persisted ON', () =>
    withHome((home) => {
      migrated(home)
      writePersistedVisibleRootFlag(true, home)
      expect(revertVisibleRoxHome(baseOptions(home)).outcome).toBe('revert-refused')
      writePersistedVisibleRootFlag(false, home)
      expect(revertVisibleRoxHome(baseOptions(home)).outcome).toBe('reverted')
    }))

  it('refuses while a live writer holds a lock in ~/rox', () =>
    withHome((home) => {
      migrated(home)
      writeFileSync(join(home, 'rox', '.server.lock'), JSON.stringify({ pid: process.ppid, startedAt: Date.now() }))
      const result = revertVisibleRoxHome(baseOptions(home))
      expect(result.outcome).toBe('revert-refused')
      expect(result.diagnostics).toContain('storage.migration.revertRefusedLocked')
    }))

  it('takes the process lock (a live migration defers the revert)', () =>
    withHome((home) => {
      migrated(home)
      const processLockPath = join(home, 'proc.lock')
      writeFileSync(processLockPath, JSON.stringify({ pid: process.ppid, startedAt: Date.now() }))
      const result = revertVisibleRoxHome(baseOptions(home, { skipProcessLock: false, processLockPath }))
      expect(result.outcome).toBe('revert-refused')
      expect(lstatSync(join(home, '.rox')).isSymbolicLink()).toBe(true)
    }))

  it('restores the compat symlink when the rename fails after unlink', () =>
    withHome((home) => {
      migrated(home)
      const rename: MigrateHiddenRoxHomeOptions['rename'] = () => {
        throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' })
      }
      expect(() => revertVisibleRoxHome(baseOptions(home, { rename }))).toThrow('EBUSY')
      expect(lstatSync(join(home, '.rox')).isSymbolicLink()).toBe(true)
      expect(readFileSync(join(home, '.rox', 'a.txt'), 'utf8')).toBe('aaa')
    }))
})

describe('writePersistedVisibleRootFlag (Settings toggle)', () => {
  it('writes atomically to the file resolveConfigDir reads, keeping other ids', () =>
    withHome((home) => {
      mkdirSync(join(home, '.rox'), { recursive: true })
      writeFileSync(join(home, '.rox', 'workbench-flags.json'), JSON.stringify({ enabled: ['other.flag'] }))
      const file = writePersistedVisibleRootFlag(true, home)
      expect(file).toBe(visibleRootFlagFilePath(home))
      expect(file).toBe(join(home, '.rox', 'workbench-flags.json'))
      expect(JSON.parse(readFileSync(file, 'utf8')).enabled).toEqual(['other.flag', 'storage.visible-root.v1'])
      expect(readPersistedVisibleRootFlag(home)).toBe(true)
      expect(readdirSync(join(home, '.rox')).filter((name) => name.includes('.tmp-'))).toEqual([])
      writePersistedVisibleRootFlag(false, home)
      expect(readPersistedVisibleRootFlag(home)).toBe(false)
      expect(JSON.parse(readFileSync(file, 'utf8')).enabled).toEqual(['other.flag'])
      // Never creates ~/rox.
      expect(existsSync(join(home, 'rox'))).toBe(false)
    }))

  it('overwrites a malformed file and reads the flag-OFF config dir only', () =>
    withHome((home) => {
      mkdirSync(join(home, 'rox'), { recursive: true })
      mkdirSync(join(home, '.rox'), { recursive: true })
      writeFileSync(join(home, 'rox', 'workbench-flags.json'), '{broken')
      // A stale ON flag in the non-active legacy dir is ignored.
      writeFileSync(join(home, '.rox', 'workbench-flags.json'), JSON.stringify({ enabled: ['storage.visible-root.v1'] }))
      expect(readPersistedVisibleRootFlag(home)).toBe(false)
      writePersistedVisibleRootFlag(true, home)
      expect(readPersistedVisibleRootFlag(home)).toBe(true)
    }))
})
