/**
 * W1-13 (#1510) review-4 regressions: atomic merge copies (crash mid-copy),
 * links on the `~/rox` side, conflicting legacy links, and a legacy dir that
 * cannot be renamed away (no repeated copy per launch). Locks (finding 6)
 * are in visible-home-locks.test.ts; the remote race (finding 4) in
 * apps/electron rox-path-migration.test.ts.
 *
 * SAFETY: temp HOME (`mkdtemp`) + explicit `homeDir`/`env` only.
 */
import { beforeEach, describe, expect, it } from 'bun:test'
import {
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
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import {
  migrateHiddenRoxHome,
  mergeIncompleteMarkerPath,
  ROX_HOME_MIGRATION_MANIFEST_NAME,
  type MigrateHiddenRoxHomeOptions,
} from '../config-migration.ts'
import { resetConfigDirCachesForTests } from '../../config/env.ts'

beforeEach(() => resetConfigDirCachesForTests())

function withHome(run: (home: string) => void): void {
  const home = mkdtempSync(join(tmpdir(), 'rox-visible-home-r4-'))
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
  timestamp: 'ts-r4',
  skipProcessLock: true,
  desktopRuntimeLockPath: (dir) => join(home, `runtime-${dir.endsWith('.rox') ? 'hidden' : 'visible'}.lock`),
  ...(extra ?? {}),
})
const write = (path: string, content: string, mtime?: Date): void => {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
  if (mtime) utimesSync(path, mtime, mtime)
}
const errno = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code })
/** Both trees hold user data: the newer mtime decides (no side preferred). */
const plantBoth = (home: string): void => {
  write(join(home, '.rox', 'config.json'), '{"workspaces":[{"id":"real"}]}')
  write(join(home, '.rox', 'workspaces', 'real', 'notes.md'), 'mine')
  write(join(home, 'rox', 'workspaces', 'v', 'notes.md'), 'visible')
}
const conflictFiles = (home: string): string[] => {
  const root = join(home, 'rox', '.migration', 'conflicts')
  return existsSync(root) ? (readdirSync(root, { recursive: true }) as string[]).sort() : []
}

describe('merge copies are atomic (finding 1)', () => {
  const INTACT = 'H'.repeat(2100)
  const OLD = 'V-old'
  /** Writes 100 bytes to the copy destination, then dies (crash mid-copy). */
  const crashingCopy = (name: string) => (source: string, destination: string): void => {
    if (source.endsWith(join('.rox', name))) {
      writeFileSync(destination, readFileSync(source).subarray(0, 100))
      throw errno('EIO')
    }
    copyFileSync(source, destination)
  }

  it('hidden-wins path: a crash mid-copy leaves the old target; the retry installs the intact file', () =>
    withHome((home) => {
      plantBoth(home)
      write(join(home, '.rox', 'big.json'), INTACT, new Date('2025-01-01'))
      write(join(home, 'rox', 'big.json'), OLD, new Date('2020-01-01'))
      expect(() => migrateHiddenRoxHome(opts(home, { timestamp: 'ts-a', copyFile: crashingCopy('big.json') }))).toThrow('EIO')
      // The target was never truncated (the old code left 100 bytes with a fresh mtime that won the retry).
      expect(readFileSync(join(home, 'rox', 'big.json'), 'utf8')).toBe(OLD)
      // A killed process would also leave its temp behind.
      writeFileSync(join(home, 'rox', '.big.json.rox-copy.tmp'), INTACT.slice(0, 100))

      const result = migrateHiddenRoxHome(opts(home, { timestamp: 'ts-b' }))
      expect(result.outcome).toBe('merged')
      expect(readFileSync(join(home, 'rox', 'big.json'), 'utf8')).toBe(INTACT)
      expect(existsSync(join(home, 'rox', '.big.json.rox-copy.tmp'))).toBe(false)
      // Only the old visible version is stashed; never a truncated copy.
      for (const rel of conflictFiles(home)) {
        const full = join(home, 'rox', '.migration', 'conflicts', rel)
        if (lstatSync(full).isFile()) expect(readFileSync(full, 'utf8')).not.toBe(INTACT.slice(0, 100))
      }
      expect(conflictFiles(home)).toContain(join('ts-b', 'big.json'))
    }))

  it('new-file path: a crash mid-copy leaves no target; the retry copies it whole', () =>
    withHome((home) => {
      plantBoth(home)
      write(join(home, '.rox', 'new.json'), INTACT)
      expect(() => migrateHiddenRoxHome(opts(home, { timestamp: 'ts-a', copyFile: crashingCopy('new.json') }))).toThrow('EIO')
      expect(existsSync(join(home, 'rox', 'new.json'))).toBe(false)
      expect(readdirSync(join(home, 'rox')).filter((n) => n.endsWith('.rox-copy.tmp'))).toEqual([])

      const result = migrateHiddenRoxHome(opts(home, { timestamp: 'ts-b' }))
      expect(result.outcome).toBe('merged')
      expect(readFileSync(join(home, 'rox', 'new.json'), 'utf8')).toBe(INTACT)
      expect(result.conflicts).toEqual([])
    }))
})

