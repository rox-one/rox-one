/**
 * W1-13 (#1510) review-6 regressions: no destructive rename probe
 * (non-destructive pre-checks, a failed final rename keeps `~/.rox`
 * authoritative with a bounded retry), Settings state for every outcome,
 * the migration-lock heartbeat, the win32 lock-rename retry, and merge-root
 * bookkeeping.
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
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import {
  _renameWithWin32Retry,
  isLockFileLive,
  migrateHiddenRoxHome,
  readMergeIncompleteMarker,
  readStorageMigrationState,
  recordStorageMigrationFailure,
  recordStorageMigrationOutcome,
  resolveVisibleHomeWithoutMigration,
  ROX_MERGE_RETRY_COOLDOWN_MS,
  ROX_MERGE_TRANSIENT_RETRIES,
  ROX_MIGRATION_LOCK_TTL_MS,
  ROX_STORAGE_MIGRATION_STATE_FILE_NAME,
  type MigrateHiddenRoxHomeOptions,
} from '../config-migration.ts'
import { resetConfigDirCachesForTests, runVisibleHomeAutoMigration } from '../../config/env.ts'

beforeEach(() => resetConfigDirCachesForTests())

function withHome(run: (home: string) => void): void {
  const home = mkdtempSync(join(tmpdir(), 'rox-visible-home-r6-'))
  try {
    run(home)
  } finally {
    spawnSync('chmod', ['-R', 'u+rwx', home])
    rmSync(home, { recursive: true, force: true })
    resetConfigDirCachesForTests()
  }
}

const errno = (code: string): NodeJS.ErrnoException => Object.assign(new Error(`${code}: simulated`), { code })
const write = (path: string, content: string, mtime?: Date): void => {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
  if (mtime) spawnSync('touch', ['-d', mtime.toISOString(), path])
}
/** Both trees hold user data: the import path (`~/rox` authoritative, final rename to `.rox.migrated-<ts>`). */
const plantBoth = (home: string): void => {
  write(join(home, '.rox', 'config.json'), '{"workspaces":[{"id":"real"}]}')
  write(join(home, '.rox', 'workspaces', 'real', 'notes.md'), 'mine')
  write(join(home, 'rox', 'config.json'), '{"workspaces":[{"id":"v"}]}')
}
const opts = (home: string, extra?: Partial<MigrateHiddenRoxHomeOptions>): MigrateHiddenRoxHomeOptions => ({
  homeDir: home,
  env: {},
  timestamp: 'ts-r6',
  isLocked: () => [],
  skipProcessLock: true,
  ...(extra ?? {}),
})
const failFinalRename = (home: string, code: string) => {
  const calls: Array<[string, string]> = []
  return {
    calls,
    rename: (source: string, destination: string): void => {
      calls.push([source, destination])
      if (source === join(home, '.rox')) throw errno(code)
      renameSync(source, destination)
    },
  }
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

describe('no destructive probe: non-destructive pre-checks (option A)', () => {
  it('a merge renames ~/.rox exactly once (the final rename), never to a probe path', () =>
    withHome((home) => {
      plantBoth(home)
      const renames: Array<[string, string]> = []
      const result = migrateHiddenRoxHome(
        opts(home, {
          rename: (s, d) => {
            renames.push([s, d])
            renameSync(s, d)
          },
        }),
      )
      expect(result.outcome).toBe('merged')
      expect(renames.filter(([s]) => s === join(home, '.rox'))).toEqual([[join(home, '.rox'), join(home, '.rox.migrated-ts-r6')]])
      expect(readdirSync(home).filter((n) => n.includes('probe'))).toEqual([])
    }))

  it('an unwritable parent defers before any copy, marker or stash', () => {
    if (process.getuid?.() === 0) return // root bypasses W_OK
    withHome((home) => {
      plantBoth(home)
      const copy = countingCopy()
      chmodSync(home, 0o500)
      let result
      try {
        result = migrateHiddenRoxHome(opts(home, { copyFile: copy.copyFile }))
      } finally {
        chmodSync(home, 0o700)
      }
      expect(result.outcome).toBe('deferred-unmovable')
      expect(result.diagnostics).toEqual(['storage.migration.legacyNotRenamable', 'rename:parent-not-writable'])
      expect(copy.calls).toEqual([])
      expect(existsSync(join(home, 'rox', '.migration'))).toBe(false)
      expect(lstatSync(join(home, '.rox')).isDirectory()).toBe(true)
    })
  })

  it('hidden-only: a file in use (EPERM/EACCES/EBUSY) defers with nothing moved', () =>
    withHome((home) => {
      write(join(home, '.rox', 'config.json'), '{"workspaces":[{"id":"real"}]}')
      for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
        const result = migrateHiddenRoxHome(opts(home, { rename: failFinalRename(home, code).rename }))
        expect(result.outcome).toBe('deferred-unmovable')
        expect(result.diagnostics).toEqual(['storage.migration.legacyNotRenamable', `rename:${code}`])
      }
      expect(existsSync(join(home, 'rox'))).toBe(false)
      expect(readdirSync(join(home, '.rox'))).toEqual(['config.json'])
    }))
})

