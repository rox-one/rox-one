/**
 * W1-13 (#1510) review-8 regressions: a directory is recorded in the import
 * sidecar only once `~/rox` has it (a failed mkdir never reads as a user
 * deletion), a handled dir removed from `~/rox` keeps its never-handled
 * children aside, Windows junctions for directory links inside the trees
 * (file symlinks that cannot be created become conflicts), no spurious
 * conflicts from the root files of a data-less `~/rox`, the `uses:visible`
 * pre-check diagnostic, and a sidecar flush per completed directory.
 *
 * SAFETY: temp HOME (`mkdtemp`) + explicit `homeDir`/`env` only.
 */
import { beforeEach, describe, expect, it } from 'bun:test'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { basename, join } from 'node:path'
import {
  migrateHiddenRoxHome,
  ROX_MERGE_IMPORTED_SIDECAR_NAME,
  type MigrateHiddenRoxHomeOptions,
} from '../config-migration.ts'
import { resetConfigDirCachesForTests } from '../../config/env.ts'

beforeEach(() => resetConfigDirCachesForTests())

function withHome(run: (home: string) => void): void {
  const home = mkdtempSync(join(tmpdir(), 'rox-visible-home-r8-'))
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
  timestamp: 'ts0',
  skipProcessLock: true,
  desktopRuntimeLockPath: (dir) => join(home, `runtime-${dir.endsWith('.rox') ? 'hidden' : 'visible'}.lock`),
  ...(extra ?? {}),
})
const write = (path: string, content: string): void => {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
}
const errno = (code: string): NodeJS.ErrnoException => Object.assign(new Error(`${code}: simulated`), { code })
const sidecarPath = (home: string): string => join(home, 'rox', '.migration', ROX_MERGE_IMPORTED_SIDECAR_NAME)
const sidecarPaths = (home: string): string[] =>
  existsSync(sidecarPath(home))
    ? readFileSync(sidecarPath(home), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => (JSON.parse(line) as { p?: string }).p)
        .filter((p): p is string => typeof p === 'string')
    : []
const conflictTree = (home: string): string[] => {
  const root = join(home, 'rox', '.migration', 'conflicts')
  return existsSync(root) ? (readdirSync(root, { recursive: true }) as string[]).sort() : []
}

