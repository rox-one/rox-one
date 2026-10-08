/**
 * W1-13 (#1510) review-2 regressions: desktop app lock, foreign `~/rox`,
 * incomplete merges, win32 junction comparison, re-classification under the
 * process lock, plain-PID boot staleness, recursive conflict stashing.
 *
 * SAFETY: temp HOME (`mkdtemp`) + explicit `homeDir`/`env` only.
 */
import { describe, expect, it } from 'bun:test'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import {
  ROX_DESKTOP_APP_LOCK_NAME,
  ROX_PIDLESS_LOCK_TTL_MS,
  holdDesktopAppLock,
  desktopAppRuntimeLockPath,
  isForeignVisibleHome,
  isLockFileLive,
  mergeIncompleteMarkerPath,
  migrateHiddenRoxHome,
  readMergeIncompleteMarker,
  resolveVisibleHomeWithoutMigration,
  revertVisibleRoxHome,
  symlinkTargetMatches,
  type MigrateHiddenRoxHomeOptions,
} from '../config-migration.ts'

function withHome(run: (home: string) => void): void {
  const home = mkdtempSync(join(tmpdir(), 'rox-visible-home-r2-'))
  try {
    run(home)
  } finally {
    spawnSync('chmod', ['-R', 'u+rwx', home]) // undo EACCES fixtures (and their merged copies)
    rmSync(home, { recursive: true, force: true })
  }
}

const opts = (home: string, extra?: Partial<MigrateHiddenRoxHomeOptions>): MigrateHiddenRoxHomeOptions => ({
  homeDir: home,
  env: {},
  timestamp: 'ts-r2',
  skipProcessLock: true,
  desktopRuntimeLockPath: (dir) => join(home, `runtime-${dir.endsWith('rox') && !dir.endsWith('.rox') ? 'visible' : 'hidden'}.lock`),
  ...(extra ?? {}),
})

const write = (path: string, content: string): void => {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
}
const livePeerLock = (): string => JSON.stringify({ pid: process.ppid, startedAt: Date.now() })

describe('desktop app lock (finding 1b)', () => {
  it('a live app lock in the config dir defers an explicit migration', () =>
    withHome((home) => {
      write(join(home, '.rox', 'config.json'), '{"workspaces":[{"id":"a"}]}')
      writeFileSync(join(home, '.rox', ROX_DESKTOP_APP_LOCK_NAME), livePeerLock())
      const result = migrateHiddenRoxHome(opts(home))
      expect(result.outcome).toBe('deferred-locked')
      expect(result.diagnostics).toContain(`locked:${ROX_DESKTOP_APP_LOCK_NAME}`)
      expect(lstatSync(join(home, '.rox')).isDirectory()).toBe(true)
      expect(existsSync(join(home, 'rox'))).toBe(false)
    }))

  it('the runtime twin (flag-OFF app) defers too, without touching the config dir', () =>
    withHome((home) => {
      write(join(home, '.rox', 'config.json'), '{}')
      writeFileSync(join(home, 'runtime-hidden.lock'), livePeerLock())
      const result = migrateHiddenRoxHome(opts(home))
      expect(result.outcome).toBe('deferred-locked')
      expect(result.diagnostics).toContain('locked:desktop-app')
    }))

  it('own PID and a dead PID never defer', () =>
    withHome((home) => {
      write(join(home, '.rox', 'config.json'), '{}')
      writeFileSync(join(home, '.rox', ROX_DESKTOP_APP_LOCK_NAME), JSON.stringify({ pid: process.pid, startedAt: Date.now() }))
      expect(migrateHiddenRoxHome(opts(home, { dryRun: true })).outcome).toBe('migrated')
      writeFileSync(join(home, '.rox', ROX_DESKTOP_APP_LOCK_NAME), JSON.stringify({ pid: 2 ** 22 + 7, startedAt: Date.now() }))
      expect(migrateHiddenRoxHome(opts(home, { dryRun: true, isPidAlive: () => false })).outcome).toBe('migrated')
    }))

  it('holdDesktopAppLock writes {pid,startedAt} and releases only its own lock', () =>
    withHome((home) => {
      const configDir = join(home, '.rox')
      mkdirSync(configDir)
      const release = holdDesktopAppLock(configDir, { inConfigDir: true })
      const inDir = JSON.parse(readFileSync(join(configDir, ROX_DESKTOP_APP_LOCK_NAME), 'utf8'))
      expect(inDir.pid).toBe(process.pid)
      expect(typeof inDir.startedAt).toBe('number')
      expect(existsSync(desktopAppRuntimeLockPath(configDir))).toBe(true)
      release()
      expect(existsSync(join(configDir, ROX_DESKTOP_APP_LOCK_NAME))).toBe(false)
      expect(existsSync(desktopAppRuntimeLockPath(configDir))).toBe(false)
    }))

  it('flag OFF (inConfigDir: false) adds nothing to the config dir', () =>
    withHome((home) => {
      const configDir = join(home, '.rox')
      mkdirSync(configDir)
      const release = holdDesktopAppLock(configDir, { inConfigDir: false })
      expect(readdirSync(configDir)).toEqual([])
      expect(existsSync(desktopAppRuntimeLockPath(configDir))).toBe(true)
      release()
      expect(existsSync(desktopAppRuntimeLockPath(configDir))).toBe(false)
    }))
})

