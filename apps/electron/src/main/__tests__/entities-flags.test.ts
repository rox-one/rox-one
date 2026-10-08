/**
 * Main-process owner of the effective `entities.links.v1` state.
 *
 * - one value drives the deep-link parser and the server-core live flag
 *   source (main, renderer and server agree);
 * - env override > persisted toggle, returned to the renderer (review 3 #3);
 * - durable copy read at boot (review 3 #2);
 * - IPC registered unconditionally, incl. thin-client mode (fix5 A);
 * - cold-start entity deep links held until the state is known (fix5 C).
 */
import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { stubMainLogger } from './stub-main-logger'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ENTITIES_LINKS_WORKBENCH_FLAG, isEntitiesLinksEnabled } from '@rox/shared/feature-flags'
import { getEntitiesWorkbenchFlags, resetEntitiesWorkbenchFlags } from '@rox/server-core/entities/workbench-flags'
import { isEntityRoutesEnabled, resetEntityRoutesEnabled } from '../../shared/route-parser'
import {
  ENTITIES_LINKS_IPC,
  ENTITIES_LINKS_STATE_FILE,
  __resetEntitiesLinksFlagForTests,
  applyEntitiesLinksFlag,
  getEntitiesLinksState,
  isEntitiesLinksFlagKnown,
  loadPersistedEntitiesLinksFlag,
  registerEntitiesLinksIpc,
  whenEntitiesLinksFlagKnown,
} from '../entities-flags'

// deep-link.ts pulls the main logger (electron-log → electron binary), which
// this clone does not have installed. Stub the logger by absolute path so the
// pure parse logic stays testable here.
stubMainLogger()
const { parseDeepLink, resolveDeepLinkTarget, isEntityOnlyDeepLink } = await import('../deep-link')

const quiet = { warn: () => {}, error: () => {} }
const dirs: string[] = []
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'rox-entities-flag-'))
  dirs.push(dir)
  return dir
}

function fakeIpc() {
  const handles = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  const ons = new Map<string, (event: { returnValue?: unknown }, ...args: unknown[]) => void>()
  const ipc = {
    handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => { handles.set(channel, listener) },
    on: (channel: string, listener: (event: { returnValue?: unknown }, ...args: unknown[]) => void) => { ons.set(channel, listener) },
  } as unknown as import('electron').IpcMain
  return { ipc, handles, ons }
}