describe('a dir is recorded only once ~/rox has it (error 1)', () => {
  it('reviewer repro: ~/rox/workspaces read-only → EACCES on attempt 1 → chmod back → retryFailedMerge imports workspaces/a/s.json', () =>
    withHome((home) => {
      write(join(home, 'rox', 'workspaces', 'v', 'notes.md'), 'visible ws')
      write(join(home, '.rox', 'workspaces', 'a', 's.json'), '{"s":1}')
      chmodSync(join(home, 'rox', 'workspaces'), 0o500)
      try {
        expect(() => migrateHiddenRoxHome(opts(home))).toThrow()
      } finally {
        chmodSync(join(home, 'rox', 'workspaces'), 0o700)
      }
      // `workspaces` exists in ~/rox (handled); `workspaces/a` was never created, so never recorded.
      expect(sidecarPaths(home)).toContain('workspaces')
      expect(sidecarPaths(home)).not.toContain('workspaces/a')

      const retry = migrateHiddenRoxHome(opts(home, { timestamp: 'ts1', retryFailedMerge: true }))
      expect(retry.outcome).toBe('merged')
      expect(retry.conflicts).toEqual([])
      expect(readFileSync(join(home, 'rox', 'workspaces', 'a', 's.json'), 'utf8')).toBe('{"s":1}')
      expect(readFileSync(join(home, 'rox', 'workspaces', 'v', 'notes.md'), 'utf8')).toBe('visible ws')
    }))

  it('a handled dir the user removed from ~/rox: handled children stay removed, never-handled ones are stashed (not dropped, not resurrected)', () =>
    withHome((home) => {
      write(join(home, 'rox', 'workspaces', 'v', 'notes.md'), 'visible ws')
      write(join(home, '.rox', 'workspaces', 'b', 'one.json'), 'one')
      write(join(home, '.rox', 'workspaces', 'b', 'two.json'), 'two')
      // Attempt 1 fails on the second file of `b` (a full disk).
      const seen: string[] = []
      const copyFile = (source: string, destination: string): void => {
        if (source.includes(`${join('workspaces', 'b')}/`)) {
          seen.push(basename(source))
          if (seen.length === 2) throw errno('ENOSPC')
        }
        copyFileSync(source, destination)
      }
      expect(() => migrateHiddenRoxHome(opts(home, { copyFile }))).toThrow('ENOSPC')
      const [first, second] = seen
      expect(sidecarPaths(home)).toEqual(expect.arrayContaining(['workspaces/b', `workspaces/b/${first}`]))
      expect(sidecarPaths(home)).not.toContain(`workspaces/b/${second}`)
      // The user deletes the partly imported workspace from ~/rox.
      rmSync(join(home, 'rox', 'workspaces', 'b'), { recursive: true })

      const retry = migrateHiddenRoxHome(opts(home, { timestamp: 'ts1', retryFailedMerge: true }))
      expect(retry.outcome).toBe('merged')
      expect(existsSync(join(home, 'rox', 'workspaces', 'b'))).toBe(false)
      expect(retry.conflicts).toEqual([`ts1/workspaces/b/${second}`])
      expect(readFileSync(join(home, 'rox', '.migration', 'conflicts', 'ts1', 'workspaces', 'b', second!), 'utf8')).toBe(
        second === 'one.json' ? 'one' : 'two',
      )
    }))

  it('a never-handled subdir under a removed dir is stashed whole', () =>
    withHome((home) => {
      write(join(home, 'rox', 'workspaces', 'v', 'notes.md'), 'visible ws')
      write(join(home, '.rox', 'workspaces', 'c', 'x.json'), 'x')
      expect(migrateHiddenRoxHome(opts(home, { rename: () => { throw errno('EBUSY') } })).outcome).toBe('deferred-unmovable')
      rmSync(join(home, 'rox', 'workspaces', 'c'), { recursive: true })
      // New in ~/.rox after the first attempt (never handled).
      write(join(home, '.rox', 'workspaces', 'c', 'later', 'y.json'), 'y')
      const retry = migrateHiddenRoxHome(opts(home, { timestamp: 'ts1', retryFailedMerge: true }))
      expect(retry.outcome).toBe('merged')
      expect(existsSync(join(home, 'rox', 'workspaces', 'c'))).toBe(false)
      expect(retry.conflicts).toEqual(['ts1/workspaces/c/later/y.json'])
    }))
})