describe('foreign ~/rox (finding 4)', () => {
  const plantForeign = (home: string): void => {
    mkdirSync(join(home, 'rox', 'src'), { recursive: true })
    writeFileSync(join(home, 'rox', 'README.md'), '# my project')
    chmodSync(join(home, 'rox'), 0o755)
  }

  it('classification: markers make a Rox home; litter alone does not make it foreign', () =>
    withHome((home) => {
      const dir = join(home, 'rox')
      expect(isForeignVisibleHome(dir)).toBe(false) // absent
      mkdirSync(dir)
      writeFileSync(join(dir, '.DS_Store'), '')
      expect(isForeignVisibleHome(dir)).toBe(false) // effectively empty
      writeFileSync(join(dir, 'README.md'), 'x')
      expect(isForeignVisibleHome(dir)).toBe(true)
      for (const marker of ['config.json', 'workspaces', '.migration', 'workbench-flags.json']) {
        const path = join(dir, marker)
        if (marker === 'workspaces' || marker === '.migration') mkdirSync(path)
        else writeFileSync(path, '{}')
        expect(isForeignVisibleHome(dir)).toBe(false)
        rmSync(path, { recursive: true, force: true })
      }
    }))

  it('defers: no merge, no chmod, ~/.rox not renamed, resolution keeps ~/.rox', () =>
    withHome((home) => {
      plantForeign(home)
      write(join(home, '.rox', 'config.json'), '{"workspaces":[{"id":"a"}]}')
      const before = readdirSync(join(home, 'rox')).sort()
      const result = migrateHiddenRoxHome(opts(home))
      expect(result.outcome).toBe('deferred-foreign')
      expect(result.diagnostics).toContain('storage.migration.deferredForeign')
      expect(readdirSync(join(home, 'rox')).sort()).toEqual(before)
      expect(statSync(join(home, 'rox')).mode & 0o777).toBe(0o755)
      expect(lstatSync(join(home, '.rox')).isDirectory()).toBe(true)
      expect(existsSync(join(home, '.rox.migrated-ts-r2'))).toBe(false)
      expect(resolveVisibleHomeWithoutMigration(home)).toBe(join(home, '.rox'))
    }))

  it('without a legacy home: still foreign, never adopted or chmodded', () =>
    withHome((home) => {
      plantForeign(home)
      expect(migrateHiddenRoxHome(opts(home)).outcome).toBe('deferred-foreign')
      expect(statSync(join(home, 'rox')).mode & 0o777).toBe(0o755)
      expect(resolveVisibleHomeWithoutMigration(home)).toBe(join(home, '.rox'))
    }))
})

