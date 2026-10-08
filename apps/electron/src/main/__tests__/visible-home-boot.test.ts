import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resetConfigDirCachesForTests } from '../../../../../packages/shared/src/config/env.ts'
import { ROX_DESKTOP_APP_LOCK_NAME, desktopAppRuntimeLockPaths } from '../../../../../packages/shared/src/identity/config-migration.ts'
import { migrationNoticeFromBoot, needsRelaunchOntoVisibleHome, registerStorageMigrationNoticeIpc, runVisibleHomeBoot } from '../visible-home-boot'
import { STORAGE_MIGRATION_NOTICE_CHANNELS } from '../../shared/storage-visible-root'

// Temp HOME only — never the real dot-configs.
let home: string
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'rox-visible-home-boot-'))
  resetConfigDirCachesForTests()
})
afterEach(() => {
  rmSync(home, { recursive: true, force: true })
  resetConfigDirCachesForTests()
})

const ON = { ROX_STORAGE_VISIBLE_ROOT: '1' }
const plantLegacy = () => {
  mkdirSync(join(home, '.rox', 'workspaces', 'a'), { recursive: true })
  writeFileSync(join(home, '.rox', 'config.json'), JSON.stringify({ workspaces: [{ id: 'a' }] }))
}

describe('W1-13 desktop boot: migration only in the primary instance', () => {
  it('primary + flag ON migrates once, holds the app lock in the config dir, notice = migrated', () => {
    plantLegacy()
    const configDir = join(home, '.rox') // resolved before the lock (read-only)
    const boot = runVisibleHomeBoot({ primary: true, configDir, env: ON, homeDir: home })
    expect(boot.notice).toEqual({ kind: 'migrated', conflicts: [] })
    expect(lstatSync(join(home, '.rox')).isSymbolicLink()).toBe(true)
    // the lock was written after the move, through the compat link
    expect(existsSync(join(home, 'rox', ROX_DESKTOP_APP_LOCK_NAME))).toBe(true)
    expect(desktopAppRuntimeLockPaths(configDir).every((p) => existsSync(p))).toBe(true)
    boot.release()
    expect(existsSync(join(home, 'rox', ROX_DESKTOP_APP_LOCK_NAME))).toBe(false)
    expect(desktopAppRuntimeLockPaths(configDir).some((p) => existsSync(p))).toBe(false)
  })

  it('a non-primary instance (numbered / headless) never migrates', () => {
    plantLegacy()
    const boot = runVisibleHomeBoot({ primary: false, configDir: join(home, '.rox'), env: ON, homeDir: home })
    expect(boot.notice).toBeNull()
    expect(lstatSync(join(home, '.rox')).isDirectory()).toBe(true)
    expect(existsSync(join(home, 'rox'))).toBe(false)
    boot.release()
  })

  it('flag OFF: no ~/rox, nothing added to the config dir (runtime lock only)', () => {
    plantLegacy()
    const configDir = join(home, '.rox')
    const before = readdirSync(configDir).sort()
    const boot = runVisibleHomeBoot({ primary: true, configDir, env: {}, homeDir: home })
    expect(boot.notice).toBeNull()
    expect(existsSync(join(home, 'rox'))).toBe(false)
    expect(readdirSync(configDir).sort()).toEqual(before)
    expect(desktopAppRuntimeLockPaths(configDir).every((p) => existsSync(p))).toBe(true)
    boot.release()
    expect(desktopAppRuntimeLockPaths(configDir).some((p) => existsSync(p))).toBe(false)
  })

  it('foreign ~/rox: deferred-foreign notice, nothing moved', () => {
    plantLegacy()
    mkdirSync(join(home, 'rox', 'src'), { recursive: true })
    writeFileSync(join(home, 'rox', 'README.md'), '# project')
    const boot = runVisibleHomeBoot({ primary: true, configDir: join(home, '.rox'), env: ON, homeDir: home })
    expect(boot.notice).toEqual({ kind: 'deferred-foreign', conflicts: [] })
    expect(lstatSync(join(home, '.rox')).isDirectory()).toBe(true)
    expect(existsSync(join(home, 'rox', 'config.json'))).toBe(false)
    boot.release()
  })

  it('merge: notice lists the conflicts', () => {
    plantLegacy()
    mkdirSync(join(home, 'rox', 'workspaces', 'b'), { recursive: true })
    writeFileSync(join(home, 'rox', 'config.json'), JSON.stringify({ workspaces: [{ id: 'b' }] }))
    const old = new Date(Date.now() - 86_400_000)
    utimesSync(join(home, 'rox', 'config.json'), old, old)
    const boot = runVisibleHomeBoot({ primary: true, configDir: join(home, '.rox'), env: ON, homeDir: home })
    expect(boot.notice?.kind).toBe('merged')
    // per-attempt stash dir: <timestamp>/config.json
    expect(boot.notice?.conflicts.some((c) => /^[^/]+\/config\.json$/.test(c))).toBe(true)
    boot.release()
  })

  it('maps only real (non-dry-run) moves and foreign deferrals to a notice', () => {
    expect(migrationNoticeFromBoot(undefined)).toBeNull()
    expect(migrationNoticeFromBoot({ error: 'boom' })).toBeNull()
    const base = { visibleDir: '', hiddenDir: '', dryRun: false, manifest: [], conflicts: [], diagnostics: [], announceToast: false }
    expect(migrationNoticeFromBoot({ result: { ...base, outcome: 'deferred-locked' } })).toBeNull()
    expect(migrationNoticeFromBoot({ result: { ...base, outcome: 'already-symlinked' } })).toBeNull()
    expect(migrationNoticeFromBoot({ result: { ...base, outcome: 'migrated', dryRun: true } })).toBeNull()
  })
})