describe('Windows: directory links inside the trees become junctions (warning 2)', () => {
  type Call = { target: string; path: string; type?: string }
  const winSymlink = (calls: Call[]) => (target: string, path: string, type?: 'dir' | 'file' | 'junction'): void => {
    calls.push({ target, path, type })
    // No Developer Mode / admin: file (and dir) symlinks need a privilege.
    if (type !== 'junction') throw errno('EPERM')
    symlinkSync(target, path)
  }

  it('merge copy + stashTree: dir links → junctions; an uncreatable file symlink is a conflict, not a thrown EPERM', () =>
    withHome((home) => {
      write(join(home, 'rox', 'workspaces', 'v', 'notes.md'), 'visible ws')
      write(join(home, 'rox', 'skills', 'taken'), 'a file in ~/rox')
      write(join(home, '.rox', 'skilldata', 'tool', 'SKILL.md'), 'skill')
      write(join(home, '.rox', 'readme.md'), 'readme')
      mkdirSync(join(home, '.rox', 'skills'), { recursive: true })
      mkdirSync(join(home, '.rox', 'docs'), { recursive: true })
      symlinkSync('../skilldata/tool', join(home, '.rox', 'skills', 'linked'))
      symlinkSync('../skilldata', join(home, '.rox', 'skills', 'taken'))
      symlinkSync('../readme.md', join(home, '.rox', 'docs', 'readme-link'))
      const calls: Call[] = []
      const result = migrateHiddenRoxHome(
        opts(home, { platform: 'win32', symlink: winSymlink(calls), linkDir: (target, path) => symlinkSync(target, path) }),
      )
      expect(result.outcome).toBe('merged')
      // Merge copy: a junction with an absolute target at the new place.
      expect(calls).toContainEqual({ target: join(home, 'rox', 'skilldata', 'tool'), path: join(home, 'rox', 'skills', 'linked'), type: 'junction' })
      expect(lstatSync(join(home, 'rox', 'skills', 'linked')).isSymbolicLink()).toBe(true)
      expect(readFileSync(join(home, 'rox', 'skills', 'linked', 'SKILL.md'), 'utf8')).toBe('skill')
      // stashTree: ~/rox has a file there; the legacy dir link is kept as a junction.
      const stashed = join(home, 'rox', '.migration', 'conflicts', 'ts0', 'skills', 'taken')
      // Review 9: a relative target inside the tree is aimed at its final place in ~/rox.
      expect(calls).toContainEqual({ target: join(home, 'rox', 'skilldata'), path: stashed, type: 'junction' })
      expect(readFileSync(join(home, 'rox', 'skills', 'taken'), 'utf8')).toBe('a file in ~/rox')
      // The file symlink: EPERM → kept as a placeholder conflict.
      expect(existsSync(join(home, 'rox', 'docs', 'readme-link'))).toBe(false)
      expect(readFileSync(join(home, 'rox', '.migration', 'conflicts', 'ts0', 'docs', 'readme-link.rox-symlink'), 'utf8')).toBe('../readme.md\n')
      expect(result.conflicts).toEqual(['ts0/docs/readme-link.rox-symlink', 'ts0/skills/taken'])
      expect(result.diagnostics).toContain('storage.migration.conflictsKept')
      expect(readFileSync(join(home, 'rox', 'readme.md'), 'utf8')).toBe('readme')
    }))

  it('review 9: a dangling directory link becomes a junction to its absolute target, no conflict', () =>
    withHome((home) => {
      write(join(home, 'rox', 'workspaces', 'v', 'notes.md'), 'visible ws')
      mkdirSync(join(home, '.rox', 'skills'), { recursive: true })
      symlinkSync('../packs/gone', join(home, '.rox', 'skills', 'dangling'))
      // A link outside the tree keeps the place it resolved to.
      symlinkSync('../../elsewhere/gone', join(home, '.rox', 'skills', 'outside'))
      // A loop is not "dangling": with EPERM it stays a placeholder conflict.
      symlinkSync('loop', join(home, '.rox', 'skills', 'loop'))
      const calls: Call[] = []
      const result = migrateHiddenRoxHome(
        opts(home, { platform: 'win32', symlink: winSymlink(calls), linkDir: (target, path) => symlinkSync(target, path) }),
      )
      expect(result.outcome).toBe('merged')
      expect(calls).toContainEqual({ target: join(home, 'rox', 'packs', 'gone'), path: join(home, 'rox', 'skills', 'dangling'), type: 'junction' })
      expect(readlinkSync(join(home, 'rox', 'skills', 'dangling'))).toBe(join(home, 'rox', 'packs', 'gone'))
      expect(calls).toContainEqual({ target: join(home, 'elsewhere', 'gone'), path: join(home, 'rox', 'skills', 'outside'), type: 'junction' })
      expect(result.conflicts).toEqual(['ts0/skills/loop.rox-symlink'])
    }))

  it('review 9: a dangling directory link of a data-less ~/rox (move-aside) is a junction into ~/rox and no conflict', () =>
    withHome((home) => {
      write(join(home, '.rox', 'config.json'), '{"workspaces":[{"id":"h"}]}')
      write(join(home, 'rox', 'workbench-flags.json'), JSON.stringify({ enabled: ['storage.visible-root.v1'] }))
      mkdirSync(join(home, 'rox', 'skills'), { recursive: true })
      symlinkSync('../packs/gone', join(home, 'rox', 'skills', 'dangling'))
      const calls: Call[] = []
      const result = migrateHiddenRoxHome(
        opts(home, { platform: 'win32', symlink: winSymlink(calls), linkDir: (target, path) => symlinkSync(target, path) }),
      )
      expect(result.outcome).toBe('merged')
      expect(calls).toContainEqual({ target: join(home, 'rox', 'packs', 'gone'), path: join(home, '.rox', 'skills', 'dangling'), type: 'junction' })
      expect(readlinkSync(join(home, 'rox', 'skills', 'dangling'))).toBe(join(home, 'rox', 'packs', 'gone'))
      expect(result.conflicts).toEqual([])
    }))

  it('non-Windows: links keep the default type (no junction)', () =>
    withHome((home) => {
      write(join(home, 'rox', 'workspaces', 'v', 'notes.md'), 'visible ws')
      write(join(home, '.rox', 'skilldata', 'tool', 'SKILL.md'), 'skill')
      mkdirSync(join(home, '.rox', 'skills'), { recursive: true })
      symlinkSync('../skilldata/tool', join(home, '.rox', 'skills', 'linked'))
      const calls: Call[] = []
      const result = migrateHiddenRoxHome(
        opts(home, { platform: 'linux', symlink: (target, path, type) => { calls.push({ target, path, type }); symlinkSync(target, path) } }),
      )
      expect(result.outcome).toBe('merged')
      expect(calls).toEqual([{ target: '../skilldata/tool', path: join(home, 'rox', 'skills', 'linked'), type: undefined }])
      expect(readlinkSync(join(home, 'rox', 'skills', 'linked'))).toBe('../skilldata/tool')
    }))

  it('_importMissingEntries (data-less ~/rox moved aside): dir link → junction, an uncreatable file symlink does not throw and stays a conflict', () =>
    withHome((home) => {
      write(join(home, '.rox', 'config.json'), '{"workspaces":[{"id":"h"}]}')
      write(join(home, 'rox', 'workbench-flags.json'), JSON.stringify({ enabled: ['storage.visible-root.v1'] }))
      write(join(home, 'rox', 'themes', 'base', 'theme.json'), 'theme')
      write(join(home, 'rox', 'notes.txt'), 'notes')
      symlinkSync('base', join(home, 'rox', 'themes', 'current'))
      symlinkSync('notes.txt', join(home, 'rox', 'notes-link'))
      const calls: Call[] = []
      const result = migrateHiddenRoxHome(
        opts(home, { platform: 'win32', symlink: winSymlink(calls), linkDir: (target, path) => symlinkSync(target, path) }),
      )
      expect(result.outcome).toBe('merged')
      // Review 9: aimed at the final home (~/rox), not at the compat path.
      expect(calls).toContainEqual({ target: join(home, 'rox', 'themes', 'base'), path: join(home, '.rox', 'themes', 'current'), type: 'junction' })
      expect(readFileSync(join(home, 'rox', 'themes', 'current', 'theme.json'), 'utf8')).toBe('theme')
      expect(readFileSync(join(home, 'rox', 'notes.txt'), 'utf8')).toBe('notes')
      expect(existsSync(join(home, 'rox', 'notes-link'))).toBe(false)
      expect(result.conflicts).toEqual(['ts0/notes-link'])
    }))
})