describe('main entities-links flag owner', () => {
  const previous = process.env.CRAFT_FEATURE_ENTITIES_LINKS
  beforeEach(() => {
    delete process.env.CRAFT_FEATURE_ENTITIES_LINKS
    __resetEntitiesLinksFlagForTests()
    resetEntitiesWorkbenchFlags()
    resetEntityRoutesEnabled()
  })
  afterEach(() => {
    if (previous === undefined) delete process.env.CRAFT_FEATURE_ENTITIES_LINKS
    else process.env.CRAFT_FEATURE_ENTITIES_LINKS = previous
    __resetEntitiesLinksFlagForTests()
    resetEntitiesWorkbenchFlags()
    resetEntityRoutesEnabled()
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('defaults off, inert and unknown', () => {
    expect(isEntityRoutesEnabled()).toBe(false)
    expect(getEntitiesWorkbenchFlags().has(ENTITIES_LINKS_WORKBENCH_FLAG)).toBe(false)
    expect(parseDeepLink('rox://goals/goal/g-1')).toBeNull()
    expect(isEntitiesLinksFlagKnown()).toBe(false)
    expect(getEntitiesLinksState()).toEqual({ enabled: false, persisted: false, envOverride: undefined })
  })

  it('applyEntitiesLinksFlag drives both consumers and returns the effective state', () => {
    expect(applyEntitiesLinksFlag(true)).toEqual({ enabled: true, persisted: true, envOverride: undefined })
    expect(isEntityRoutesEnabled()).toBe(true)
    expect(getEntitiesWorkbenchFlags().has(ENTITIES_LINKS_WORKBENCH_FLAG)).toBe(true)
    expect(parseDeepLink('rox://goals/goal/g-1')?.view).toBe('goals/goal/g-1')
    expect(applyEntitiesLinksFlag(false).enabled).toBe(false)
    expect(isEntityRoutesEnabled()).toBe(false)
    expect(getEntitiesWorkbenchFlags().has(ENTITIES_LINKS_WORKBENCH_FLAG)).toBe(false)
    expect(parseDeepLink('rox://goals/goal/g-1')).toBeNull()
  })

  describe('env override (review 3 #3): main, renderer and server agree', () => {
    it('env=1 forces on with the toggle off', () => {
      process.env.CRAFT_FEATURE_ENTITIES_LINKS = '1'
      const state = applyEntitiesLinksFlag(false)
      expect(state).toEqual({ enabled: true, persisted: false, envOverride: true })
      expect(isEntityRoutesEnabled()).toBe(true)
      expect(isEntitiesLinksEnabled(getEntitiesWorkbenchFlags())).toBe(true)
      expect(parseDeepLink('rox://docs/file/f-1')?.view).toBe('docs/file/f-1')
    })

    it('env=0 forces off with the toggle on', () => {
      process.env.CRAFT_FEATURE_ENTITIES_LINKS = '0'
      const state = applyEntitiesLinksFlag(true)
      expect(state).toEqual({ enabled: false, persisted: true, envOverride: false })
      expect(isEntityRoutesEnabled()).toBe(false)
      expect(isEntitiesLinksEnabled(getEntitiesWorkbenchFlags())).toBe(false)
      expect(parseDeepLink('rox://docs/file/f-1')).toBeNull()
    })

    it('no env: the toggle decides everywhere', () => {
      const state = applyEntitiesLinksFlag(true)
      expect(state).toEqual({ enabled: true, persisted: true, envOverride: undefined })
      expect(isEntitiesLinksEnabled(getEntitiesWorkbenchFlags())).toBe(state.enabled)
      expect(isEntityRoutesEnabled()).toBe(state.enabled)
    })

    it('an env override makes the state known without any report', () => {
      process.env.CRAFT_FEATURE_ENTITIES_LINKS = '1'
      expect(isEntitiesLinksFlagKnown()).toBe(true)
    })
  })

  describe('durable copy (review 3 #2)', () => {
    it('persists reports and reads them back at boot', () => {
      const dir = tempDir()
      expect(loadPersistedEntitiesLinksFlag(dir, { logger: quiet })).toBeUndefined()
      expect(isEntitiesLinksFlagKnown()).toBe(false)
      applyEntitiesLinksFlag(true)
      expect(JSON.parse(readFileSync(join(dir, ENTITIES_LINKS_STATE_FILE), 'utf8'))).toEqual({ enabled: true })

      // Next launch: main knows the flag before any renderer mounts.
      __resetEntitiesLinksFlagForTests()
      resetEntityRoutesEnabled()
      expect(loadPersistedEntitiesLinksFlag(dir, { logger: quiet })).toBe(true)
      expect(isEntitiesLinksFlagKnown()).toBe(true)
      expect(isEntityRoutesEnabled()).toBe(true)
      expect(getEntitiesWorkbenchFlags().has(ENTITIES_LINKS_WORKBENCH_FLAG)).toBe(true)
      expect(parseDeepLink('rox://docs/file/f-1')?.view).toBe('docs/file/f-1')
    })

    it('a malformed copy reads as OFF and unknown', () => {
      const dir = tempDir()
      writeFileSync(join(dir, ENTITIES_LINKS_STATE_FILE), '{"enabled": "yes"')
      expect(loadPersistedEntitiesLinksFlag(dir, { logger: quiet })).toBeUndefined()
      expect(isEntitiesLinksFlagKnown()).toBe(false)
      expect(isEntityRoutesEnabled()).toBe(false)
    })
  })

  describe('IPC (fix5 A: registered for every host)', () => {
    it('setLinksEnabled and the sync bootstrap report return the effective state', async () => {
      const { ipc, handles, ons } = fakeIpc()
      const broadcasts: unknown[] = []
      registerEntitiesLinksIpc(ipc, { broadcast: (channel, state) => broadcasts.push([channel, state]) })
      const event: { returnValue?: unknown } = {}
      ons.get(ENTITIES_LINKS_IPC.SYNC)!(event, true)
      expect(event.returnValue).toEqual({ enabled: true, persisted: true, envOverride: undefined })
      expect(isEntitiesLinksFlagKnown()).toBe(true)
      expect(await handles.get(ENTITIES_LINKS_IPC.SET)!({}, false)).toEqual({ enabled: false, persisted: false, envOverride: undefined })
      expect(isEntityRoutesEnabled()).toBe(false)
      // Re-reporting the same value does not re-broadcast.
      await handles.get(ENTITIES_LINKS_IPC.SET)!({}, false)
      expect(broadcasts).toEqual([
        [ENTITIES_LINKS_IPC.CHANGED, { enabled: true, persisted: true, envOverride: undefined }],
        [ENTITIES_LINKS_IPC.CHANGED, { enabled: false, persisted: false, envOverride: undefined }],
      ])
    })

    it('non-boolean payloads count as OFF', async () => {
      const { ipc, handles } = fakeIpc()
      registerEntitiesLinksIpc(ipc)
      expect((await handles.get(ENTITIES_LINKS_IPC.SET)!({}, 'true') as { enabled: boolean }).enabled).toBe(false)
    })

    it('index.ts registers the channels outside every isClientOnly branch, before windows', () => {
      const source = readFileSync(new URL('../index.ts', import.meta.url), 'utf8')
      const register = source.indexOf('registerEntitiesLinksIpc(ipcMain')
      const declared = source.indexOf('const isClientOnly = !!process.env.CRAFT_SERVER_URL')
      const firstServerOnly = source.indexOf('if (!isClientOnly) {', declared)
      const windows = source.indexOf('await createInitialWindows()')
      expect(register).toBeGreaterThan(declared)
      expect(register).toBeLessThan(firstServerOnly)
      expect(register).toBeLessThan(windows)
      expect(source.match(/registerEntitiesLinksIpc\(ipcMain/g)).toHaveLength(1)
      expect(source.indexOf('loadPersistedEntitiesLinksFlag(CONFIG_DIR')).toBeLessThan(register)
    })
  })

  describe('cold-start entity deep links (review 3 #2, fix5 C)', () => {
    it('classifies entity-only links', () => {
      expect(isEntityOnlyDeepLink('rox://docs/file/f-1')).toBe(true)
      expect(isEntityOnlyDeepLink('rox://workspace/ws1/goals/goal/g-1')).toBe(true)
      expect(isEntityOnlyDeepLink('rox://tasks/task/t-1')).toBe(false)
      expect(isEntityOnlyDeepLink('rox://allSessions')).toBe(false)
      expect(isEntityOnlyDeepLink('https://docs/file/x')).toBe(false)
    })

    it('holds an entity link until the first report, then parses it with the reported state', async () => {
      const pending = resolveDeepLinkTarget('rox://docs/file/f-1', { timeoutMs: 5_000 })
      let settled = false
      void pending.then(() => { settled = true })
      await new Promise(resolve => setTimeout(resolve, 10))
      expect(settled).toBe(false)
      applyEntitiesLinksFlag(true)
      expect((await pending)?.view).toBe('docs/file/f-1')
    })

    it('a held link is rejected when the report says OFF', async () => {
      const pending = resolveDeepLinkTarget('rox://workspace/ws1/goals/goal/g-1', { timeoutMs: 5_000 })
      applyEntitiesLinksFlag(false)
      expect((await pending)?.view).toBeUndefined()
    })

    it('drops the link after the timeout', async () => {
      expect(await resolveDeepLinkTarget('rox://docs/file/f-1', { timeoutMs: 5 })).toBeNull()
    })

    it('never holds non-entity links or links once the state is known', async () => {
      expect((await resolveDeepLinkTarget('rox://tasks/task/t-1', { timeoutMs: 60_000 }))?.view).toBe('tasks/task/t-1')
      loadPersistedEntitiesLinksFlag(tempDir(), { logger: quiet })
      applyEntitiesLinksFlag(false)
      expect(await resolveDeepLinkTarget('rox://docs/file/f-1', { timeoutMs: 60_000 })).toBeNull()
    })

    it('whenEntitiesLinksFlagKnown resolves immediately once known', async () => {
      applyEntitiesLinksFlag(false)
      expect(await whenEntitiesLinksFlagKnown(0)).toBe(true)
    })

    it('handleDeepLink and the first-window initialDeepLink go through the hold', () => {
      const deepLink = readFileSync(new URL('../deep-link.ts', import.meta.url), 'utf8')
      const windowManager = readFileSync(new URL('../window-manager.ts', import.meta.url), 'utf8')
      expect(deepLink).toContain('const target = await resolveDeepLinkTarget(url)')
      expect(windowManager).toContain('const target = await resolveDeepLinkTarget(initialDeepLink)')
    })
  })
})