describe('W1-13 review 3: compat link missing after the move', () => {
  const moved = (relaunchRequired: boolean) => ({
    result: {
      outcome: 'migrated' as const, visibleDir: join(home, 'rox'), hiddenDir: join(home, '.rox'), dryRun: false,
      manifest: [], conflicts: [], diagnostics: ['storage.migration.compatLinkMissing'], announceToast: true, relaunchRequired,
    },
  })

  it('relaunches (and holds no lock) when this process runs on the legacy path', () => {
    mkdirSync(join(home, 'rox'))
    let relaunched = 0
    let locked = 0
    const boot = runVisibleHomeBoot({
      primary: true, configDir: join(home, '.rox'), env: ON, homeDir: home,
      migrate: () => moved(true),
      holdLock: () => { locked++; return () => {} },
      relaunch: () => { relaunched++ },
    })
    expect(relaunched).toBe(1)
    expect(locked).toBe(0)
    expect(boot.relaunching).toBe(true)
    // a recreated legacy dir is not ~/rox either
    mkdirSync(join(home, '.rox'))
    expect(needsRelaunchOntoVisibleHome(moved(true), join(home, '.rox'))).toBe(true)
  })

  it('no relaunch when already on ~/rox or when the link exists', () => {
    mkdirSync(join(home, 'rox'))
    expect(needsRelaunchOntoVisibleHome(moved(true), join(home, 'rox'))).toBe(false)
    expect(needsRelaunchOntoVisibleHome(moved(false), join(home, '.rox'))).toBe(false)
    expect(needsRelaunchOntoVisibleHome(undefined, join(home, '.rox'))).toBe(false)
  })
})

describe('W1-13 migration notice IPC', () => {
  it('is handed out once, to managed windows only', () => {
    const registered = new Map<string, (event: { sender: { id: number } }) => unknown>()
    registerStorageMigrationNoticeIpc({
      ipcMain: { handle: (channel, listener) => { registered.set(channel, listener) } },
      isTrustedSender: (event) => event.sender.id === 1,
      notice: { kind: 'merged', conflicts: ['config.json'] },
    })
    const take = registered.get(STORAGE_MIGRATION_NOTICE_CHANNELS.TAKE)!
    expect(() => take({ sender: { id: 2 } })).toThrow('STORAGE_MIGRATION_NOTICE_DENIED')
    expect(take({ sender: { id: 1 } })).toEqual({ kind: 'merged', conflicts: ['config.json'] })
    expect(take({ sender: { id: 1 } })).toBeNull()
  })
})