describe('links on the ~/rox side are never written through (finding 2)', () => {
  it('a dotfiles link keeps its target; the legacy file is stashed and reported', () =>
    withHome((home) => {
      plantBoth(home)
      // Older than the legacy file: the old code copied the legacy file through the link.
      write(join(home, 'dotfiles', 'rox-config.json'), 'DOT', new Date('2020-01-01'))
      symlinkSync(join(home, 'dotfiles', 'rox-config.json'), join(home, 'rox', 'config.json'))
      const result = migrateHiddenRoxHome(opts(home))
      expect(result.outcome).toBe('merged')
      expect(lstatSync(join(home, 'rox', 'config.json')).isSymbolicLink()).toBe(true)
      expect(readlinkSync(join(home, 'rox', 'config.json'))).toBe(join(home, 'dotfiles', 'rox-config.json'))
      expect(readFileSync(join(home, 'dotfiles', 'rox-config.json'), 'utf8')).toBe('DOT')
      expect(result.conflicts).toContain('ts-r4/config.json')
      expect(readFileSync(join(home, 'rox', '.migration', 'conflicts', 'ts-r4', 'config.json'), 'utf8')).toBe(
        '{"workspaces":[{"id":"real"}]}',
      )
    }))

  it('a dangling link stays dangling: no target is created through it', () =>
    withHome((home) => {
      plantBoth(home)
      write(join(home, '.rox', 'settings.json'), 'legacy-settings')
      mkdirSync(join(home, 'nowhere'))
      symlinkSync(join(home, 'nowhere', 'settings.json'), join(home, 'rox', 'settings.json'))
      const result = migrateHiddenRoxHome(opts(home))
      expect(result.outcome).toBe('merged')
      expect(lstatSync(join(home, 'rox', 'settings.json')).isSymbolicLink()).toBe(true)
      expect(existsSync(join(home, 'nowhere', 'settings.json'))).toBe(false)
      expect(result.conflicts).toContain('ts-r4/settings.json')
      expect(readFileSync(join(home, 'rox', '.migration', 'conflicts', 'ts-r4', 'settings.json'), 'utf8')).toBe(
        'legacy-settings',
      )
    }))

  it('a link to a directory on the ~/rox side keeps the legacy subtree in the stash', () =>
    withHome((home) => {
      plantBoth(home)
      write(join(home, '.rox', 'skills', 'a.md'), 'legacy-skill')
      write(join(home, 'dotfiles', 'skills', 'b.md'), 'dot-skill')
      symlinkSync(join(home, 'dotfiles', 'skills'), join(home, 'rox', 'skills'))
      const result = migrateHiddenRoxHome(opts(home))
      expect(result.outcome).toBe('merged')
      expect(readdirSync(join(home, 'dotfiles', 'skills'))).toEqual(['b.md'])
      expect(result.conflicts).toContain('ts-r4/skills/a.md')
    }))
})

