/**
 * W1-13 (#1510) review-4 finding 6: lock locations. The migration process
 * lock sits next to the homes it protects; the runtime desktop lock is
 * written to and probed in several runtime dirs (never under $HOME), and the
 * old tmpdir locations stay honoured.
 *
 * SAFETY: temp HOME (`mkdtemp`) + explicit `homeDir`/`env` only.
 */
import { beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  desktopAppRuntimeLockPath,
  desktopAppRuntimeLockPaths,
  holdDesktopAppLock,
  migrateHiddenRoxHome,
  ROX_MIGRATION_LOCK_FILE_NAME,
  type MigrateHiddenRoxHomeOptions,
} from '../config-migration.ts'
import { resetConfigDirCachesForTests } from '../../config/env.ts'

beforeEach(() => resetConfigDirCachesForTests())

function withHome(run: (home: string) => void): void {
  const home = mkdtempSync(join(tmpdir(), 'rox-visible-home-locks-'))
  try {
    run(home)
  } finally {
    rmSync(home, { recursive: true, force: true })
    resetConfigDirCachesForTests()
  }
}

const plantHidden = (home: string): void => {
  mkdirSync(join(home, '.rox', 'workspaces', 'real'), { recursive: true })
  writeFileSync(join(home, '.rox', 'config.json'), '{"workspaces":[{"id":"real"}]}')
}
const liveLock = (path: string): void => {
  mkdirSync(join(path, '..'), { recursive: true })
  // The parent process: alive, not ours.
  writeFileSync(path, JSON.stringify({ pid: process.ppid, startedAt: Date.now() }))
}
const opts = (home: string, extra?: Partial<MigrateHiddenRoxHomeOptions>): MigrateHiddenRoxHomeOptions => ({
  homeDir: home,
  env: {},
  timestamp: 'ts-locks',
  legacyProcessLockPaths: [join(home, 'no-legacy-lock')],
  ...(extra ?? {}),
})

describe('runtime desktop lock locations', () => {
  it('tmpdir (compat) first, then $XDG_RUNTIME_DIR and /tmp; deduplicated; never under $HOME', () => {
    const dir = '/home/u/.rox'
    const paths = desktopAppRuntimeLockPaths(dir, { XDG_RUNTIME_DIR: '/run/user/1000' }, '/var/folders/x/T', 'darwin')
    expect(paths[0]).toBe(desktopAppRuntimeLockPath(dir, '/var/folders/x/T'))
    expect(paths.map((p) => join(p, '..'))).toEqual(['/var/folders/x/T', '/run/user/1000', '/tmp'])
    expect(desktopAppRuntimeLockPaths(dir, {}, '/tmp', 'linux')).toEqual([desktopAppRuntimeLockPath(dir, '/tmp')])
    expect(desktopAppRuntimeLockPaths(dir, { XDG_RUNTIME_DIR: 'relative' }, 'C:\\T', 'win32')).toEqual([
      desktopAppRuntimeLockPath(dir, 'C:\\T'),
    ])
    expect(desktopAppRuntimeLockPaths(dir, {})[0]).toBe(desktopAppRuntimeLockPath(dir))
  })

  it('the app holds every location and releases them all; nothing in the config dir when inConfigDir is false', () =>
    withHome((home) => {
      const configDir = join(home, '.rox')
      mkdirSync(configDir)
      const runtimeLockPaths = [join(home, 'tmp-a', 'a.lock'), join(home, 'run-b', 'b.lock')]
      for (const p of runtimeLockPaths) mkdirSync(join(p, '..'))
      const release = holdDesktopAppLock(configDir, { inConfigDir: false, runtimeLockPaths })
      expect(runtimeLockPaths.every((p) => existsSync(p))).toBe(true)
      expect(readdirSync(configDir)).toEqual([])
      release()
      expect(runtimeLockPaths.some((p) => existsSync(p))).toBe(false)
    }))

  it('a migration under a different TMPDIR still sees the app through $XDG_RUNTIME_DIR', () =>
    withHome((home) => {
      plantHidden(home)
      const env = { XDG_RUNTIME_DIR: join(home, 'xdg') }
      // Only the XDG location holds the lock (the app ran with another TMPDIR).
      const xdgLock = desktopAppRuntimeLockPaths(join(home, '.rox'), env)[1] ?? ''
      expect(xdgLock.startsWith(join(home, 'xdg'))).toBe(true)
      liveLock(xdgLock)
      const result = migrateHiddenRoxHome(opts(home, { env, skipProcessLock: true }))
      expect(result.outcome).toBe('deferred-locked')
      expect(result.diagnostics).toContain('locked:desktop-app')
      expect(existsSync(join(home, 'rox'))).toBe(false)
    }))
})

describe('migration process lock next to the homes', () => {
  it('a live $HOME/.rox-migrate.lock defers; after a run the lock is gone', () =>
    withHome((home) => {
      plantHidden(home)
      const lock = join(home, ROX_MIGRATION_LOCK_FILE_NAME)
      liveLock(lock)
      const deferred = migrateHiddenRoxHome(opts(home))
      expect(deferred.outcome).toBe('deferred-locked')
      expect(deferred.diagnostics).toContain(`locked:${lock}`)
      expect(existsSync(join(home, 'rox'))).toBe(false)
      rmSync(lock)
      expect(migrateHiddenRoxHome(opts(home)).outcome).toBe('migrated')
      expect(existsSync(lock)).toBe(false)
    }))

  it('a live lock at the old tmpdir location (older build) still defers', () =>
    withHome((home) => {
      plantHidden(home)
      const legacy = join(home, 'old-tmp', 'rox-migrate-0.lock')
      liveLock(legacy)
      const result = migrateHiddenRoxHome(opts(home, { legacyProcessLockPaths: [legacy] }))
      expect(result.outcome).toBe('deferred-locked')
      expect(result.diagnostics).toContain(`locked:${legacy}`)
      expect(existsSync(join(home, ROX_MIGRATION_LOCK_FILE_NAME))).toBe(false)
    }))

  it('a dry run never creates the lock', () =>
    withHome((home) => {
      plantHidden(home)
      expect(migrateHiddenRoxHome(opts(home, { dryRun: true })).outcome).toBe('migrated')
      expect(readdirSync(home).sort()).toEqual(['.rox'])
    }))
})
