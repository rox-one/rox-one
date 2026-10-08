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
  desktopAppRuntimeLockPaths,
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
      const runtime = desktopAppRuntimeLockPaths(configDir)
      expect(runtime.length).toBeGreaterThan(0)
      expect(runtime.every((p) => existsSync(p))).toBe(true)
      release()
      expect(existsSync(join(configDir, ROX_DESKTOP_APP_LOCK_NAME))).toBe(false)
      expect(runtime.some((p) => existsSync(p))).toBe(false)
    }))

  it('flag OFF (inConfigDir: false) adds nothing to the config dir', () =>
    withHome((home) => {
      const configDir = join(home, '.rox')
      mkdirSync(configDir)
      const release = holdDesktopAppLock(configDir, { inConfigDir: false })
      expect(readdirSync(configDir)).toEqual([])
      expect(readdirSync(home)).toEqual(['.rox'])
      const runtime = desktopAppRuntimeLockPaths(configDir)
      expect(runtime.every((p) => existsSync(p) && !p.startsWith(home))).toBe(true)
      release()
      expect(runtime.some((p) => existsSync(p))).toBe(false)
    }))

  it('--revert is refused while an app launched on the compat-link path runs', () =>
    withHome((home) => {
      write(join(home, '.rox', 'config.json'), '{"workspaces":[{"id":"a"}]}')
      expect(migrateHiddenRoxHome(opts(home)).outcome).toBe('migrated')
      writeFileSync(join(home, 'runtime-hidden.lock'), livePeerLock()) // keyed by ~/.rox
      const result = revertVisibleRoxHome(opts(home, { env: { ROX_STORAGE_VISIBLE_ROOT: '0' } }))
      expect(result.outcome).toBe('revert-refused')
      expect(result.diagnostics).toContain('locked:desktop-app')
      expect(lstatSync(join(home, '.rox')).isSymbolicLink()).toBe(true)
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

describe('incomplete merge (finding 3; review 7: the pre-merge resolution stays authoritative)', () => {
  const plantBoth = (home: string): void => {
    // Legacy home holds the user's data; ~/rox is a fresh default home.
    write(join(home, '.rox', 'config.json'), '{"workspaces":[{"id":"real"}]}')
    write(join(home, '.rox', 'workspaces', 'real', 'notes.md'), 'mine')
    write(join(home, '.rox', 'secret', 'token'), 'shh')
    write(join(home, 'rox', 'config.json'), '{"workspaces":[]}')
  }
  const plantBothWithData = (home: string): void => {
    write(join(home, 'rox', 'config.json'), '{"workspaces":[{"id":"v"}]}')
    // A different size: same-size files with the same mtime count as identical.
    write(join(home, '.rox', 'config.json'), '{"workspaces":[{"id":"hidden"}]}')
    write(join(home, '.rox', 'secret', 'token'), 'shh')
  }

  it('a data-less ~/rox never receives a partial copy: ~/.rox takes its place in one rename', () =>
    withHome((home) => {
      plantBoth(home)
      chmodSync(join(home, '.rox', 'secret'), 0o000) // unreadable, but never read: renamed whole
      const result = migrateHiddenRoxHome(opts(home))
      chmodSync(join(home, 'rox', 'secret'), 0o700)
      expect(result.outcome).toBe('merged')
      expect(readFileSync(join(home, 'rox', 'config.json'), 'utf8')).toContain('real')
      expect(readFileSync(join(home, 'rox', 'secret', 'token'), 'utf8')).toBe('shh')
      // Review 8: the bare default config (no workspaces, nothing else)
      // carries nothing the home lacks: no spurious conflict.
      expect(result.conflicts).toEqual([])
      expect(existsSync(join(home, 'rox', '.migration', 'conflicts', 'ts-r2', 'config.json'))).toBe(false)
      expect(existsSync(mergeIncompleteMarkerPath(join(home, 'rox')))).toBe(false)
      expect(lstatSync(join(home, '.rox')).isSymbolicLink()).toBe(true)
      expect(readdirSync(home).filter((n) => n.startsWith('.rox.migrated-'))).toEqual([])
    }))

  it('an import that throws midway keeps ~/.rox intact and the marker keeps ~/rox (with user data) authoritative', () =>
    withHome((home) => {
      plantBothWithData(home)
      expect(resolveVisibleHomeWithoutMigration(home)).toBe(join(home, 'rox'))
      chmodSync(join(home, '.rox', 'secret'), 0o000) // EACCES while importing
      expect(() => migrateHiddenRoxHome(opts(home))).toThrow()
      chmodSync(join(home, '.rox', 'secret'), 0o700)
      expect(lstatSync(join(home, '.rox')).isDirectory()).toBe(true)
      expect(readFileSync(join(home, '.rox', 'config.json'), 'utf8')).toContain('"hidden"')
      const marker = readMergeIncompleteMarker(join(home, 'rox'))
      expect(marker).toEqual(expect.objectContaining({ hiddenHasData: true, visibleHasData: true, choice: 'visible' }))
      expect(marker?.lastFailure).toEqual(expect.objectContaining({ code: 'EACCES', attempts: 1 }))
      expect(resolveVisibleHomeWithoutMigration(home)).toBe(join(home, 'rox'))
    }))

  it('the retry keeps ~/rox and its edits; only what is left is imported', () =>
    withHome((home) => {
      plantBothWithData(home)
      chmodSync(join(home, '.rox', 'secret'), 0o000)
      expect(() => migrateHiddenRoxHome(opts(home))).toThrow()
      chmodSync(join(home, '.rox', 'secret'), 0o700)
      writeFileSync(join(home, 'rox', 'config.json'), '{"workspaces":[{"id":"v2"}]}') // the app keeps working in ~/rox
      const result = migrateHiddenRoxHome(opts(home, { timestamp: 'ts-r2b' }))
      expect(result.outcome).toBe('merged')
      expect(readFileSync(join(home, 'rox', 'config.json'), 'utf8')).toContain('v2')
      expect(readFileSync(join(home, 'rox', 'secret', 'token'), 'utf8')).toBe('shh')
      // The legacy config is stashed exactly once (whichever attempt reached it first).
      expect(result.conflicts).toHaveLength(1)
      expect(result.conflicts[0]).toMatch(/^ts-r2b?\/config\.json$/)
      expect(existsSync(mergeIncompleteMarkerPath(join(home, 'rox')))).toBe(false)
      expect(lstatSync(join(home, '.rox')).isSymbolicLink()).toBe(true)
      expect(resolveVisibleHomeWithoutMigration(home)).toBe(join(home, 'rox'))
    }))

  it('~/rox without user data is never the merge target: the resolution and the move both keep ~/.rox first', () =>
    withHome((home) => {
      write(join(home, 'rox', 'config.json'), '{"workspaces":[]}')
      write(join(home, '.rox', 'config.json'), '{"workspaces":[{"id":"h"}]}')
      expect(resolveVisibleHomeWithoutMigration(home)).toBe(join(home, '.rox'))
      expect(migrateHiddenRoxHome(opts(home)).outcome).toBe('merged')
      expect(readFileSync(join(home, 'rox', 'config.json'), 'utf8')).toContain('"h"')
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
      write(join(home, 'rox', 'config.json'), '{"workspaces":[{"id":"v"}]}') // ~/rox holds user data: import path
      write(join(home, 'rox', 'a'), 'visible file')
      write(join(home, '.rox', 'a', 'top.txt'), 'top')
      write(join(home, '.rox', 'a', 'b', 'c', 'deep.txt'), 'deep')
      mkdirSync(join(home, '.rox', 'a', 'empty'), { recursive: true })
      const result = migrateHiddenRoxHome(opts(home))
      expect(result.outcome).toBe('merged')
      expect(result.conflicts).toEqual(expect.arrayContaining(['ts-r2/a/top.txt', 'ts-r2/a/b/c/deep.txt', 'ts-r2/a/empty/']))
      const stash = join(home, 'rox', '.migration', 'conflicts', 'ts-r2', 'a')
      expect(readFileSync(join(stash, 'b', 'c', 'deep.txt'), 'utf8')).toBe('deep')
      expect(readFileSync(join(home, 'rox', 'a'), 'utf8')).toBe('visible file')
      const revert = revertVisibleRoxHome(opts(home, { flagActive: false }))
      expect(revert.outcome).toBe('revert-refused')
      expect(revert.diagnostics).toContain('storage.migration.revertRefusedConflicts')
    }))
})
