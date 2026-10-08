/**
 * W1-13 (#1510) review-3 regressions: `~/rox` linking into the hidden tree,
 * per-attempt conflict stashes, marker lifecycle around the final rename,
 * compat-link failures (rollback / relaunch) and the EXDEV swap. The flag
 * file location (finding 6) is in visible-home-flag-location.test.ts.
 *
 * SAFETY: temp HOME (`mkdtemp`) + explicit `homeDir`/`env` only.
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
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import {
  mergeIncompleteMarkerPath,
  migrateHiddenRoxHome,
  readMergeIncompleteMarker,
  resolveVisibleHomeWithoutMigration,
  type MigrateHiddenRoxHomeOptions,
} from '../config-migration.ts'
import { resetConfigDirCachesForTests } from '../../config/env.ts'

beforeEach(() => resetConfigDirCachesForTests())

function withHome(run: (home: string) => void): void {
  const home = mkdtempSync(join(tmpdir(), 'rox-visible-home-r3-'))
  try {
    run(home)
  } finally {
    spawnSync('chmod', ['-R', 'u+rwx', home])
    rmSync(home, { recursive: true, force: true })
    resetConfigDirCachesForTests()
  }
}

const opts = (home: string, extra?: Partial<MigrateHiddenRoxHomeOptions>): MigrateHiddenRoxHomeOptions => ({
  homeDir: home,
  env: {},
  timestamp: 'ts-r3',
  skipProcessLock: true,
  desktopRuntimeLockPath: (dir) => join(home, `runtime-${dir.endsWith('.rox') ? 'hidden' : 'visible'}.lock`),
  ...(extra ?? {}),
})
const write = (path: string, content: string): void => {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
}
const errno = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code })
const plantHidden = (home: string): void => {
  write(join(home, '.rox', 'config.json'), '{"workspaces":[{"id":"real"}]}')
  write(join(home, '.rox', 'workspaces', 'real', 'notes.md'), 'mine')
}
const migratedLeftovers = (home: string): string[] => readdirSync(home).filter((n) => n.startsWith('.rox.migrated-'))

describe('~/rox linking into the hidden tree (finding 1)', () => {
  it('repro: ln -s ~/.rox ~/rox migrates without a loop and loses nothing', () =>
    withHome((home) => {
      plantHidden(home)
      symlinkSync(join(home, '.rox'), join(home, 'rox'))
      expect(resolveVisibleHomeWithoutMigration(home)).toBe(join(home, '.rox'))
      const result = migrateHiddenRoxHome(opts(home))
      expect(result.outcome).toBe('migrated')
      expect(lstatSync(join(home, 'rox')).isDirectory()).toBe(true) // the link is gone, data moved in
      expect(lstatSync(join(home, '.rox')).isSymbolicLink()).toBe(true)
      expect(readlinkSync(join(home, '.rox'))).toBe(join(home, 'rox'))
      expect(readdirSync(join(home, 'rox')).sort()).toEqual(expect.arrayContaining(['config.json', 'workspaces']))
      expect(readFileSync(join(home, 'rox', 'workspaces', 'real', 'notes.md'), 'utf8')).toBe('mine')
      expect(migratedLeftovers(home)).toEqual([])
      expect(resolveVisibleHomeWithoutMigration(home)).toBe(join(home, 'rox'))
    }))

  it('a relative link and a link into a hidden subdirectory are handled the same way', () => {
    withHome((home) => {
      plantHidden(home)
      symlinkSync('.rox', join(home, 'rox'))
      expect(migrateHiddenRoxHome(opts(home)).outcome).toBe('migrated')
      expect(readFileSync(join(home, 'rox', 'config.json'), 'utf8')).toContain('real')
    })
    withHome((home) => {
      plantHidden(home)
      symlinkSync(join(home, '.rox', 'workspaces'), join(home, 'rox'))
      expect(resolveVisibleHomeWithoutMigration(home)).toBe(join(home, '.rox'))
      expect(migrateHiddenRoxHome(opts(home)).outcome).toBe('migrated')
      expect(readFileSync(join(home, 'rox', 'workspaces', 'real', 'notes.md'), 'utf8')).toBe('mine')
    })
  })

  it('dry run leaves the link; an unremovable link defers with everything untouched', () =>
    withHome((home) => {
      plantHidden(home)
      symlinkSync(join(home, '.rox'), join(home, 'rox'))
      expect(migrateHiddenRoxHome(opts(home, { dryRun: true })).outcome).toBe('migrated')
      expect(lstatSync(join(home, 'rox')).isSymbolicLink()).toBe(true)
      chmodSync(home, 0o555) // unlink fails (EACCES)
      try {
        const result = migrateHiddenRoxHome(opts(home))
        expect(result.outcome).toBe('deferred-link')
        expect(result.diagnostics).toContain('storage.migration.visibleLinkIntoHidden')
      } finally {
        chmodSync(home, 0o700)
      }
      expect(lstatSync(join(home, 'rox')).isSymbolicLink()).toBe(true)
      expect(lstatSync(join(home, '.rox')).isDirectory()).toBe(true)
      expect(readFileSync(join(home, '.rox', 'config.json'), 'utf8')).toContain('real')
    }))

  it('a ~/rox that contains the hidden tree (link to $HOME) is foreign', () =>
    withHome((home) => {
      plantHidden(home)
      symlinkSync(home, join(home, 'rox'))
      expect(resolveVisibleHomeWithoutMigration(home)).toBe(join(home, '.rox'))
      expect(migrateHiddenRoxHome(opts(home)).outcome).toBe('deferred-foreign')
      expect(lstatSync(join(home, '.rox')).isDirectory()).toBe(true)
    }))
})
