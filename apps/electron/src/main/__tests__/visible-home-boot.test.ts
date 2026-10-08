import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resetConfigDirCachesForTests } from '../../../../../packages/shared/src/config/env.ts'
import { ROX_DESKTOP_APP_LOCK_NAME, desktopAppRuntimeLockPath } from '../../../../../packages/shared/src/identity/config-migration.ts'
import { migrationNoticeFromBoot, registerStorageMigrationNoticeIpc, runVisibleHomeBoot } from '../visible-home-boot'
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
    expect(existsSync(desktopAppRuntimeLockPath(configDir))).toBe(true)
    boot.release()
    expect(existsSync(join(home, 'rox', ROX_DESKTOP_APP_LOCK_NAME))).toBe(false)
    expect(existsSync(desktopAppRuntimeLockPath(configDir))).toBe(false)
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
    expect(existsSync(desktopAppRuntimeLockPath(configDir))).toBe(true)
    boot.release()
    expect(existsSync(desktopAppRuntimeLockPath(configDir))).toBe(false)
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
    expect(boot.notice?.conflicts).toContain('config.json')
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