describe('incomplete merge (finding 3)', () => {
  const plantBoth = (home: string): void => {
    // Legacy home holds the user's data; ~/rox is a fresh default home.
    write(join(home, '.rox', 'config.json'), '{"workspaces":[{"id":"real"}]}')
    write(join(home, '.rox', 'workspaces', 'real', 'notes.md'), 'mine')
    write(join(home, '.rox', 'secret', 'token'), 'shh')
    write(join(home, 'rox', 'config.json'), '{"workspaces":[]}')
  }

  it('a merge that throws midway keeps ~/.rox intact and the marker pins the legacy choice', () =>
    withHome((home) => {
      plantBoth(home)
      chmodSync(join(home, '.rox', 'secret'), 0o000) // EACCES while merging
      expect(() => migrateHiddenRoxHome(opts(home))).toThrow()
      chmodSync(join(home, '.rox', 'secret'), 0o700)
      // Legacy home untouched and still a real dir.
      expect(lstatSync(join(home, '.rox')).isDirectory()).toBe(true)
      expect(readFileSync(join(home, '.rox', 'config.json'), 'utf8')).toContain('real')
      const marker = readMergeIncompleteMarker(join(home, 'rox'))
      expect(marker).toEqual(expect.objectContaining({ hiddenHasData: true, visibleHasData: false, choice: 'hidden' }))
      // ~/rox now "has data" (copied workspaces) but must not win.
      expect(resolveVisibleHomeWithoutMigration(home)).toBe(join(home, '.rox'))
    }))

  it('a retry uses the pre-merge snapshot: newer writes into the partial ~/rox never beat the real config', () =>
    withHome((home) => {
      plantBoth(home)
      chmodSync(join(home, '.rox', 'secret'), 0o000)
      expect(() => migrateHiddenRoxHome(opts(home))).toThrow()
      chmodSync(join(home, '.rox', 'secret'), 0o700)
      // Something rewrote the default config in ~/rox later (newer mtime).
      writeFileSync(join(home, 'rox', 'config.json'), '{"workspaces":[{"id":"default"}]}')
      utimesSync(join(home, '.rox', 'config.json'), new Date('2020-01-01'), new Date('2020-01-01'))
      const result = migrateHiddenRoxHome(opts(home))
      expect(result.outcome).toBe('merged')
      expect(readFileSync(join(home, 'rox', 'config.json'), 'utf8')).toContain('real')
      expect(result.conflicts).toContain('config.json')
      expect(existsSync(mergeIncompleteMarkerPath(join(home, 'rox')))).toBe(false)
      expect(lstatSync(join(home, '.rox')).isSymbolicLink()).toBe(true)
      expect(resolveVisibleHomeWithoutMigration(home)).toBe(join(home, 'rox'))
    }))

  it('the marker keeps a visible choice when ~/rox was already the home', () =>
    withHome((home) => {
      write(join(home, 'rox', 'config.json'), '{"workspaces":[{"id":"v"}]}')
      write(join(home, '.rox', 'config.json'), '{"workspaces":[{"id":"h"}]}')
      write(join(home, '.rox', 'secret', 'token'), 'shh')
      chmodSync(join(home, '.rox', 'secret'), 0o000)
      expect(() => migrateHiddenRoxHome(opts(home))).toThrow()
      chmodSync(join(home, '.rox', 'secret'), 0o700)
      expect(readMergeIncompleteMarker(join(home, 'rox'))?.choice).toBe('visible')
      expect(resolveVisibleHomeWithoutMigration(home)).toBe(join(home, 'rox'))
    }))
})