describe('a failed final rename keeps ~/.rox and retries in bounds', () => {
  const T0 = Date.parse('2026-10-08T07:00:00Z')

  it('transient (EBUSY): retried on the next launches, then held for the cooldown; ~/rox stays authoritative meanwhile', () =>
    withHome((home) => {
      plantBoth(home)
      const copy = countingCopy()
      const fail = failFinalRename(home, 'EBUSY')
      let copies = 0
      for (let attempt = 1; attempt <= ROX_MERGE_TRANSIENT_RETRIES; attempt++) {
        const result = migrateHiddenRoxHome(
          opts(home, { timestamp: `l${attempt}`, rename: fail.rename, copyFile: copy.copyFile, now: () => T0 + attempt }),
        )
        expect(result.outcome).toBe('deferred-unmovable')
        expect(result.diagnostics).toEqual(['storage.migration.mergeRenameFailed', 'rename:EBUSY', `attempts:${attempt}`])
        expect(readMergeIncompleteMarker(join(home, 'rox'))?.lastFailure).toEqual({ code: 'EBUSY', at: T0 + attempt, attempts: attempt })
        expect(resolveVisibleHomeWithoutMigration(home)).toBe(join(home, 'rox'))
        copies = copy.calls.length
      }
      const held = migrateHiddenRoxHome(opts(home, { timestamp: 'held', rename: fail.rename, copyFile: copy.copyFile, now: () => T0 + 3_600_000 }))
      expect(held.outcome).toBe('deferred-retry')
      expect(held.diagnostics).toEqual([
        'storage.migration.mergeRetryLater',
        'failed:EBUSY',
        `retryAfter:${new Date(T0 + ROX_MERGE_TRANSIENT_RETRIES + ROX_MERGE_RETRY_COOLDOWN_MS).toISOString()}`,
        `attempts:${ROX_MERGE_TRANSIENT_RETRIES}`,
      ])
      expect(copy.calls.length).toBe(copies)
      expect(existsSync(join(home, 'rox', '.migration', 'conflicts', 'held'))).toBe(false)
      // After the cooldown the rename succeeds: merged, marker gone.
      const later = migrateHiddenRoxHome(opts(home, { timestamp: 'later', now: () => T0 + ROX_MERGE_RETRY_COOLDOWN_MS + 10 }))
      expect(later.outcome).toBe('merged')
      expect(readMergeIncompleteMarker(join(home, 'rox'))).toBeUndefined()
      expect(lstatSync(join(home, '.rox')).isSymbolicLink()).toBe(true)
      expect(readFileSync(join(home, 'rox', 'workspaces', 'real', 'notes.md'), 'utf8')).toBe('mine')
    }))

  it('non-transient (EXDEV): held after the first failure; an explicit migrate-config retries at once', () =>
    withHome((home) => {
      plantBoth(home)
      const fail = failFinalRename(home, 'EXDEV')
      expect(migrateHiddenRoxHome(opts(home, { rename: fail.rename, now: () => T0 })).outcome).toBe('deferred-unmovable')
      expect(migrateHiddenRoxHome(opts(home, { rename: fail.rename, now: () => T0 + 1 })).outcome).toBe('deferred-retry')
      const forced = migrateHiddenRoxHome(opts(home, { timestamp: 'forced', retryFailedMerge: true, now: () => T0 + 2 }))
      expect(forced.outcome).toBe('merged')
      expect(lstatSync(join(home, '.rox')).isSymbolicLink()).toBe(true)
    }))

  it('the archived legacy dir keeps every file; nothing is lost across the failed attempts', () =>
    withHome((home) => {
      plantBoth(home)
      const fail = failFinalRename(home, 'EXDEV')
      migrateHiddenRoxHome(opts(home, { rename: fail.rename, now: () => T0 }))
      // A writer still on the legacy path (started before the merge) adds a file meanwhile.
      write(join(home, '.rox', 'workspaces', 'real', 'later.md'), 'written after the failure')
      const forced = migrateHiddenRoxHome(opts(home, { timestamp: 'forced', retryFailedMerge: true, now: () => T0 + 5 }))
      expect(forced.outcome).toBe('merged')
      expect(readFileSync(join(home, 'rox', 'workspaces', 'real', 'later.md'), 'utf8')).toBe('written after the failure')
      expect(readFileSync(join(home, '.rox.migrated-forced', 'workspaces', 'real', 'later.md'), 'utf8')).toBe('written after the failure')
    }))
})

