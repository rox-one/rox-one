import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isVisibleRoxHomeActive, resolveConfigDir, resetConfigDirCachesForTests, runVisibleHomeAutoMigration } from '../../../../../packages/shared/src/config/env.ts'
import { createStorageVisibleRootHandlers, registerStorageVisibleRootIpc } from '../storage-visible-root-ipc'
import { STORAGE_VISIBLE_ROOT_CHANNELS, storageMigrationStatusMessageKey, type StorageMigrationStatus } from '../../shared/storage-visible-root'

// Temp HOME only — never the real dot-configs.
let home: string
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'rox-visible-root-ipc-'))
  resetConfigDirCachesForTests()
})
afterEach(() => {
  rmSync(home, { recursive: true, force: true })
  resetConfigDirCachesForTests()
})

const flagFile = () => join(home, '.rox', 'workbench-flags.json')

describe('W1-13 Settings toggle (storage.visible-root.v1)', () => {
  it('toggle writes workbench-flags.json and asks for a restart', () => {
    mkdirSync(join(home, '.rox'))
    const handlers = createStorageVisibleRootHandlers({ env: {}, homeDir: home, activeAtLaunch: false })
    expect(handlers.get()).toEqual({ enabled: false, activeAtLaunch: false, locked: false, restartRequired: false })
    const next = handlers.set(true)
    expect(next).toEqual({ enabled: true, activeAtLaunch: false, locked: false, restartRequired: true })
    expect(JSON.parse(readFileSync(flagFile(), 'utf8')).enabled).toContain('storage.visible-root.v1')
    expect(existsSync(join(home, 'rox'))).toBe(false) // nothing moves in this process
    expect(handlers.set(false).restartRequired).toBe(false)
  })

  it('keeps other flag ids in the file', () => {
    mkdirSync(join(home, '.rox'))
    writeFileSync(flagFile(), JSON.stringify({ enabled: ['other.flag'] }))
    createStorageVisibleRootHandlers({ env: {}, homeDir: home, activeAtLaunch: false }).set(true)
    expect(JSON.parse(readFileSync(flagFile(), 'utf8')).enabled).toEqual(['other.flag', 'storage.visible-root.v1'])
  })

  it('applies on next launch: resolveConfigDir reads the persisted flag (probe cached per process)', () => {
    mkdirSync(join(home, '.rox'))
    writeFileSync(join(home, '.rox', 'config.json'), JSON.stringify({ workspaces: [{ id: 'w1' }] }))
    expect(isVisibleRoxHomeActive({}, home)).toBe(false)
    createStorageVisibleRootHandlers({ env: {}, homeDir: home, activeAtLaunch: false }).set(true)
    // same process: cached probe, behaviour unchanged
    expect(isVisibleRoxHomeActive({}, home)).toBe(false)
    resetConfigDirCachesForTests() // simulate the next launch
    expect(isVisibleRoxHomeActive({}, home)).toBe(true)
    // Resolution alone never migrates (review 2): the legacy home stays put
    // until Electron main runs the migration after its single-instance lock.
    expect(resolveConfigDir({}, home)).toBe(join(home, '.rox'))
    expect(existsSync(join(home, 'rox'))).toBe(false)
    const boot = runVisibleHomeAutoMigration({ env: {}, homeDir: home })
    expect(boot?.result?.outcome).toBe('migrated')
    expect(lstatSync(join(home, '.rox')).isSymbolicLink()).toBe(true)
    expect(JSON.parse(readFileSync(join(home, 'rox', 'config.json'), 'utf8')).workspaces[0].id).toBe('w1')
    resetConfigDirCachesForTests() // the launch after that resolves ~/rox
    expect(resolveConfigDir({}, home)).toBe(join(home, 'rox'))
  })

  it('a malformed flag file reads as OFF', () => {
    mkdirSync(join(home, '.rox'))
    writeFileSync(flagFile(), '{not json')
    expect(createStorageVisibleRootHandlers({ env: {}, homeDir: home, activeAtLaunch: false }).get().enabled).toBe(false)
    expect(isVisibleRoxHomeActive({}, home)).toBe(false)
    expect(resolveConfigDir({}, home)).toBe(join(home, '.rox'))
    expect(existsSync(join(home, 'rox'))).toBe(false)
  })

  it('is read-only when the environment decides', () => {
    const locked = createStorageVisibleRootHandlers({ env: { ROX_STORAGE_VISIBLE_ROOT: '1' }, homeDir: home })
    expect(locked.get().locked).toBe(true)
    expect(() => locked.set(false)).toThrow('STORAGE_VISIBLE_ROOT_LOCKED')
    const dirOverride = createStorageVisibleRootHandlers({ env: { ROX_CONFIG_DIR: join(home, 'cfg') }, homeDir: home })
    expect(dirOverride.get().locked).toBe(true)
    expect(existsSync(flagFile())).toBe(false)
  })

  it('rejects non-boolean input and untrusted senders', async () => {
    const handlers = createStorageVisibleRootHandlers({ env: {}, homeDir: home, activeAtLaunch: false })
    expect(() => handlers.set('yes')).toThrow('STORAGE_VISIBLE_ROOT_INVALID')
    const registered = new Map<string, (event: { sender: { id: number } }, input?: unknown) => unknown>()
    registerStorageVisibleRootIpc({
      ipcMain: { handle: (channel, listener) => { registered.set(channel, listener) } },
      isTrustedSender: (event) => event.sender.id === 1,
      env: {}, homeDir: home, activeAtLaunch: false,
    })
    expect(() => registered.get(STORAGE_VISIBLE_ROOT_CHANNELS.SET)!({ sender: { id: 2 } }, true)).toThrow('STORAGE_VISIBLE_ROOT_DENIED')
    expect(existsSync(flagFile())).toBe(false)
    const state = registered.get(STORAGE_VISIBLE_ROOT_CHANNELS.SET)!({ sender: { id: 1 } }, true) as { enabled: boolean }
    expect(state.enabled).toBe(true)
  })
})