describe('move-aside: no spurious conflicts from the root files of a data-less ~/rox (info 4)', () => {
  const homeConfig = {
    workspaces: [{ id: 'h', name: 'Home' }],
    activeWorkspaceId: 'h',
    activeSessionId: 's1',
    colorTheme: 'nordfox-opaque',
  }

  const plantDataLess = (home: string): void => {
    write(join(home, '.rox', 'config.json'), JSON.stringify(homeConfig))
    write(join(home, '.rox', 'workspaces', 'h', 'notes.md'), 'mine')
    write(join(home, '.rox', 'workbench-flags.json'), JSON.stringify({ enabled: ['other.flag'] }))
    write(join(home, 'rox', 'workbench-flags.json'), JSON.stringify({ enabled: ['storage.visible-root.v1'] }))
    write(
      join(home, 'rox', 'config.json'),
      JSON.stringify({ workspaces: [], activeWorkspaceId: null, activeSessionId: null, colorTheme: 'nordfox-opaque' }),
    )
  }

  it('reviewer repro: the final rename deferred once, the next launch → migrated, conflicts []', () =>
    withHome((home) => {
      plantDataLess(home)
      const first = migrateHiddenRoxHome(
        opts(home, {
          rename: (source, destination) => {
            if (source === join(home, '.rox') && destination === join(home, 'rox')) throw errno('EBUSY')
            renameSync(source, destination)
          },
        }),
      )
      expect(first.outcome).toBe('deferred-unmovable')
      const result = migrateHiddenRoxHome(opts(home, { timestamp: 't1' }))
      expect(result.outcome).toBe('migrated')
      expect(result.conflicts).toEqual([])
      expect(result.diagnostics).not.toContain('storage.migration.conflictsKept')
      expect(conflictTree(home)).toEqual([])
    }))

  it('workbench-flags.json (flag subset) + a config.json without workspaces → no conflicts in one go', () =>
    withHome((home) => {
      plantDataLess(home)
      const result = migrateHiddenRoxHome(opts(home))
      expect(result.outcome).toBe('merged')
      expect(result.conflicts).toEqual([])
      expect(result.diagnostics).not.toContain('storage.migration.conflictsKept')
      expect(conflictTree(home)).toEqual([])
      expect(JSON.parse(readFileSync(join(home, 'rox', 'config.json'), 'utf8'))).toEqual(homeConfig)
      expect((JSON.parse(readFileSync(join(home, 'rox', 'workbench-flags.json'), 'utf8')) as { enabled: string[] }).enabled.sort()).toEqual([
        'other.flag',
        'storage.visible-root.v1',
      ])
    }))

  it('root files that carry something the home lacks stay conflicts', () =>
    withHome((home) => {
      write(join(home, '.rox', 'config.json'), JSON.stringify(homeConfig))
      write(join(home, '.rox', 'workspaces', 'h', 'notes.md'), 'mine')
      // Not data (no workspaces), but a different theme than the home's.
      write(join(home, 'rox', 'config.json'), JSON.stringify({ workspaces: [], colorTheme: 'solarized' }))
      // A flag the home does not have.
      write(join(home, '.rox', 'workbench-flags.json'), JSON.stringify({ enabled: ['other.flag'] }))
      write(join(home, 'rox', 'workbench-flags.json'), JSON.stringify({ enabled: ['storage.visible-root.v1', 'rox.only.flag'] }))
      const result = migrateHiddenRoxHome(opts(home))
      expect(result.outcome).toBe('merged')
      expect(result.conflicts).toEqual(['ts0/config.json', 'ts0/workbench-flags.json'])
    }))
})