describe('conflicting legacy links are stashed, not dropped (finding 5)', () => {
  it('a legacy link that differs from ~/rox is kept under conflicts and reported', () =>
    withHome((home) => {
      plantBoth(home)
      symlinkSync('target-hidden', join(home, '.rox', 'current'))
      write(join(home, 'rox', 'current'), 'a file in ~/rox')
      symlinkSync('same-target', join(home, '.rox', 'same'))
      symlinkSync('same-target', join(home, 'rox', 'same'))
      const result = migrateHiddenRoxHome(opts(home))
      expect(result.outcome).toBe('merged')
      expect(readFileSync(join(home, 'rox', 'current'), 'utf8')).toBe('a file in ~/rox')
      const stashed = join(home, 'rox', '.migration', 'conflicts', 'ts-r4', 'current')
      expect(lstatSync(stashed).isSymbolicLink()).toBe(true)
      expect(readlinkSync(stashed)).toBe('target-hidden')
      expect(result.conflicts).toEqual(['ts-r4/current'])
      expect(result.diagnostics).toContain('storage.migration.conflictsKept')
    }))
})

describe('a legacy dir that cannot be renamed away defers (finding 3)', () => {
  /** ~/.rox is a mount point: every rename of it fails. */
  const pinnedRename = (home: string) => (source: string, destination: string): void => {
    if (source === join(home, '.rox')) throw errno('EXDEV')
    renameSync(source, destination)
  }
  const countingCopy = () => {
    const calls: string[] = []
    return {
      calls,
      copyFile: (source: string, destination: string): void => {
        calls.push(source)
        copyFileSync(source, destination)
      },
    }
  }

  it('hidden-only: deferred with a diagnostic, nothing copied, on every launch', () =>
    withHome((home) => {
      write(join(home, '.rox', 'config.json'), '{"workspaces":[{"id":"real"}]}')
      write(join(home, '.rox', 'workspaces', 'real', 'notes.md'), 'mine')
      const before = readdirSync(join(home, '.rox')).sort()
      const copy = countingCopy()
      for (const ts of ['launch-1', 'launch-2']) {
        const result = migrateHiddenRoxHome(opts(home, { timestamp: ts, rename: pinnedRename(home), copyFile: copy.copyFile }))
        expect(result.outcome).toBe('deferred-unmovable')
        expect(result.diagnostics).toEqual(['storage.migration.legacyNotRenamable', 'rename:EXDEV'])
      }
      expect(copy.calls).toEqual([])
      expect(existsSync(join(home, 'rox'))).toBe(false)
      expect(readdirSync(home).filter((n) => n !== '.rox')).toEqual([])
      expect(readdirSync(join(home, '.rox')).sort()).toEqual(before)
      expect(existsSync(join(home, '.rox', ROX_HOME_MIGRATION_MANIFEST_NAME))).toBe(false)
    }))

  it('both trees: deferred before any merge, stash or marker', () =>
    withHome((home) => {
      plantBoth(home)
      write(join(home, '.rox', 'big.json'), 'H', new Date('2025-01-01'))
      write(join(home, 'rox', 'big.json'), 'V', new Date('2020-01-01'))
      const copy = countingCopy()
      for (const ts of ['launch-1', 'launch-2']) {
        const result = migrateHiddenRoxHome(opts(home, { timestamp: ts, rename: pinnedRename(home), copyFile: copy.copyFile }))
        expect(result.outcome).toBe('deferred-unmovable')
      }
      expect(copy.calls).toEqual([])
      expect(existsSync(mergeIncompleteMarkerPath(join(home, 'rox')))).toBe(false)
      expect(existsSync(join(home, 'rox', '.migration'))).toBe(false)
      expect(readFileSync(join(home, 'rox', 'big.json'), 'utf8')).toBe('V')
    }))

  it('a renamable legacy dir is unaffected by the merge probe (no leftovers)', () =>
    withHome((home) => {
      plantBoth(home)
      const result = migrateHiddenRoxHome(opts(home))
      expect(result.outcome).toBe('merged')
      expect(readdirSync(home).filter((n) => n.endsWith('-probe'))).toEqual([])
    }))
})
