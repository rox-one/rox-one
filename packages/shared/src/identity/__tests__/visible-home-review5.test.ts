/**
 * W1-13 (#1510) review-5 regressions: lock files in shared dirs (planted
 * links, foreign owners, per-user subdir), the stale-lock takeover race, and
 * the rename-probe move-back / stranded-probe recovery.
 *
 * SAFETY: temp HOME (`mkdtemp`) + explicit `homeDir`/`env` only. Lock bases
 * are temp dirs; nothing is written to the real /tmp lock locations.
 */
import { beforeEach, describe, expect, it } from 'bun:test'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
  type Stats,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import {
  desktopAppRuntimeLockPaths,
  holdDesktopAppLock,
  isLockFileLive,
  migrateHiddenRoxHome,
  ROX_MIGRATION_LOCK_FILE_NAME,
  ROX_STORAGE_MIGRATION_STATE_FILE_NAME,
  readStorageMigrationState,
  recordStorageMigrationOutcome,
  storageMigrationStateFilePath,
  type MigrateHiddenRoxHomeOptions,
} from '../config-migration.ts'
import { resetConfigDirCachesForTests, runVisibleHomeAutoMigration } from '../../config/env.ts'

beforeEach(() => resetConfigDirCachesForTests())

function withHome(run: (home: string) => void): void {
  const home = mkdtempSync(join(tmpdir(), 'rox-visible-home-r5-'))
  try {
    run(home)
  } finally {
    spawnSync('chmod', ['-R', 'u+rwx', home])
    rmSync(home, { recursive: true, force: true })
    resetConfigDirCachesForTests()
  }
}

const uid = process.getuid?.() ?? 0
const DEAD_PID = 2 ** 22 + 11
const liveContent = (): string => JSON.stringify({ pid: process.ppid, startedAt: Date.now() })
const write = (path: string, content: string): void => {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
}
const plantHidden = (home: string): void => {
  write(join(home, '.rox', 'config.json'), '{"workspaces":[{"id":"real"}]}')
  write(join(home, '.rox', 'workspaces', 'real', 'notes.md'), 'mine')
}
const opts = (home: string, extra?: Partial<MigrateHiddenRoxHomeOptions>): MigrateHiddenRoxHomeOptions => ({
  homeDir: home,
  env: {},
  timestamp: 'ts-r5',
  legacyProcessLockPaths: [join(home, 'no-legacy-lock')],
  desktopRuntimeLockPath: (dir) => join(home, `runtime-${dir.endsWith('.rox') ? 'hidden' : 'visible'}.lock`),
  ...(extra ?? {}),
})
/** lstat that reports another owner for `foreign` paths. */
const foreignLstat = (foreign: (path: string) => boolean) => (path: string): Stats => {
  const st = lstatSync(path)
  if (!foreign(path)) return st
  return Object.assign(Object.create(Object.getPrototypeOf(st)), st, { uid: uid + 4242 }) as Stats
}

