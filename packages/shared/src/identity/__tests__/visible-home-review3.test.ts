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

describe('conflict stashes are never overwritten (finding 2)', () => {
  // Attempt 1 stashes the older visible config (V0) and copies the hidden
  // one in, then the final rename fails (e.g. Windows EBUSY). The app keeps
  // writing to ~/rox; attempt 2 stashes the other side.
  const failFinalRenameOnce = () => {
    let failed = false
    return (source: string, destination: string): void => {
      if (!failed && destination.includes('.rox.migrated-')) {
        failed = true
        throw errno('EBUSY')
      }
      renameSync(source, destination)
    }
  }
  const plant = (home: string): void => {
    write(join(home, 'rox', 'config.json'), '{"workspaces":[{"id":"V0"}]}')
    write(join(home, '.rox', 'config.json'), '{"workspaces":[{"id":"H"}]}')
    utimesSync(join(home, 'rox', 'config.json'), new Date('2020-01-01'), new Date('2020-01-01'))
  }

  it('repro: a retry after a failed rename keeps V0 (per-attempt dirs)', () =>
    withHome((home) => {
      plant(home)
      expect(() => migrateHiddenRoxHome(opts(home, { timestamp: 'ts-a', rename: failFinalRenameOnce() }))).toThrow('EBUSY')
      expect(readFileSync(join(home, 'rox', '.migration', 'conflicts', 'ts-a', 'config.json'), 'utf8')).toContain('V0')
      writeFileSync(join(home, 'rox', 'config.json'), '{"workspaces":[{"id":"V1"}]}') // newer edit in ~/rox
      const result = migrateHiddenRoxHome(opts(home, { timestamp: 'ts-b' }))
      expect(result.outcome).toBe('merged')
      expect(readFileSync(join(home, 'rox', '.migration', 'conflicts', 'ts-a', 'config.json'), 'utf8')).toContain('V0')
      expect(result.conflicts).toEqual(expect.arrayContaining(['ts-a/config.json', 'ts-b/config.json']))
    }))

  it('same attempt id: a differing stash gets a suffix instead of replacing V0', () =>
    withHome((home) => {
      plant(home)
      expect(() => migrateHiddenRoxHome(opts(home, { rename: failFinalRenameOnce() }))).toThrow('EBUSY')
      writeFileSync(join(home, 'rox', 'config.json'), '{"workspaces":[{"id":"V1"}]}')
      const result = migrateHiddenRoxHome(opts(home))
      expect(readFileSync(join(home, 'rox', '.migration', 'conflicts', 'ts-r3', 'config.json'), 'utf8')).toContain('V0')
      expect(readFileSync(join(home, 'rox', '.migration', 'conflicts', 'ts-r3', 'config.json.1'), 'utf8')).toContain('"H"')
      expect(result.conflicts).toEqual(expect.arrayContaining(['ts-r3/config.json', 'ts-r3/config.json.1']))
    }))
})

describe('incomplete-merge marker around the final rename (finding 3)', () => {
  const plantBoth = (home: string): void => {
    plantHidden(home)
    write(join(home, 'rox', 'config.json'), '{"workspaces":[]}')
  }

  it('linkDir failing with ~/.rox still free: original put back, marker restored, retry merges', () =>
    withHome((home) => {
      plantBoth(home)
      expect(() =>
        migrateHiddenRoxHome(opts(home, { linkDir: () => { throw errno('EPERM') } })),
      ).toThrow('EPERM')
      expect(lstatSync(join(home, '.rox')).isDirectory()).toBe(true)
      expect(readFileSync(join(home, '.rox', 'config.json'), 'utf8')).toContain('real')
      expect(migratedLeftovers(home)).toEqual([])
      expect(readMergeIncompleteMarker(join(home, 'rox'))?.choice).toBe('hidden')
      expect(resolveVisibleHomeWithoutMigration(home)).toBe(join(home, '.rox'))
      expect(migrateHiddenRoxHome(opts(home, { timestamp: 'ts-retry' })).outcome).toBe('merged')
      expect(lstatSync(join(home, '.rox')).isSymbolicLink()).toBe(true)
    }))

  it('linkDir failing because ~/.rox was recreated: marker gone, ~/rox wins, relaunch required', () =>
    withHome((home) => {
      plantBoth(home)
      const result = migrateHiddenRoxHome(
        opts(home, {
          linkDir: (_target, path) => {
            mkdirSync(path) // a racing writer recreated the legacy dir
            throw errno('EEXIST')
          },
        }),
      )
      expect(result.outcome).toBe('merged')
      expect(result.relaunchRequired).toBe(true)
      expect(result.diagnostics).toContain('storage.migration.compatLinkMissing')
      expect(existsSync(mergeIncompleteMarkerPath(join(home, 'rox')))).toBe(false)
      expect(readFileSync(join(home, 'rox', 'config.json'), 'utf8')).toContain('real')
      expect(resolveVisibleHomeWithoutMigration(home)).toBe(join(home, 'rox'))
    }))

  it('a marker from another hidden tree (different inode) is stale for resolution and the migrator', () =>
    withHome((home) => {
      plantBoth(home)
      write(join(home, 'rox', 'config.json'), '{"workspaces":[{"id":"merged"}]}')
      write(
        mergeIncompleteMarkerPath(join(home, 'rox')),
        JSON.stringify({ startedAt: 1, hiddenHasData: true, visibleHasData: false, choice: 'hidden', hiddenId: '1:2' }),
      )
      expect(resolveVisibleHomeWithoutMigration(home)).toBe(join(home, 'rox'))
      expect(() => migrateHiddenRoxHome(opts(home, { linkDir: () => { throw errno('EPERM') } }))).toThrow('EPERM')
      const marker = readMergeIncompleteMarker(join(home, 'rox'))
      expect(marker?.hiddenId).toBeDefined()
      expect(marker?.hiddenId).not.toBe('1:2') // fresh snapshot of the real tree
      expect(marker?.visibleHasData).toBe(true)
    }))
})