describe('merge-root bookkeeping is not carried into ~/rox (finding 8)', () => {
  it('state file, lock files and the manifest stay in the archived legacy dir', () =>
    withHome((home) => {
      plantBoth(home)
      const names = [ROX_STORAGE_MIGRATION_STATE_FILE_NAME, '.app.lock', '.server.lock', 'config.json.lock', '.app.lock.tmp-1-abc', '.migration-manifest.json']
      for (const name of names) write(join(home, '.rox', name), 'bookkeeping')
      write(join(home, '.rox', 'workspaces', 'real', 'session.lock.md'), 'user data')
      expect(migrateHiddenRoxHome(opts(home)).outcome).toBe('merged')
      for (const name of names) {
        expect(existsSync(join(home, 'rox', name))).toBe(false)
        expect(readFileSync(join(home, '.rox.migrated-ts-r6', name), 'utf8')).toBe('bookkeeping')
      }
      expect(readFileSync(join(home, 'rox', 'workspaces', 'real', 'session.lock.md'), 'utf8')).toBe('user data')
    }))
})

describe('migration lock heartbeat (finding 5)', () => {
  it('a long merge touches its lock, and the TTL is judged on that heartbeat', () =>
    withHome((home) => {
      plantBoth(home)
      for (let i = 0; i < 6; i++) write(join(home, '.rox', 'workspaces', 'real', `f${i}.md`), `n${i}`)
      const lock = join(home, 'proc', 'migrate.lock')
      mkdirSync(join(home, 'proc'))
      let clock = Date.now()
      const seen: number[] = []
      const result = migrateHiddenRoxHome(
        opts(home, {
          skipProcessLock: false,
          processLockPath: lock,
          lockHeartbeatEvery: 1,
          now: () => clock,
          copyFile: (s, d) => {
            // Each copy "takes" 20 minutes.
            clock += 20 * 60 * 1000
            seen.push(statSync(lock).mtimeMs)
            copyFileSync(s, d)
          },
        }),
      )
      expect(result.outcome).toBe('merged')
      const startedAt = seen[0]!
      expect(Math.max(...seen)).toBeGreaterThan(startedAt + ROX_MIGRATION_LOCK_TTL_MS)
      expect(existsSync(lock)).toBe(false)
    }))

  it('isLockFileLive: an old startedAt with a fresh mtime is live; both old is stale', () =>
    withHome((home) => {
      const lock = join(home, 'm.lock')
      const startedAt = Date.now() - ROX_MIGRATION_LOCK_TTL_MS - 60_000
      write(lock, JSON.stringify({ pid: process.ppid, startedAt }))
      const liveness = { now: Date.now(), isPidAlive: () => true, pidlessTtlMs: 60_000, ttlMs: ROX_MIGRATION_LOCK_TTL_MS }
      expect(isLockFileLive(lock, liveness)).toBe(true)
      spawnSync('touch', ['-d', new Date(startedAt).toISOString(), lock])
      expect(isLockFileLive(lock, liveness)).toBe(false)
    }))
})

