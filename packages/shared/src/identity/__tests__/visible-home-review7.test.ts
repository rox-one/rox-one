/**
 * W1-13 (#1510) review-7 regressions: the pre-merge resolution stays
 * authoritative (`~/rox` with user data), idempotent retries via the import
 * sidecar, a writer re-check before the final rename, streamed identity
 * checks, the retry rule for thrown errors, compat-link crash recovery, and
 * toggling the flag OFF during an incomplete merge.
 *
 * SAFETY: temp HOME (`mkdtemp`) + explicit `homeDir`/`env` only.
 */
import { beforeEach, describe, expect, it } from 'bun:test'
import {
  closeSync,
  copyFileSync,
  existsSync,
  ftruncateSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import {
  hasIncompleteVisibleHomeMerge,
  mergeIncompleteMarkerPath,
  migrateHiddenRoxHome,
  readMergeIncompleteMarker,
  readStorageMigrationState,
  recordStorageMigrationOutcome,
  resolveVisibleHomeWithoutMigration,
  revertVisibleRoxHome,
  ROX_HOME_MIGRATION_MANIFEST_NAME,
  ROX_MERGE_IMPORTED_SIDECAR_NAME,
  ROX_MERGE_TRANSIENT_RETRIES,
  writePersistedVisibleRootFlag,
  type MigrateHiddenRoxHomeOptions,
} from '../config-migration.ts'
import { resetConfigDirCachesForTests, resolveConfigDir, runVisibleHomeAutoMigration } from '../../config/env.ts'

beforeEach(() => resetConfigDirCachesForTests())

function withHome(run: (home: string) => void): void {
  const home = mkdtempSync(join(tmpdir(), 'rox-visible-home-r7-'))
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
const write = (path: string, content: string, mtime?: Date): void => {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
  if (mtime) utimesSync(path, mtime, mtime)
}
const errno = (code: string): NodeJS.ErrnoException => Object.assign(new Error(`${code}: simulated`), { code })
const T0 = Date.parse('2026-10-08T07:00:00Z')
/** Every rename of the legacy dir to `.rox.migrated-*` fails with `code` while `failing()` is true. */
const finalRename = (code: string, failing: () => boolean) => (source: string, destination: string): void => {
  if (failing() && destination.includes('.rox.migrated-')) throw errno(code)
  renameSync(source, destination)
}
/** Both trees hold user data (each has a workspace). */
const plantBoth = (home: string): void => {
  write(join(home, 'rox', 'workspaces', 'v', 'notes.md'), 'visible ws')
  write(join(home, '.rox', 'workspaces', 'a', 'sessions', 's1.json'), '{"v":1}')
  write(join(home, '.rox', 'workspaces', 'a', 'deleted.json'), 'to be deleted')
  write(join(home, '.rox', 'sources', 'gh.json'), '{"source":"gh"}')
}
const conflictTree = (home: string): string[] => {
  const root = join(home, 'rox', '.migration', 'conflicts')
  return existsSync(root) ? (readdirSync(root, { recursive: true }) as string[]).sort() : []
}

describe('reviewer repro: a retry after a failed final rename (error 1)', () => {
  it('EBUSY → the app edits and deletes in ~/rox → retry: no resurrection, no spurious conflicts, --revert not blocked', () =>
    withHome((home) => {
      plantBoth(home)
      let failing = true
      const first = migrateHiddenRoxHome(opts(home, { rename: finalRename('EBUSY', () => failing), now: () => T0 }))
      expect(first.outcome).toBe('deferred-unmovable')
      expect(first.conflicts).toEqual([])
      expect(existsSync(join(home, 'rox', '.migration', ROX_MERGE_IMPORTED_SIDECAR_NAME))).toBe(true)
      // Every process uses ~/rox now; the app edits and deletes there.
      expect(resolveVisibleHomeWithoutMigration(home)).toBe(join(home, 'rox'))
      write(join(home, 'rox', 'workspaces', 'a', 'sessions', 's1.json'), '{"v":2,"edited":true}')
      unlinkSync(join(home, 'rox', 'workspaces', 'a', 'deleted.json'))
      rmSync(join(home, 'rox', 'sources'), { recursive: true })

      failing = false
      const retry = migrateHiddenRoxHome(opts(home, { timestamp: 'ts1', now: () => T0 + 1 }))
      expect(retry.outcome).toBe('merged')
      expect(retry.conflicts).toEqual([])
      expect(retry.diagnostics).not.toContain('storage.migration.conflictsKept')
      expect(readFileSync(join(home, 'rox', 'workspaces', 'a', 'sessions', 's1.json'), 'utf8')).toBe('{"v":2,"edited":true}')
      expect(existsSync(join(home, 'rox', 'workspaces', 'a', 'deleted.json'))).toBe(false)
      expect(existsSync(join(home, 'rox', 'sources'))).toBe(false)
      expect(conflictTree(home)).toEqual([])
      // The archive keeps every legacy file.
      expect(readFileSync(join(home, '.rox.migrated-ts1', 'workspaces', 'a', 'deleted.json'), 'utf8')).toBe('to be deleted')
      expect(existsSync(join(home, 'rox', '.migration', ROX_MERGE_IMPORTED_SIDECAR_NAME))).toBe(false)
      expect(existsSync(mergeIncompleteMarkerPath(join(home, 'rox')))).toBe(false)
      const reverted = revertVisibleRoxHome(opts(home, { flagActive: false }))
      expect(reverted.outcome).toBe('reverted')
      expect(readFileSync(join(home, '.rox', 'workspaces', 'a', 'sessions', 's1.json'), 'utf8')).toBe('{"v":2,"edited":true}')
    }))

  it('a genuine conflict is stashed once by the first attempt and reported once, at completion', () =>
    withHome((home) => {
      plantBoth(home)
      write(join(home, 'rox', 'config.json'), '{"workspaces":[{"id":"v"}]}')
      write(join(home, '.rox', 'config.json'), '{"workspaces":[{"id":"a"},{"id":"b"}]}')
      let failing = true
      const first = migrateHiddenRoxHome(opts(home, { rename: finalRename('EBUSY', () => failing), now: () => T0 }))
      expect(first.conflicts).toEqual(['ts0/config.json'])
      expect(first.diagnostics).not.toContain('storage.migration.conflictsKept')
      // Still failing: the second attempt re-stashes nothing.
      const second = migrateHiddenRoxHome(opts(home, { timestamp: 'ts1', rename: finalRename('EBUSY', () => failing), now: () => T0 + 1 }))
      expect(second.outcome).toBe('deferred-unmovable')
      expect(second.conflicts).toEqual(['ts0/config.json'])
      expect(existsSync(join(home, 'rox', '.migration', 'conflicts', 'ts1'))).toBe(false)
      failing = false
      const done = migrateHiddenRoxHome(opts(home, { timestamp: 'ts2', now: () => T0 + 2 }))
      expect(done.outcome).toBe('merged')
      expect(done.conflicts).toEqual(['ts0/config.json'])
      expect(done.diagnostics).toContain('storage.migration.conflictsKept')
      expect(conflictTree(home)).toEqual(['ts0', join('ts0', 'config.json')])
      expect(readFileSync(join(home, 'rox', 'config.json'), 'utf8')).toBe('{"workspaces":[{"id":"v"}]}')
    }))
})

describe('both trees with data: ~/rox stays authoritative (warning 2)', () => {
  it('resolution is ~/rox before, during and after a failed rename; the marker says visible', () =>
    withHome((home) => {
      plantBoth(home)
      expect(resolveVisibleHomeWithoutMigration(home)).toBe(join(home, 'rox'))
      const seen: string[] = []
      const result = migrateHiddenRoxHome(
        opts(home, {
          copyFile: (source, destination) => {
            seen.push(resolveVisibleHomeWithoutMigration(home)) // during the import
            copyFileSync(source, destination)
          },
          rename: finalRename('EPERM', () => true),
          now: () => T0,
        }),
      )
      expect(result.outcome).toBe('deferred-unmovable')
      expect(seen.length).toBeGreaterThan(0)
      expect(new Set(seen)).toEqual(new Set([join(home, 'rox')]))
      expect(readMergeIncompleteMarker(join(home, 'rox'))).toMatchObject({ choice: 'visible', lastFailure: { code: 'EPERM', attempts: 1 } })
      expect(resolveVisibleHomeWithoutMigration(home)).toBe(join(home, 'rox'))
      expect(resolveConfigDir({ ROX_STORAGE_VISIBLE_ROOT: '1' }, home)).toBe(join(home, 'rox'))
      expect(lstatSync(join(home, '.rox')).isDirectory()).toBe(true)
    }))

  it('a garbled marker still reads as an incomplete merge into ~/rox', () =>
    withHome((home) => {
      plantBoth(home)
      write(mergeIncompleteMarkerPath(join(home, 'rox')), '{not json')
      expect(readMergeIncompleteMarker(join(home, 'rox'))?.choice).toBe('visible')
      expect(resolveVisibleHomeWithoutMigration(home)).toBe(join(home, 'rox'))
    }))

  it('a data-less ~/rox: nothing is copied into it while ~/.rox is live; a failed rename leaves ~/.rox complete', () =>
    withHome((home) => {
      write(join(home, '.rox', 'config.json'), '{"workspaces":[{"id":"h"}]}')
      write(join(home, '.rox', 'workspaces', 'h', 'notes.md'), 'mine')
      write(join(home, 'rox', 'workbench-flags.json'), JSON.stringify({ enabled: ['storage.visible-root.v1'] }))
      write(join(home, 'rox', 'themes', 'mine.json'), 'theme')
      const copiedInto: string[] = []
      const result = migrateHiddenRoxHome(
        opts(home, {
          copyFile: (source, destination) => {
            copiedInto.push(destination)
            copyFileSync(source, destination)
          },
          rename: (source, destination) => {
            if (source === join(home, '.rox') && destination === join(home, 'rox')) throw errno('EBUSY')
            renameSync(source, destination)
          },
        }),
      )
      expect(result.outcome).toBe('deferred-unmovable')
      expect(copiedInto.every((path) => path.startsWith(join(home, '.rox') + '/'))).toBe(true)
      // ~/rox moved aside into the live tree; its missing files were copied there first.
      expect(existsSync(join(home, 'rox'))).toBe(false)
      expect(readFileSync(join(home, '.rox', 'themes', 'mine.json'), 'utf8')).toBe('theme')
      expect(resolveVisibleHomeWithoutMigration(home)).toBe(join(home, '.rox'))
      // The flag that requested the move still reads ON.
      expect(resolveConfigDir({}, home)).toBe(join(home, '.rox'))
      resetConfigDirCachesForTests()
      expect(runVisibleHomeAutoMigration({ env: {}, homeDir: home })?.result?.outcome).toBe('migrated')
      expect(lstatSync(join(home, '.rox')).isSymbolicLink()).toBe(true)
      expect(readFileSync(join(home, 'rox', 'workspaces', 'h', 'notes.md'), 'utf8')).toBe('mine')
      expect(readFileSync(join(home, 'rox', 'themes', 'mine.json'), 'utf8')).toBe('theme')
      expect(existsSync(join(home, 'rox', '.migration', 'visible-before-ts0'))).toBe(false)
      expect(conflictTree(home)).toEqual([])
    }))
})

describe('a writer that appears during the import defers the final rename (warning 3)', () => {
  it('deferred-locked without a recorded failure; the next launch resumes without copying again', () =>
    withHome((home) => {
      plantBoth(home)
      const lock = join(home, '.rox', 'config.json.lock')
      const copies: string[] = []
      const copyFile = (source: string, destination: string): void => {
        copies.push(source)
        // A CLI started on the legacy path mid-import.
        if (!existsSync(lock)) writeFileSync(lock, JSON.stringify({ pid: process.ppid, startedAt: Date.now() }))
        copyFileSync(source, destination)
      }
      const result = migrateHiddenRoxHome(opts(home, { copyFile, now: () => T0 }))
      expect(result.outcome).toBe('deferred-locked')
      expect(result.diagnostics).toEqual(['storage.migration.deferredLocked', 'locked:config.json.lock'])
      expect(lstatSync(join(home, '.rox')).isDirectory()).toBe(true)
      expect(readMergeIncompleteMarker(join(home, 'rox'))?.lastFailure).toBeUndefined()
      expect(readdirSync(home).filter((n) => n.startsWith('.rox.migrated-'))).toEqual([])
      const copied = copies.length
      unlinkSync(lock)
      const resumed = migrateHiddenRoxHome(opts(home, { timestamp: 'ts1', copyFile, now: () => T0 + 1 }))
      expect(resumed.outcome).toBe('merged')
      expect(copies.length).toBe(copied) // idempotent: nothing imported twice
      expect(lstatSync(join(home, '.rox')).isSymbolicLink()).toBe(true)
    }))
})

describe('identity checks never read whole files (warning 4)', () => {
  it('same size + mtime is identical without reading: a 3 GiB sparse file in both trees merges', () =>
    withHome((home) => {
      plantBoth(home)
      const size = 3 * 1024 * 1024 * 1024 // above the 2 GiB readFileSync limit
      const mtime = new Date('2026-01-01T00:00:00Z')
      for (const root of ['rox', '.rox']) {
        mkdirSync(join(home, root, 'models'), { recursive: true })
        const fd = openSync(join(home, root, 'models', 'asr.bin'), 'w')
        ftruncateSync(fd, size)
        closeSync(fd)
        utimesSync(join(home, root, 'models', 'asr.bin'), mtime, mtime)
      }
      const result = migrateHiddenRoxHome(opts(home))
      expect(result.outcome).toBe('merged')
      expect(result.conflicts).toEqual([])
      expect(lstatSync(join(home, 'rox', 'models', 'asr.bin')).size).toBe(size)
    }))

  it('same size, different mtime: the bytes are compared (chunked) — equal skips, different stashes', () =>
    withHome((home) => {
      plantBoth(home)
      const big = 'x'.repeat(3 * 1024 * 1024 + 17)
      write(join(home, 'rox', 'same.bin'), big, new Date('2020-01-01'))
      write(join(home, '.rox', 'same.bin'), big, new Date('2025-01-01'))
      write(join(home, 'rox', 'diff.bin'), `${big.slice(0, -1)}a`, new Date('2020-01-01'))
      write(join(home, '.rox', 'diff.bin'), `${big.slice(0, -1)}b`, new Date('2025-01-01'))
      const result = migrateHiddenRoxHome(opts(home))
      expect(result.outcome).toBe('merged')
      expect(result.conflicts).toEqual(['ts0/diff.bin'])
      expect(readFileSync(join(home, 'rox', 'diff.bin'), 'utf8').endsWith('a')).toBe(true)
    }))
})

describe('thrown import errors follow the retry rule (warning 4)', () => {
  it('ENOSPC is recorded as lastFailure and held; an explicit migrate-config retries at once', () =>
    withHome((home) => {
      plantBoth(home)
      let full = true
      const copyFile = (source: string, destination: string): void => {
        if (full && source.endsWith('gh.json')) throw errno('ENOSPC')
        copyFileSync(source, destination)
      }
      expect(() => migrateHiddenRoxHome(opts(home, { copyFile, now: () => T0 }))).toThrow('ENOSPC')
      expect(readMergeIncompleteMarker(join(home, 'rox'))?.lastFailure).toEqual({ code: 'ENOSPC', at: T0, attempts: 1 })
      const held = migrateHiddenRoxHome(opts(home, { timestamp: 'ts1', copyFile, now: () => T0 + 60_000 }))
      expect(held.outcome).toBe('deferred-retry')
      expect(held.diagnostics).toContain('failed:ENOSPC')
      full = false
      const forced = migrateHiddenRoxHome(opts(home, { timestamp: 'ts2', copyFile, retryFailedMerge: true, now: () => T0 + 120_000 }))
      expect(forced.outcome).toBe('merged')
      expect(readFileSync(join(home, 'rox', 'sources', 'gh.json'), 'utf8')).toBe('{"source":"gh"}')
    }))

  it('a transient thrown error (EBUSY) is retried at the next launches, then held for 24 hours', () =>
    withHome((home) => {
      plantBoth(home)
      const copyFile = (source: string, destination: string): void => {
        if (source.endsWith('gh.json')) throw errno('EBUSY')
        copyFileSync(source, destination)
      }
      for (let attempt = 1; attempt <= ROX_MERGE_TRANSIENT_RETRIES; attempt++) {
        expect(() => migrateHiddenRoxHome(opts(home, { timestamp: `l${attempt}`, copyFile, now: () => T0 + attempt }))).toThrow('EBUSY')
        expect(readMergeIncompleteMarker(join(home, 'rox'))?.lastFailure?.attempts).toBe(attempt)
      }
      const held = migrateHiddenRoxHome(opts(home, { timestamp: 'held', copyFile, now: () => T0 + 3_600_000 }))
      expect(held.outcome).toBe('deferred-retry')
      expect(held.diagnostics).toContain(`attempts:${ROX_MERGE_TRANSIENT_RETRIES}`)
    }))
})

describe('crash between the final rename and the compat link (info 7)', () => {
  it('after a merge: the link is recreated and the stale marker and sidecar dropped', () =>
    withHome((home) => {
      plantBoth(home)
      expect(migrateHiddenRoxHome(opts(home)).outcome).toBe('merged')
      // Simulate the crash: no link yet, marker and sidecar still there.
      unlinkSync(join(home, '.rox'))
      write(mergeIncompleteMarkerPath(join(home, 'rox')), JSON.stringify({ startedAt: 1, hiddenHasData: true, visibleHasData: true, choice: 'visible' }))
      write(join(home, 'rox', '.migration', ROX_MERGE_IMPORTED_SIDECAR_NAME), '{"a":"ts0"}\n')
      const result = migrateHiddenRoxHome(opts(home, { timestamp: 'ts1' }))
      expect(result.outcome).toBe('already-visible')
      expect(result.diagnostics).toEqual(['storage.migration.compatLinkRestored'])
      expect(lstatSync(join(home, '.rox')).isSymbolicLink()).toBe(true)
      expect(readFileSync(join(home, '.rox', 'workspaces', 'v', 'notes.md'), 'utf8')).toBe('visible ws')
      expect(existsSync(mergeIncompleteMarkerPath(join(home, 'rox')))).toBe(false)
      expect(existsSync(join(home, 'rox', '.migration', ROX_MERGE_IMPORTED_SIDECAR_NAME))).toBe(false)
    }))

  it('after a hidden-only move: the leftover manifest is the evidence; the link is recreated', () =>
    withHome((home) => {
      write(join(home, '.rox', 'config.json'), '{"workspaces":[{"id":"h"}]}')
      write(join(home, '.rox', ROX_HOME_MIGRATION_MANIFEST_NAME), '[]')
      renameSync(join(home, '.rox'), join(home, 'rox')) // the rename happened, then the crash
      const result = migrateHiddenRoxHome(opts(home))
      expect(result.diagnostics).toEqual(['storage.migration.compatLinkRestored'])
      expect(lstatSync(join(home, '.rox')).isSymbolicLink()).toBe(true)
      expect(existsSync(join(home, 'rox', ROX_HOME_MIGRATION_MANIFEST_NAME))).toBe(false)
    }))

  it('a plain ~/rox without any evidence gets no link; a dry run repairs nothing', () =>
    withHome((home) => {
      write(join(home, 'rox', 'config.json'), '{}')
      expect(migrateHiddenRoxHome(opts(home)).diagnostics).toEqual([])
      expect(existsSync(join(home, '.rox'))).toBe(false)
      mkdirSync(join(home, '.rox.migrated-old'))
      expect(migrateHiddenRoxHome(opts(home, { dryRun: true })).diagnostics).toEqual([])
      expect(existsSync(join(home, '.rox'))).toBe(false)
      expect(migrateHiddenRoxHome(opts(home)).diagnostics).toEqual(['storage.migration.compatLinkRestored'])
      expect(lstatSync(join(home, '.rox')).isSymbolicLink()).toBe(true)
    }))
})

describe('repairs and markers of earlier builds', () => {
  it('a missing compat link is only recreated under the process lock (never racing --revert)', () =>
    withHome((home) => {
      write(join(home, 'rox', 'config.json'), '{}')
      mkdirSync(join(home, '.rox.migrated-old'))
      const lock = join(home, 'proc', 'rox-migrate.lock')
      write(lock, JSON.stringify({ pid: process.ppid, startedAt: Date.now() }))
      const result = migrateHiddenRoxHome(opts(home, { skipProcessLock: false, processLockPath: lock }))
      expect(result.outcome).toBe('deferred-locked')
      expect(existsSync(join(home, '.rox'))).toBe(false)
      unlinkSync(lock)
      expect(migrateHiddenRoxHome(opts(home, { skipProcessLock: false, processLockPath: lock })).diagnostics).toEqual([
        'storage.migration.compatLinkRestored',
      ])
    }))

  it("an earlier build's 'hidden' marker: the stale partial ~/rox is moved aside whole, nothing resurrected", () =>
    withHome((home) => {
      write(join(home, '.rox', 'config.json'), '{"workspaces":[{"id":"h"}]}')
      write(join(home, '.rox', 'workspaces', 'h', 'notes.md'), 'edited later')
      write(join(home, '.rox', 'workspaces', 'h', 'same.md'), 'same')
      // Partial copy of an earlier build (it kept ~/.rox authoritative).
      write(join(home, 'rox', 'config.json'), '{"workspaces":[{"id":"h"}]}')
      write(join(home, 'rox', 'workspaces', 'h', 'notes.md'), 'old')
      write(join(home, 'rox', 'workspaces', 'h', 'same.md'), 'same')
      write(join(home, 'rox', 'workspaces', 'h', 'deleted-since.md'), 'gone from ~/.rox')
      write(mergeIncompleteMarkerPath(join(home, 'rox')), JSON.stringify({ startedAt: 1, hiddenHasData: true, visibleHasData: false, choice: 'hidden' }))
      expect(resolveVisibleHomeWithoutMigration(home)).toBe(join(home, '.rox'))
      const result = migrateHiddenRoxHome(opts(home))
      expect(result.outcome).toBe('merged')
      expect(readFileSync(join(home, 'rox', 'workspaces', 'h', 'notes.md'), 'utf8')).toBe('edited later')
      expect(existsSync(join(home, 'rox', 'workspaces', 'h', 'deleted-since.md'))).toBe(false)
      expect(result.conflicts.sort()).toEqual(['ts0/workspaces/h/deleted-since.md', 'ts0/workspaces/h/notes.md'])
      expect(existsSync(mergeIncompleteMarkerPath(join(home, 'rox')))).toBe(false)
      expect(lstatSync(join(home, '.rox')).isSymbolicLink()).toBe(true)
    }))
})

describe('toggle OFF during an incomplete merge (warning 5)', () => {
  it('~/rox stays the home either way, and the deferral note is kept while the marker exists', () =>
    withHome((home) => {
      plantBoth(home)
      write(join(home, '.rox', 'workbench-flags.json'), JSON.stringify({ enabled: ['storage.visible-root.v1'] }))
      const failed = migrateHiddenRoxHome(opts(home, { rename: finalRename('EBUSY', () => true), now: () => T0 }))
      expect(failed.outcome).toBe('deferred-unmovable')
      recordStorageMigrationOutcome(failed, home)
      expect(readStorageMigrationState(home)?.kind).toBe('deferred-unmovable')
      expect(hasIncompleteVisibleHomeMerge(home)).toBe(true)
      // The flag file was imported into ~/rox (missing there): OFF lands in the file that is read.
      writePersistedVisibleRootFlag(false, home)
      resetConfigDirCachesForTests()
      expect(resolveConfigDir({}, home)).toBe(join(home, 'rox')) // flag OFF: main's order
      expect(runVisibleHomeAutoMigration({ env: {}, homeDir: home })).toBeUndefined()
      expect(readStorageMigrationState(home)?.kind).toBe('deferred-unmovable')
      resetConfigDirCachesForTests()
      expect(resolveConfigDir({ ROX_STORAGE_VISIBLE_ROOT: '1' }, home)).toBe(join(home, 'rox')) // flag ON: the marker
      // Once the merge completes (explicit retry), flag OFF clears the note again.
      expect(migrateHiddenRoxHome(opts(home, { timestamp: 'ts1', retryFailedMerge: true })).outcome).toBe('merged')
      expect(hasIncompleteVisibleHomeMerge(home)).toBe(false)
      runVisibleHomeAutoMigration({ env: {}, homeDir: home })
      expect(readStorageMigrationState(home)).toBeUndefined()
    }))
})

describe('symlink-elsewhere tells Settings which dir Rox uses (info 6)', () => {
  it('uses:visible when ~/rox holds user data, else uses:hidden', () =>
    withHome((home) => {
      mkdirSync(join(home, 'elsewhere'))
      symlinkSync(join(home, 'elsewhere'), join(home, '.rox'))
      expect(migrateHiddenRoxHome(opts(home)).diagnostics).toEqual(['storage.migration.symlinkElsewhere', 'uses:hidden'])
      write(join(home, 'rox', 'workspaces', 'w', 'x.md'), 'x')
      expect(migrateHiddenRoxHome(opts(home)).diagnostics).toEqual(['storage.migration.symlinkElsewhere', 'uses:visible'])
      expect(resolveVisibleHomeWithoutMigration(home)).toBe(join(home, 'rox'))
    }))
})
