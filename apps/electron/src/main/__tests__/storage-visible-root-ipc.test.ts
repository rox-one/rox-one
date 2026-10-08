import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isVisibleRoxHomeActive, resolveConfigDir, resetConfigDirCachesForTests } from '../../../../../packages/shared/src/config/env.ts'
import { createStorageVisibleRootHandlers, registerStorageVisibleRootIpc } from '../storage-visible-root-ipc'
import { STORAGE_VISIBLE_ROOT_CHANNELS } from '../../shared/storage-visible-root'

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
    expect(resolveConfigDir({}, home)).toBe(join(home, 'rox'))
    expect(lstatSync(join(home, '.rox')).isSymbolicLink()).toBe(true)
    expect(JSON.parse(readFileSync(join(home, 'rox', 'config.json'), 'utf8')).workspaces[0].id).toBe('w1')
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