describe('hidden-only compat-link failure (finding 4)', () => {
  it('rolls the move back when ~/.rox is still absent (mode and contents as before)', () =>
    withHome((home) => {
      plantHidden(home)
      chmodSync(join(home, '.rox'), 0o750)
      expect(() => migrateHiddenRoxHome(opts(home, { linkDir: () => { throw errno('EPERM') } }))).toThrow('EPERM')
      expect(existsSync(join(home, 'rox'))).toBe(false)
      expect(lstatSync(join(home, '.rox')).isDirectory()).toBe(true)
      expect(statSync(join(home, '.rox')).mode & 0o777).toBe(0o750)
      expect(readdirSync(join(home, '.rox')).sort()).toEqual(['config.json', 'workspaces'])
    }))

  it('requires a relaunch onto ~/rox when ~/.rox was recreated meanwhile', () =>
    withHome((home) => {
      plantHidden(home)
      const result = migrateHiddenRoxHome(
        opts(home, {
          linkDir: (_target, path) => {
            mkdirSync(path)
            throw errno('EEXIST')
          },
        }),
      )
      expect(result.outcome).toBe('migrated')
      expect(result.relaunchRequired).toBe(true)
      expect(readFileSync(join(home, 'rox', 'config.json'), 'utf8')).toContain('real')
      expect(resolveVisibleHomeWithoutMigration(home)).toBe(join(home, 'rox'))
    }))
})

describe('EXDEV swap failure (finding 5)', () => {
  const exdevRename = (options: { failSwap: boolean; failMoveBack: boolean }) =>
    (source: string, destination: string): void => {
      if (source.endsWith('.rox') && destination.endsWith('rox') && !destination.endsWith('.rox')) throw errno('EXDEV')
      if (options.failSwap && destination.includes('.rox.migrated-')) throw errno('EBUSY')
      if (options.failMoveBack && destination.includes('rox.tmp-')) throw errno('EBUSY')
      renameSync(source, destination)
    }

  it('moves our staging copy back out of ~/rox: state exactly as before', () =>
    withHome((home) => {
      plantHidden(home)
      expect(() => migrateHiddenRoxHome(opts(home, { rename: exdevRename({ failSwap: true, failMoveBack: false }) }))).toThrow('EBUSY')
      expect(readdirSync(home).sort()).toEqual(['.rox'])
      expect(readdirSync(join(home, '.rox')).sort()).toEqual(['config.json', 'workspaces'])
      expect(resolveVisibleHomeWithoutMigration(home)).toBe(join(home, '.rox'))
    }))

  it('if the copy cannot leave ~/rox, the legacy tree is pinned by the marker', () =>
    withHome((home) => {
      plantHidden(home)
      expect(() => migrateHiddenRoxHome(opts(home, { rename: exdevRename({ failSwap: true, failMoveBack: true }) }))).toThrow('EBUSY')
      expect(readMergeIncompleteMarker(join(home, 'rox'))?.choice).toBe('hidden')
      expect(resolveVisibleHomeWithoutMigration(home)).toBe(join(home, '.rox'))
      expect(readdirSync(join(home, '.rox')).sort()).toEqual(['config.json', 'workspaces'])
    }))

  it('the successful EXDEV path still migrates', () =>
    withHome((home) => {
      plantHidden(home)
      const result = migrateHiddenRoxHome(opts(home, { rename: exdevRename({ failSwap: false, failMoveBack: false }) }))
      expect(result.outcome).toBe('migrated')
      expect(lstatSync(join(home, '.rox')).isSymbolicLink()).toBe(true)
      expect(migratedLeftovers(home)).toEqual(['.rox.migrated-ts-r3'])
    }))
})