describe('runtime locks never write through links (finding 1)', () => {
  it('a link planted at the old predictable temp name is never followed', () =>
    withHome((home) => {
      const victim = join(home, 'victim', '.zshrc')
      write(victim, 'export PATH=mine')
      const lock = join(home, 'base', 'app.lock')
      mkdirSync(join(home, 'base'))
      symlinkSync(victim, `${lock}.tmp-${process.pid}`)
      const release = holdDesktopAppLock(join(home, '.rox'), { inConfigDir: false, runtimeLockPaths: [lock] })
      expect(readFileSync(victim, 'utf8')).toBe('export PATH=mine')
      expect(JSON.parse(readFileSync(lock, 'utf8')).pid).toBe(process.pid)
      release()
    }))

  it('a link planted at the lock path itself is replaced, its target untouched', () =>
    withHome((home) => {
      const victim = join(home, 'victim', 'config.json')
      write(victim, '{"keep":true}')
      const lock = join(home, 'base', 'app.lock')
      mkdirSync(join(home, 'base'))
      symlinkSync(victim, lock)
      const release = holdDesktopAppLock(join(home, '.rox'), { inConfigDir: false, runtimeLockPaths: [lock] })
      expect(readFileSync(victim, 'utf8')).toBe('{"keep":true}')
      expect(lstatSync(lock).isSymbolicLink()).toBe(false)
      expect(statSync(lock).mode & 0o777).toBe(0o600)
      release()
      expect(existsSync(lock)).toBe(false)
      expect(readdirSync(join(home, 'base'))).toEqual([])
    }))

  it('shared tmp: a per-user rox-<uid>/ subdir that is a link, group/other-writable or foreign-owned is skipped', () =>
    withHome((home) => {
      const dir = join(home, '.rox')
      const shared = join(home, 'shared')
      mkdirSync(shared)
      chmodSync(shared, 0o1777)
      const sub = join(shared, `rox-${uid}`)
      const base = { env: {}, tmp: shared, sharedTmp: null, create: true } as const

      // Planted link (dangling or not): skipped, nothing created through it.
      mkdirSync(join(home, 'attacker'))
      symlinkSync(join(home, 'attacker'), sub)
      expect(desktopAppRuntimeLockPaths(dir, base)).toEqual([])
      holdDesktopAppLock(dir, { inConfigDir: false, env: {}, runtimeLockPaths: desktopAppRuntimeLockPaths(dir, base) })()
      expect(readdirSync(join(home, 'attacker'))).toEqual([])
      rmSync(sub)

      // Pre-existing but world-writable: skipped.
      mkdirSync(sub, { mode: 0o700 })
      chmodSync(sub, 0o777)
      expect(desktopAppRuntimeLockPaths(dir, base)).toEqual([])
      chmodSync(sub, 0o700)

      // Foreign owner (injected stat): skipped.
      expect(desktopAppRuntimeLockPaths(dir, { ...base, lstat: foreignLstat((p) => p === sub) })).toEqual([])

      // Own, 0700: used.
      const used = desktopAppRuntimeLockPaths(dir, base)
      expect(used.length).toBe(1)
      expect(join(used[0] ?? '', '..')).toBe(sub)
    }))
})

describe('lock readers ignore links and foreign owners (finding 1)', () => {
  const liveness = { now: Date.now(), isPidAlive: () => true, pidlessTtlMs: 60_000 }

  it('isLockFileLive: a link to a live lock and a foreign-owned lock are not live', () =>
    withHome((home) => {
      const real = join(home, 'real.lock')
      write(real, liveContent())
      expect(isLockFileLive(real, liveness)).toBe(true)
      symlinkSync(real, join(home, 'link.lock'))
      expect(isLockFileLive(join(home, 'link.lock'), liveness)).toBe(false)
      expect(isLockFileLive(real, { ...liveness, getuid: () => uid + 1 })).toBe(false)
      expect(isLockFileLive(real, { ...liveness, lstat: foreignLstat(() => true) })).toBe(false)
    }))

  it('a planted runtime lock (link or foreign) never defers the migration', () =>
    withHome((home) => {
      plantHidden(home)
      write(join(home, 'elsewhere.lock'), liveContent())
      symlinkSync(join(home, 'elsewhere.lock'), join(home, 'runtime-hidden.lock'))
      expect(migrateHiddenRoxHome(opts(home, { dryRun: true })).outcome).toBe('migrated')
      rmSync(join(home, 'runtime-hidden.lock'))
      write(join(home, 'runtime-hidden.lock'), liveContent())
      expect(migrateHiddenRoxHome(opts(home, { dryRun: true })).outcome).toBe('deferred-locked')
      const foreign = foreignLstat((p) => p.endsWith('runtime-hidden.lock'))
      expect(migrateHiddenRoxHome(opts(home, { lockLstat: foreign })).outcome).toBe('migrated')
    }))

  it('a foreign or linked legacy /tmp/rox-migrate-<uid>.lock is ignored', () =>
    withHome((home) => {
      plantHidden(home)
      const legacy = join(home, 'old-tmp', `rox-migrate-${uid}.lock`)
      write(join(home, 'live.lock'), liveContent())
      mkdirSync(join(home, 'old-tmp'))
      symlinkSync(join(home, 'live.lock'), legacy)
      const linked = migrateHiddenRoxHome(opts(home, { legacyProcessLockPaths: [legacy], dryRun: false, skipProcessLock: false }))
      expect(linked.outcome).toBe('migrated')
    }))

  it('a foreign-owned legacy lock is ignored, an own one defers', () =>
    withHome((home) => {
      plantHidden(home)
      const legacy = join(home, 'old-tmp', `rox-migrate-${uid}.lock`)
      write(legacy, liveContent())
      expect(migrateHiddenRoxHome(opts(home, { legacyProcessLockPaths: [legacy] })).outcome).toBe('deferred-locked')
      const foreign = foreignLstat((p) => p === legacy)
      expect(migrateHiddenRoxHome(opts(home, { legacyProcessLockPaths: [legacy], lockLstat: foreign })).outcome).toBe('migrated')
    }))
})