describe('pre-check deferral while ~/rox is authoritative says so (info 3)', () => {
  it('uses:visible when ~/rox holds data; absent for a data-less ~/rox', () =>
    withHome((home) => {
      write(join(home, 'rox', 'workspaces', 'v', 'notes.md'), 'visible ws')
      write(join(home, '.rox', 'workspaces', 'a', 's.json'), '{"s":1}')
      chmodSync(home, 0o500)
      let visible
      try {
        visible = migrateHiddenRoxHome(opts(home))
      } finally {
        chmodSync(home, 0o700)
      }
      expect(visible.outcome).toBe('deferred-unmovable')
      expect(visible.diagnostics).toEqual(['storage.migration.legacyNotRenamable', 'rename:parent-not-writable', 'uses:visible'])

      rmSync(join(home, 'rox', 'workspaces'), { recursive: true })
      write(join(home, '.rox', 'config.json'), '{"workspaces":[{"id":"h"}]}')
      chmodSync(home, 0o500)
      let hidden
      try {
        hidden = migrateHiddenRoxHome(opts(home))
      } finally {
        chmodSync(home, 0o700)
      }
      expect(hidden.outcome).toBe('deferred-unmovable')
      expect(hidden.diagnostics).toEqual(['storage.migration.legacyNotRenamable', 'rename:parent-not-writable'])
    }))
})

describe('the sidecar is flushed per completed directory (info 5)', () => {
  it('records of a completed directory are on disk before the next directory is copied', () =>
    withHome((home) => {
      write(join(home, 'rox', 'workspaces', 'v', 'notes.md'), 'visible ws')
      write(join(home, '.rox', 'd1', 'f1.json'), '1')
      write(join(home, '.rox', 'd2', 'f2.json'), '2')
      const order: string[] = []
      const snapshots: string[][] = []
      const copyFile = (source: string, destination: string): void => {
        order.push(source.slice(join(home, '.rox').length + 1))
        snapshots.push(sidecarPaths(home))
        copyFileSync(source, destination)
      }
      const result = migrateHiddenRoxHome(opts(home, { copyFile }))
      expect(result.outcome).toBe('merged')
      expect(order.length).toBe(2)
      // The first directory completed before the second was walked: its records are flushed.
      expect(snapshots[1]).toContain(order[0])
      expect(snapshots[1]).toContain(order[0]!.split('/')[0])
    }))
})