describe('win32 lock rename retry (finding 6)', () => {
  const flaky = (failures: string[]) => {
    let n = 0
    return {
      calls: () => n,
      rename: (): void => {
        const code = failures[n++]
        if (code) throw errno(code)
      },
    }
  }

  it('retries EPERM/EACCES/EBUSY on win32 with a short backoff', () => {
    const r = flaky(['EBUSY', 'EPERM', 'EACCES'])
    const sleeps: number[] = []
    _renameWithWin32Retry('a', 'b', { platform: 'win32', rename: r.rename, sleep: (ms) => sleeps.push(ms) })
    expect(r.calls()).toBe(4)
    expect(sleeps.length).toBe(3)
    expect(sleeps.reduce((a, b) => a + b, 0)).toBeLessThan(1000)
  })

  it('gives up after about a second, and never retries other codes or other platforms', () => {
    const sleeps: number[] = []
    const always = flaky(Array(20).fill('EBUSY'))
    expect(() => _renameWithWin32Retry('a', 'b', { platform: 'win32', rename: always.rename, sleep: (ms) => sleeps.push(ms) })).toThrow('EBUSY')
    expect(sleeps.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(1000)
    const other = flaky(['ENOENT'])
    expect(() => _renameWithWin32Retry('a', 'b', { platform: 'win32', rename: other.rename, sleep: () => {} })).toThrow('ENOENT')
    expect(other.calls()).toBe(1)
    const posix = flaky(['EBUSY'])
    expect(() => _renameWithWin32Retry('a', 'b', { platform: 'linux', rename: posix.rename, sleep: () => {} })).toThrow('EBUSY')
    expect(posix.calls()).toBe(1)
  })
})

describe('Settings state for every non-usable outcome and thrown errors (finding 4)', () => {
  const flagOn = (home: string): void =>
    write(join(home, '.rox', 'workbench-flags.json'), JSON.stringify({ enabled: ['storage.visible-root.v1'] }))

  it('records deferred-foreign, deferred-link, symlink-elsewhere and deferred-retry; anything else clears', () =>
    withHome((home) => {
      flagOn(home)
      for (const outcome of ['deferred-foreign', 'deferred-link', 'symlink-elsewhere', 'deferred-retry'] as const) {
        recordStorageMigrationOutcome({ outcome, diagnostics: [`storage.migration.${outcome}`], dryRun: false }, home)
        expect(readStorageMigrationState(home)?.kind).toBe(outcome)
      }
      recordStorageMigrationOutcome({ outcome: 'skipped-env-override', diagnostics: [], dryRun: false }, home)
      expect(readStorageMigrationState(home)).toBeUndefined()
    }))

  it('a thrown boot migration is recorded as failed (replacing an older note)', () =>
    withHome((home) => {
      flagOn(home)
      write(join(home, '.rox', 'config.json'), '{}')
      recordStorageMigrationOutcome({ outcome: 'deferred-locked', diagnostics: ['storage.migration.deferredLocked'], dryRun: false }, home)
      const boot = runVisibleHomeAutoMigration({
        env: {},
        homeDir: home,
        migrate: () => {
          throw errno('EIO')
        },
      })
      expect(boot?.error).toContain('EIO')
      expect(readStorageMigrationState(home)).toMatchObject({
        kind: 'failed',
        diagnostic: 'storage.migration.failed',
        diagnostics: ['storage.migration.failed', 'error:EIO'],
      })
      recordStorageMigrationFailure(new Error('no code'), home)
      expect(readStorageMigrationState(home)?.diagnostics).toEqual(['storage.migration.failed', 'error:unknown'])
    }))
})