describe('stale-lock takeover never runs two migrators (finding 5)', () => {
  const plantStale = (home: string): string => {
    const lock = join(home, ROX_MIGRATION_LOCK_FILE_NAME)
    write(lock, JSON.stringify({ pid: DEAD_PID, startedAt: Date.now() }))
    return lock
  }
  /** Another migrator: unlink the stale lock and create its own (new inode, own token). */
  const otherTakesOver = (lock: string, content: string) => () => {
    rmSync(lock, { force: true })
    writeFileSync(lock, content)
  }

  it('a lock another migrator created after our judgement is put back, and we defer', () =>
    withHome((home) => {
      plantHidden(home)
      const lock = plantStale(home)
      const theirs = liveContent()
      let fired = false
      const result = migrateHiddenRoxHome(opts(home, {
        lockTakeoverHook: (phase) => {
          if (phase === 'stale-judged' && !fired) {
            fired = true
            otherTakesOver(lock, theirs)()
          }
        },
      }))
      expect(result.outcome).toBe('deferred-locked')
      expect(result.diagnostics).toContain(`locked:${lock}`)
      expect(readFileSync(lock, 'utf8')).toBe(theirs)
      expect(existsSync(join(home, 'rox'))).toBe(false)
      expect(readdirSync(home).filter((n) => n.includes('.stale-'))).toEqual([])
    }))

  it('our fresh lock replaced by another migrator: we back off and leave theirs', () =>
    withHome((home) => {
      plantHidden(home)
      const lock = plantStale(home)
      const theirs = liveContent()
      const result = migrateHiddenRoxHome(opts(home, {
        lockTakeoverHook: (phase) => {
          if (phase === 'created') {
            const temp = `${lock}.theirs`
            writeFileSync(temp, theirs)
            renameSync(temp, lock)
          }
        },
      }))
      expect(result.outcome).toBe('deferred-locked')
      expect(readFileSync(lock, 'utf8')).toBe(theirs)
      expect(existsSync(join(home, 'rox'))).toBe(false)
    }))

  it('an uncontended stale lock is taken over and released', () =>
    withHome((home) => {
      plantHidden(home)
      const lock = plantStale(home)
      expect(migrateHiddenRoxHome(opts(home)).outcome).toBe('migrated')
      expect(existsSync(lock)).toBe(false)
      expect(readdirSync(home).filter((n) => n.includes('.stale-'))).toEqual([])
      expect(readlinkSync(join(home, '.rox'))).toBe(join(home, 'rox'))
    }))
})
describe('last migration outcome for Settings (finding 4)', () => {
  const flagOn = (home: string): void =>
    write(join(home, '.rox', 'workbench-flags.json'), JSON.stringify({ enabled: ['storage.visible-root.v1'] }))
  const stateFile = (dir: string): string => join(dir, ROX_STORAGE_MIGRATION_STATE_FILE_NAME)

  it('a deferral is written atomically next to workbench-flags.json; success clears it', () =>
    withHome((home) => {
      plantHidden(home)
      flagOn(home)
      const result = { outcome: 'deferred-unmovable' as const, diagnostics: ['storage.migration.legacyNotRenamable', 'rename:EXDEV'], dryRun: false }
      recordStorageMigrationOutcome(result, home, Date.parse('2026-10-08T07:00:00Z'))
      expect(storageMigrationStateFilePath(home)).toBe(stateFile(join(home, '.rox')))
      expect(readStorageMigrationState(home)).toEqual({
        kind: 'deferred-unmovable',
        diagnostic: 'storage.migration.legacyNotRenamable',
        diagnostics: ['storage.migration.legacyNotRenamable', 'rename:EXDEV'],
        at: '2026-10-08T07:00:00.000Z',
      })
      expect(statSync(stateFile(join(home, '.rox'))).mode & 0o777).toBe(0o600)
      expect(readdirSync(join(home, '.rox')).filter((n) => n.includes('.tmp-'))).toEqual([])

      recordStorageMigrationOutcome({ outcome: 'deferred-locked', diagnostics: ['storage.migration.deferredLocked'], dryRun: false }, home)
      expect(readStorageMigrationState(home)?.kind).toBe('deferred-locked')
      recordStorageMigrationOutcome({ outcome: 'noop', diagnostics: [], dryRun: false }, home)
      expect(readStorageMigrationState(home)?.kind).toBe('deferred-locked')
      recordStorageMigrationOutcome({ outcome: 'deferred-locked', diagnostics: [], dryRun: true }, home)
      recordStorageMigrationOutcome({ outcome: 'already-visible', diagnostics: [], dryRun: false }, home)
      expect(readStorageMigrationState(home)).toBeUndefined()
    }))

  it('relaunchRequired is recorded in ~/rox; nothing is written when the home dir is missing', () =>
    withHome((home) => {
      recordStorageMigrationOutcome({ outcome: 'deferred-locked', diagnostics: [], dryRun: false }, home)
      expect(readdirSync(home)).toEqual([])
      write(join(home, 'rox', 'config.json'), '{}')
      recordStorageMigrationOutcome(
        { outcome: 'migrated', diagnostics: ['storage.migration.compatLinkMissing'], dryRun: false, relaunchRequired: true },
        home,
      )
      expect(readStorageMigrationState(home)?.kind).toBe('relaunch-required')
      expect(existsSync(stateFile(join(home, 'rox')))).toBe(true)
    }))

  it('the boot migration records an unmovable legacy home, then clears it once the flag is OFF', () =>
    withHome((home) => {
      plantHidden(home)
      flagOn(home)
      const pinned = (source: string, destination: string): void => {
        if (source === join(home, '.rox')) throw Object.assign(new Error('EXDEV'), { code: 'EXDEV' })
        renameSync(source, destination)
      }
      const boot = runVisibleHomeAutoMigration({
        env: {},
        homeDir: home,
        migrate: (o) => migrateHiddenRoxHome({ ...o, ...opts(home), rename: pinned }),
      })
      expect(boot?.result?.outcome).toBe('deferred-unmovable')
      expect(readStorageMigrationState(home)?.kind).toBe('deferred-unmovable')

      resetConfigDirCachesForTests()
      writeFileSync(join(home, '.rox', 'workbench-flags.json'), JSON.stringify({ enabled: [] }))
      expect(runVisibleHomeAutoMigration({ env: {}, homeDir: home })).toBeUndefined()
      expect(readStorageMigrationState(home)).toBeUndefined()
      expect(existsSync(join(home, 'rox'))).toBe(false)
    }))
})