describe('W1-13 review 5: last migration outcome in Settings (no popup)', () => {
  const stateFile = () => join(home, '.rox', 'storage-migration-state.json')
  const plantState = (kind: string) => {
    mkdirSync(join(home, '.rox'), { recursive: true })
    writeFileSync(stateFile(), JSON.stringify({
      kind, diagnostic: 'storage.migration.legacyNotRenamable', diagnostics: ['storage.migration.legacyNotRenamable'], at: '2026-10-08T07:00:00.000Z',
    }))
  }

  it('get() reports the persisted deferral; turning the flag OFF clears it', () => {
    plantState('deferred-unmovable')
    const handlers = createStorageVisibleRootHandlers({ env: {}, homeDir: home, activeAtLaunch: true })
    handlers.set(true)
    const on = handlers.get()
    expect(on.lastMigration).toEqual({
      kind: 'deferred-unmovable',
      diagnostic: 'storage.migration.legacyNotRenamable',
      diagnostics: ['storage.migration.legacyNotRenamable'],
      at: '2026-10-08T07:00:00.000Z',
    })
    expect(storageMigrationStatusMessageKey(on)).toBe('storage.settings.migrationDeferredUnmovable')
    const off = handlers.set(false)
    expect(off.lastMigration).toBeUndefined()
    expect(existsSync(stateFile())).toBe(false)
    expect(existsSync(join(home, 'rox'))).toBe(false)
  })

  it('no state file: no lastMigration and no message', () => {
    mkdirSync(join(home, '.rox'))
    const state = createStorageVisibleRootHandlers({ env: {}, homeDir: home, activeAtLaunch: false }).get()
    expect('lastMigration' in state).toBe(false)
    expect(storageMigrationStatusMessageKey(state)).toBeUndefined()
  })

  it('the explanatory line only shows for a deferral while the toggle is ON', () => {
    const base = { enabled: true, activeAtLaunch: true, locked: false, restartRequired: false }
    const at = '2026-10-08T07:00:00.000Z'
    expect(storageMigrationStatusMessageKey({ ...base, lastMigration: { kind: 'deferred-locked', at } })).toBe('storage.settings.migrationDeferredLocked')
    expect(storageMigrationStatusMessageKey({ ...base, lastMigration: { kind: 'relaunch-required', at } })).toBeUndefined()
    expect(storageMigrationStatusMessageKey({ ...base, enabled: false, lastMigration: { kind: 'deferred-locked', at } })).toBeUndefined()
    // Env-locked toggle: the launch state decides.
    expect(storageMigrationStatusMessageKey({ ...base, enabled: false, locked: true, lastMigration: { kind: 'deferred-unmovable', at } }))
      .toBe('storage.settings.migrationDeferredUnmovable')
  })

  it('the message follows the diagnostic: in use, unmovable, foreign, retry later, generic', () => {
    const base = { enabled: true, activeAtLaunch: true, locked: false, restartRequired: false }
    const at = '2026-10-08T07:00:00.000Z'
    const key = (kind: StorageMigrationStatus['kind'], diagnostics: string[] = []) =>
      storageMigrationStatusMessageKey({ ...base, lastMigration: { kind, diagnostics, at } })
    for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
      expect(key('deferred-unmovable', ['storage.migration.legacyNotRenamable', `rename:${code}`])).toBe('storage.settings.migrationDeferredInUse')
      expect(key('deferred-unmovable', ['storage.migration.mergeRenameFailed', `rename:${code}`])).toBe('storage.settings.migrationDeferredInUse')
    }
    for (const code of ['EXDEV', 'mount-point', 'volume-root', 'cross-device', 'reparse-point']) {
      expect(key('deferred-unmovable', ['storage.migration.legacyNotRenamable', `rename:${code}`])).toBe('storage.settings.migrationDeferredUnmovable')
    }
    expect(key('deferred-unmovable', ['storage.migration.legacyNotRenamable', 'rename:parent-not-writable'])).toBe('storage.settings.migrationFailed')
    expect(key('deferred-foreign')).toBe('storage.settings.migrationDeferredForeign')
    expect(key('deferred-retry', ['storage.migration.mergeRetryLater', 'failed:EBUSY'])).toBe('storage.settings.migrationRetryLater')
    for (const kind of ['deferred-link', 'symlink-elsewhere', 'failed'] as const) expect(key(kind)).toBe('storage.settings.migrationFailed')
    expect(key('relaunch-required')).toBeUndefined()
  })

  it('every message exists in all 12 locales, with the Russian text as specified', () => {
    const locales = ['ar', 'de', 'en', 'es', 'fr', 'hu', 'ja', 'ko', 'pl', 'ru', 'zh-Hans', 'zh-Hant']
    const keys = [
      'storage.settings.migrationDeferredUnmovable',
      'storage.settings.migrationDeferredLocked',
      'storage.settings.migrationDeferredInUse',
      'storage.settings.migrationDeferredForeign',
      'storage.settings.migrationRetryLater',
      'storage.settings.migrationFailed',
    ]
    const dir = join(import.meta.dir, '../../../../../packages/shared/src/i18n/locales')
    for (const locale of locales) {
      const messages = JSON.parse(readFileSync(join(dir, `${locale}.json`), 'utf8')) as Record<string, string>
      for (const k of keys) expect(messages[k]?.length).toBeGreaterThan(0)
    }
    const ru = JSON.parse(readFileSync(join(dir, 'ru.json'), 'utf8')) as Record<string, string>
    expect(ru['storage.settings.migrationDeferredUnmovable']).toBe('Не удалось перенести ~/.rox (отдельный том или точка монтирования) — данные остаются в ~/.rox')
    expect(ru['storage.settings.migrationDeferredLocked']).toBe('Перенос отложен: Rox запущен в другом окне или процессе')
    expect(ru['storage.settings.migrationDeferredInUse']).toBe('Перенос отложен: файлы в ~/.rox заняты другой программой, повторим при следующем запуске')
    expect(ru['storage.settings.migrationDeferredForeign']).toBe('Папка ~/rox уже занята чужими файлами — перенос не выполнен')
  })
})
