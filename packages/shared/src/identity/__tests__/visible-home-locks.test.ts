/**
 * W1-13 (#1510) review-4 finding 6: lock locations. The migration process
 * lock sits next to the homes it protects; the runtime desktop lock is
 * written to and probed in several runtime dirs (never under $HOME), and the
 * old tmpdir locations stay honoured.
 *
 * SAFETY: temp HOME (`mkdtemp`) + explicit `homeDir`/`env` only.
 */
import { beforeEach, describe, expect, it } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
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
  ...(extra ?? {}),
})

describe('runtime desktop lock locations', () => {
  it('private bases are used directly, shared ones through a per-user subdir; deduplicated; never under $HOME', () =>
    withHome((home) => {
      const dir = join(home, '.rox')
      const privateTmp = join(home, 'T')
      const xdg = join(home, 'xdg')
      const shared = join(home, 'shared-tmp')
      for (const d of [privateTmp, xdg, shared]) mkdirSync(d, { mode: 0o700 })
      chmodSync(shared, 0o1777)
      const uid = process.getuid?.()
      const paths = desktopAppRuntimeLockPaths(dir, {
        env: { XDG_RUNTIME_DIR: xdg },
        tmp: privateTmp,
        sharedTmp: shared,
        create: true,
      })
      expect(paths[0]).toBe(desktopAppRuntimeLockPath(dir, privateTmp))
      expect(paths.map((p) => join(p, '..'))).toEqual([privateTmp, xdg, join(shared, `rox-${uid}`)])
      expect(statSync(join(shared, `rox-${uid}`)).mode & 0o777).toBe(0o700)
      expect(desktopAppRuntimeLockPaths(dir, { env: {}, tmp: privateTmp, sharedTmp: privateTmp })).toEqual([
        desktopAppRuntimeLockPath(dir, privateTmp),
      ])
      expect(desktopAppRuntimeLockPaths(dir, { env: { XDG_RUNTIME_DIR: 'relative' }, tmp: privateTmp, sharedTmp: null })).toEqual([
        desktopAppRuntimeLockPath(dir, privateTmp),
      ])
      expect(desktopAppRuntimeLockPaths(dir).some((p) => p.startsWith(home))).toBe(false)
    }))

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
      mkdirSync(env.XDG_RUNTIME_DIR, { mode: 0o700 })
      const xdgLock = desktopAppRuntimeLockPaths(join(home, '.rox'), { env, sharedTmp: null }).find((p) =>
        p.startsWith(env.XDG_RUNTIME_DIR),
      ) ?? ''
      expect(xdgLock).not.toBe('')
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

  it('a dry run never creates the lock', () =>
    withHome((home) => {
      plantHidden(home)
      expect(migrateHiddenRoxHome(opts(home, { dryRun: true })).outcome).toBe('migrated')
      expect(readdirSync(home).sort()).toEqual(['.rox'])
    }))
})
