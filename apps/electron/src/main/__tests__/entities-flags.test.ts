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
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
const { parseDeepLink, resolveDeepLinkTarget, resolveDeepLinkTargetDetailed, isEntityOnlyDeepLink, __resetDeepLinkSequenceForTests } = await import('../deep-link')

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

    it('a first launch with the flag off writes nothing; once on, off is persisted too (review 4 #7)', () => {
      const dir = tempDir()
      const file = join(dir, ENTITIES_LINKS_STATE_FILE)
      expect(loadPersistedEntitiesLinksFlag(dir, { logger: quiet })).toBeUndefined()
      applyEntitiesLinksFlag(false) // bootstrap report of a never-enabled toggle
      applyEntitiesLinksFlag(false)
      expect(existsSync(file)).toBe(false)
      expect(isEntitiesLinksFlagKnown()).toBe(true) // known for this session
      applyEntitiesLinksFlag(true)
      applyEntitiesLinksFlag(false)
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ enabled: false })
      __resetEntitiesLinksFlagForTests()
      expect(loadPersistedEntitiesLinksFlag(dir, { logger: quiet })).toBe(false)
      expect(isEntitiesLinksFlagKnown()).toBe(true)
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

    it('index.ts registers the channels first thing in whenReady, before any await (review 4 #8)', () => {
      const source = readFileSync(new URL('../index.ts', import.meta.url), 'utf8')
      const ready = source.indexOf('app.whenReady().then(async () => {')
      const register = source.indexOf('registerEntitiesLinksIpc(ipcMain')
      const firstAwait = source.indexOf('await ', ready)
      const declared = source.indexOf('const isClientOnly = !!process.env.CRAFT_SERVER_URL')
      const windows = source.indexOf('await createInitialWindows()')
      expect(ready).toBeGreaterThan(0)
      expect(register).toBeGreaterThan(ready)
      expect(register).toBeLessThan(firstAwait)
      // Unconditional: before (outside) every isClientOnly branch and windows.
      expect(register).toBeLessThan(declared)
      expect(register).toBeLessThan(windows)
      expect(source.match(/registerEntitiesLinksIpc\(ipcMain/g)).toHaveLength(1)
      const load = source.indexOf('loadPersistedEntitiesLinksFlag(CONFIG_DIR')
      expect(load).toBeGreaterThan(ready)
      expect(load).toBeLessThan(register)
      // Static import: no dynamic import (an await) in front of it.
      expect(source).toContain("import { loadPersistedEntitiesLinksFlag, registerEntitiesLinksIpc } from './entities-flags'")
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
      expect(deepLink).toContain('const { target, dropped } = await resolveDeepLinkTargetDetailed(url, { external: true })')
      expect(deepLink).toContain("if (dropped === 'superseded') return { success: false, error: 'Deep link superseded by a later link' }")
      expect(windowManager).toContain('const target = await resolveDeepLinkTarget(initialDeepLink)')
    })

    it('a held external entity link superseded by a later external link is dropped (review 4 #9)', async () => {
      __resetDeepLinkSequenceForTests()
      const held = resolveDeepLinkTargetDetailed('rox://docs/file/f-1', { timeoutMs: 1000, external: true })
      // A later external non-entity link is handled immediately …
      expect((await resolveDeepLinkTargetDetailed('rox://tasks/task/t-1', { external: true })).target?.view).toBe('tasks/task/t-1')
      applyEntitiesLinksFlag(true)
      // … so the older held link must not navigate after it.
      expect(await held).toEqual({ target: null, dropped: 'superseded' })
      // Without a later link the held one resolves normally; timeouts say so.
      __resetEntitiesLinksFlagForTests()
      const alone = resolveDeepLinkTargetDetailed('rox://docs/file/f-2', { timeoutMs: 1000, external: true })
      applyEntitiesLinksFlag(true)
      expect((await alone).target?.view).toBe('docs/file/f-2')
      __resetEntitiesLinksFlagForTests()
      expect(await resolveDeepLinkTargetDetailed('rox://docs/file/f-3', { timeoutMs: 1, external: true })).toEqual({ target: null, dropped: 'timeout' })
    })

    it('internal navigations never supersede a held external link (review 5 #6b)', async () => {
      __resetDeepLinkSequenceForTests()
      const held = resolveDeepLinkTargetDetailed('rox://docs/file/f-9', { timeoutMs: 1000, external: true })
      // createWindow({ initialDeepLink }) (e.g. OPEN_SESSION_IN_NEW_WINDOW) resolves internally.
      expect((await resolveDeepLinkTarget('rox://tasks/task/t-2'))?.view).toBe('tasks/task/t-2')
      expect((await resolveDeepLinkTargetDetailed('rox://tasks/task/t-3')).target?.view).toBe('tasks/task/t-3')
      // An internal entity link held at the same time is not superseded either.
      const internalHeld = resolveDeepLinkTarget('rox://docs/file/f-10', { timeoutMs: 1000 })
      applyEntitiesLinksFlag(true)
      expect((await held).target?.view).toBe('docs/file/f-9')
      expect((await internalHeld)?.view).toBe('docs/file/f-10')
      // Only handleDeepLink (external ingress) passes external: true; window-manager does not.
      const windowManager = readFileSync(new URL('../window-manager.ts', import.meta.url), 'utf8')
      expect(windowManager).not.toContain('external: true')
    })

    it('the cold-start pending link is not awaited in the init path (review 4 #9)', () => {
      const source = readFileSync(new URL('../index.ts', import.meta.url), 'utf8')
      expect(source).not.toContain('await handleDeepLink(pendingDeepLink')
      expect(source).toContain('handleDeepLink(coldStartLink, windowManager, moduleSink ?? undefined, moduleClientResolver ?? undefined).catch(')
      expect(source).not.toMatch(/retry: the link stays|kept for a retry/)
    })
  })
})