describe('win32 junction comparison (finding 5)', () => {
  const link = 'C:\\Users\\me\\.rox'
  const target = 'C:\\Users\\me\\rox'
  it('accepts the stored junction forms', () => {
    for (const value of ['C:\\Users\\me\\rox\\', 'C:\\Users\\me\\rox', '\\\\?\\C:\\Users\\me\\rox\\', 'c:\\users\\ME\\ROX\\', 'rox', 'C:/Users/me/rox/']) {
      expect(symlinkTargetMatches(link, value, target, 'win32')).toBe(true)
    }
  })
  it('rejects other targets', () => {
    for (const value of ['C:\\Users\\me\\rox2\\', 'D:\\Users\\me\\rox', '\\\\?\\C:\\Users\\other\\rox\\', 'elsewhere']) {
      expect(symlinkTargetMatches(link, value, target, 'win32')).toBe(false)
    }
  })
  it('posix: trailing slash and relative targets match; case matters', () => {
    expect(symlinkTargetMatches('/h/.rox', '/h/rox/', '/h/rox', 'linux')).toBe(true)
    expect(symlinkTargetMatches('/h/.rox', 'rox', '/h/rox', 'linux')).toBe(true)
    expect(symlinkTargetMatches('/h/.rox', '/h/ROX', '/h/rox', 'linux')).toBe(false)
  })
  it('real filesystem: a link stored with a trailing separator is already-symlinked and revertible', () =>
    withHome((home) => {
      write(join(home, 'rox', 'config.json'), '{}')
      symlinkSync(`${join(home, 'rox')}/`, join(home, '.rox'))
      expect(migrateHiddenRoxHome(opts(home)).outcome).toBe('already-symlinked')
      expect(revertVisibleRoxHome(opts(home, { flagActive: false })).outcome).toBe('reverted')
      expect(lstatSync(join(home, '.rox')).isDirectory()).toBe(true)
    }))
})

describe('re-classification under the process lock (finding 8)', () => {
  it('a migration finished by another process while waiting is not redone', () =>
    withHome((home) => {
      write(join(home, '.rox', 'config.json'), '{"workspaces":[{"id":"a"}]}')
      let calls = 0
      const result = migrateHiddenRoxHome(
        opts(home, {
          isLocked: () => {
            calls++
            if (calls === 1) {
              // "Another process" completes the move before we hold the lock.
              expect(migrateHiddenRoxHome(opts(home, { isLocked: () => [] })).outcome).toBe('migrated')
            }
            return []
          },
        }),
      )
      expect(result.outcome).toBe('already-symlinked')
      expect(lstatSync(join(home, '.rox')).isSymbolicLink()).toBe(true)
      expect(readFileSync(join(home, 'rox', 'config.json'), 'utf8')).toContain('"a"')
      expect(readdirSync(home).filter((name) => name.startsWith('.rox.migrated'))).toEqual([])
    }))
})

describe('plain-PID lock staleness (finding 9)', () => {
  it('a plain-PID lock written before this boot is stale even if the PID is alive', () =>
    withHome((home) => {
      const path = join(home, '.server.lock')
      writeFileSync(path, String(process.ppid))
      const options = { now: Date.now(), isPidAlive: () => true, pidlessTtlMs: ROX_PIDLESS_LOCK_TTL_MS }
      expect(isLockFileLive(path, options)).toBe(true)
      utimesSync(path, new Date('2001-01-01'), new Date('2001-01-01'))
      expect(isLockFileLive(path, options)).toBe(false)
    }))
})

describe('recursive conflict stash (finding 10)', () => {
  it('a legacy directory colliding with a ~/rox file is stashed whole and blocks revert', () =>
    withHome((home) => {
      write(join(home, 'rox', 'config.json'), '{}')
      write(join(home, 'rox', 'a'), 'visible file')
      write(join(home, '.rox', 'a', 'top.txt'), 'top')
      write(join(home, '.rox', 'a', 'b', 'c', 'deep.txt'), 'deep')
      mkdirSync(join(home, '.rox', 'a', 'empty'), { recursive: true })
      const result = migrateHiddenRoxHome(opts(home))
      expect(result.outcome).toBe('merged')
      expect(result.conflicts).toEqual(expect.arrayContaining(['a/top.txt', 'a/b/c/deep.txt', 'a/empty/']))
      const stash = join(home, 'rox', '.migration', 'conflicts', 'a')
      expect(readFileSync(join(stash, 'b', 'c', 'deep.txt'), 'utf8')).toBe('deep')
      expect(readFileSync(join(home, 'rox', 'a'), 'utf8')).toBe('visible file')
      const revert = revertVisibleRoxHome(opts(home, { flagActive: false }))
      expect(revert.outcome).toBe('revert-refused')
      expect(revert.diagnostics).toContain('storage.migration.revertRefusedConflicts')
    }))
})
