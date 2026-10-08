/**
 * W1-07 (#1504): mode-root deep links (rox://messenger, …) follow their own
 * mode flag in the main process; the gate is pushed from the renderer over
 * IPC and is default-closed.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  __resetDeepLinkSequenceForTests,
  handleDeepLink,
  isClosedSurfaceRootDeepLink,
  isEntityOnlyDeepLink,
  parseDeepLink,
  resolveDeepLinkTarget,
  resolveDeepLinkTargetDetailed,
} from '../deep-link'
import {
  SURFACE_ROUTES_IPC_CHANNEL,
  __resetSurfaceGateForTests,
  applyUnifiedSurfaceRoutes,
  isSurfaceGateLatched,
  isSurfaceGateReceived,
  isSurfaceGateSettled,
  registerSurfaceRoutesIpc,
  whenSurfaceGateReady,
} from '../surface-routes-ipc'
import {
  isCompoundRoute,
  isCompoundRoutePrefix,
  parseRouteToNavigationState,
  resetEntityRoutesEnabled,
  setEntityRoutesEnabled,
} from '../../shared/route-parser'
import {
  isClosedUnifiedSurfaceRoot,
  isOpenUnifiedSurfaceRoot,
  isUnifiedSurfaceRouteEnabled,
  resetUnifiedSurfaceRoutes,
  setUnifiedSurfaceRoutesEnabled,
} from '../../shared/surface-routes'

afterEach(() => {
  __resetSurfaceGateForTests()
  __resetDeepLinkSequenceForTests()
  resetUnifiedSurfaceRoutes()
  resetEntityRoutesEnabled()
})

function fakeIpc() {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  return { handlers, ipc: { handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => void handlers.set(channel, fn) } }
}

describe('surface route IPC', () => {
  it('default-closed: every mode root is rejected until the renderer pushes', () => {
    for (const surface of ['messenger', 'calendar', 'goals', 'contacts']) {
      expect(parseDeepLink(`rox://${surface}`)).toBeNull()
      expect(parseDeepLink(`rox://workspace/ws1/${surface}`)).toBeNull()
    }
  })

  it('the handler opens exactly the pushed surfaces', async () => {
    const { handlers, ipc } = fakeIpc()
    registerSurfaceRoutesIpc(ipc as never)
    const handler = handlers.get(SURFACE_ROUTES_IPC_CHANNEL)!
    expect(await handler({}, ['messenger'])).toEqual({ ok: true })
    expect(parseDeepLink('rox://messenger')?.view).toBe('messenger')
    expect(parseDeepLink('rox://workspace/ws1/messenger')?.view).toBe('messenger')
    expect(parseDeepLink('rox://calendar')).toBeNull()
    await handler({}, [])
    expect(parseDeepLink('rox://messenger')).toBeNull()
  })

  it('negative: untrusted payloads never open unknown surfaces', () => {
    expect(applyUnifiedSurfaceRoutes('messenger')).toEqual([])
    expect(applyUnifiedSurfaceRoutes(['messenger', 'settings', 42, 'messenger'])).toEqual(['messenger'])
    expect(isUnifiedSurfaceRouteEnabled('messenger')).toBe(true)
    expect(isUnifiedSurfaceRouteEnabled('settings')).toBe(false)
  })

  it('entity links keep following entities.links.v1; the bare root follows its mode flag', () => {
    setEntityRoutesEnabled(true)
    expect(parseDeepLink('rox://messenger')).toBeNull()
    expect(parseDeepLink('rox://messenger/chat-1')?.view).toBe('messenger/chat-1')
    expect(isClosedUnifiedSurfaceRoot('messenger?x=1')).toBe(true)
    expect(isClosedUnifiedSurfaceRoot('messenger/chat-1')).toBe(false)
    expect(isClosedUnifiedSurfaceRoot('notes')).toBe(false)
  })

  it('main registers the handler', async () => {
    const index = await Bun.file(new URL('../index.ts', import.meta.url)).text()
    expect(index).toContain('registerSurfaceRoutesIpc(ipcMain)')
    // Exactly once, and outside every `if (!isClientOnly)` block: the thin
    // client (CRAFT_SERVER_URL) parses deep links in main too.
    expect(index.split('registerSurfaceRoutesIpc(ipcMain)').length).toBe(2)
    const at = index.indexOf('registerSurfaceRoutesIpc(ipcMain)')
    expect(at).toBeGreaterThan(index.indexOf("ipcMain.handle('i18n:changeLanguage'"))
    expect(at).toBeLessThan(index.indexOf('if (!isClientOnly) {'))
    const preload = await Bun.file(new URL('../../preload/bootstrap.ts', import.meta.url)).text()
    expect(preload).toContain(`ipcRenderer.invoke('${SURFACE_ROUTES_IPC_CHANNEL}', ids)`)
  })
})

describe('open mode flag admits only the bare root (entity sub-routes follow entities.links.v1)', () => {
  it('mode on, entities off: root accepted, sub-routes rejected in main and renderer', () => {
    setUnifiedSurfaceRoutesEnabled(['messenger'])
    expect(parseDeepLink('rox://messenger')?.view).toBe('messenger')
    expect(parseDeepLink('rox://messenger/')?.view).toBe('messenger/')
    expect(parseDeepLink('rox://messenger?x=1')?.view).toBe('messenger?x=1')
    expect(parseDeepLink('rox://workspace/ws1/messenger')?.view).toBe('messenger')
    expect(parseDeepLink('rox://messenger/chat-1')).toBeNull()
    expect(parseDeepLink('rox://messenger/anything/else')).toBeNull()
    // Workspace form: no view is forwarded (same as flags off — the link only
    // targets the workspace, like any unknown route type).
    expect(parseDeepLink('rox://workspace/ws1/messenger/chat-1')?.view).toBeUndefined()
    expect(isCompoundRoute('messenger')).toBe(true)
    expect(isCompoundRoute('messenger/chat-1')).toBe(false)
    expect(isCompoundRoutePrefix('messenger')).toBe(true)
    expect(isCompoundRoutePrefix('messenger', 'messenger/chat-1')).toBe(false)
    expect(parseRouteToNavigationState('messenger')).toMatchObject({ navigator: 'surface', surface: 'messenger' })
    expect(parseRouteToNavigationState('messenger/chat-1')).toBeNull()
  })

  it('mode on, entities on: root is the surface, sub-routes are entity routes', () => {
    setUnifiedSurfaceRoutesEnabled(['messenger'])
    setEntityRoutesEnabled(true)
    expect(parseDeepLink('rox://messenger')?.view).toBe('messenger')
    expect(parseDeepLink('rox://messenger/chat-1')?.view).toBe('messenger/chat-1')
    expect(isCompoundRoutePrefix('messenger', 'messenger/chat-1')).toBe(true)
  })

  it('isOpenUnifiedSurfaceRoot: bare open roots only', () => {
    expect(isOpenUnifiedSurfaceRoot('messenger')).toBe(false)
    setUnifiedSurfaceRoutesEnabled(['messenger'])
    expect(isOpenUnifiedSurfaceRoot('messenger')).toBe(true)
    expect(isOpenUnifiedSurfaceRoot('messenger?x=1#y')).toBe(true)
    expect(isOpenUnifiedSurfaceRoot('messenger/chat-1')).toBe(false)
    expect(isOpenUnifiedSurfaceRoot('calendar')).toBe(false)
    expect(isOpenUnifiedSurfaceRoot('notes')).toBe(false)
  })

  it('flags off: unchanged (prefix-only callers keep the old answer)', () => {
    expect(isCompoundRoutePrefix('messenger')).toBe(false)
    expect(isCompoundRoutePrefix('notes')).toBe(true)
    expect(isCompoundRoutePrefix('notes', 'notes/abc')).toBe(true)
    expect(parseDeepLink('rox://notes')?.view).toBe('notes')
  })
})

describe('cold start: a mode-root link waits for the first gate push (review4 #1)', () => {
  const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

  it('isClosedSurfaceRootDeepLink: bare and workspace mode roots only', () => {
    expect(isClosedSurfaceRootDeepLink('rox://messenger')).toBe(true)
    expect(isClosedSurfaceRootDeepLink('rox://workspace/ws1/messenger')).toBe(true)
    expect(isClosedSurfaceRootDeepLink('rox://workspace//messenger')).toBe(false)
    expect(isClosedSurfaceRootDeepLink('rox://messenger/chan-1')).toBe(false)
    expect(isClosedSurfaceRootDeepLink('rox://nope')).toBe(false)
    expect(isClosedSurfaceRootDeepLink('https://messenger')).toBe(false)
    expect(isClosedSurfaceRootDeepLink('not a url')).toBe(false)
    applyUnifiedSurfaceRoutes(['messenger'])
    expect(isClosedSurfaceRootDeepLink('rox://messenger')).toBe(false)
  })

  it('merge with #1499: bare mode roots skip the entity hold; entity sub-routes keep it', () => {
    expect(isEntityOnlyDeepLink('rox://messenger')).toBe(false)
    expect(isEntityOnlyDeepLink('rox://messenger/?x=1')).toBe(false)
    expect(isEntityOnlyDeepLink('rox://workspace/ws1/goals')).toBe(false)
    expect(isEntityOnlyDeepLink('rox://messenger/chat-1')).toBe(true)
    expect(isEntityOnlyDeepLink('rox://workspace/ws1/goals/goal/g-1')).toBe(true)
    // Not a unified surface: the bare root still follows entities.links.v1.
    expect(isEntityOnlyDeepLink('rox://docs')).toBe(true)
  })

  it('a late push with the mode on opens the held link (bare and workspace form)', async () => {
    const bare = resolveDeepLinkTarget('rox://messenger', { timeoutMs: 1000 })
    const scoped = resolveDeepLinkTarget('rox://workspace/ws1/messenger', { timeoutMs: 1000 })
    await tick()
    applyUnifiedSurfaceRoutes(['messenger'])
    expect((await bare)?.view).toBe('messenger')
    expect(await scoped).toMatchObject({ workspaceId: 'ws1', view: 'messenger' })
  })

  it('flags off: the first push ([]) still rejects it — main parity', async () => {
    const held = resolveDeepLinkTarget('rox://messenger', { timeoutMs: 1000 })
    await tick()
    applyUnifiedSurfaceRoutes([])
    expect(await held).toBeNull()
  })

  it('timeout: dropped (null) when the renderer never pushes', async () => {
    expect(await resolveDeepLinkTarget('rox://calendar', { timeoutMs: 10 })).toBeNull()
    expect(isSurfaceGateReceived()).toBe(false)
  })

  it('non-surface links never wait (valid or invalid)', async () => {
    const start = Date.now()
    expect(await resolveDeepLinkTarget('rox://nope', { timeoutMs: 5000 })).toBeNull()
    expect((await resolveDeepLinkTarget('rox://allSessions', { timeoutMs: 5000 }))?.view).toBe('allSessions')
    expect(Date.now() - start).toBeLessThan(1000)
  })

  it('after the first push nothing waits: a closed root is rejected at once', async () => {
    applyUnifiedSurfaceRoutes([])
    const start = Date.now()
    expect(await resolveDeepLinkTarget('rox://messenger', { timeoutMs: 5000 })).toBeNull()
    expect(Date.now() - start).toBeLessThan(1000)
    expect(await whenSurfaceGateReady(5000)).toBe(true)
  })

  it('handleDeepLink (pending cold-start path) navigates once the gate arrives', async () => {
    const sent: unknown[] = []
    const window = {
      isDestroyed: () => false,
      isMinimized: () => false,
      focus: () => {},
      restore: () => {},
      webContents: { id: 7, isLoading: () => false },
    }
    const windowManager = {
      focusOrCreateWindow: () => window,
      getFocusedWindow: () => window,
      getLastActiveWindow: () => window,
      getWorkspaceForWindow: () => 'ws1',
    } as never
    const result = handleDeepLink('rox://workspace/ws1/messenger', windowManager, ((channel: string, target: unknown, nav: unknown) => {
      sent.push({ channel, target, nav })
    }) as never)
    await tick()
    expect(sent).toEqual([])
    applyUnifiedSurfaceRoutes(['messenger'])
    expect(await result).toMatchObject({ success: true, windowId: 7 })
    expect(sent).toHaveLength(1)
    expect((sent[0] as { nav: { view: string } }).nav.view).toBe('messenger')
  })

  it('wiring: handleDeepLink (external) and the initial-window path (internal) share both holds', () => {
    const src = (file: string) => readFileSync(join(import.meta.dir, '..', file), 'utf8')
    const deepLink = src('deep-link.ts')
    expect(deepLink).toContain('await resolveDeepLinkTargetDetailed(url, { external: true })')
    // #1499 entity hold first, then the #1504 surface hold.
    expect(deepLink.indexOf('whenEntitiesLinksFlagKnown(options.timeoutMs')).toBeGreaterThan(0)
    expect(deepLink.indexOf('whenEntitiesLinksFlagKnown(options.timeoutMs')).toBeLessThan(deepLink.indexOf('whenSurfaceGateReady(options.timeoutMs'))
    expect(src('window-manager.ts')).toContain('await resolveDeepLinkTarget(initialDeepLink)')
    expect(src('window-manager.ts')).not.toContain('external: true')
    // #1499: the cold-start link is consumed once; a failure is dropped, no retry.
    expect(src('index.ts')).toContain('(dropped, no retry)')
    expect(src('index.ts')).not.toContain('await handleDeepLink(pendingDeepLink')
  })

  it('a held external mode-root link is superseded by a later external link', async () => {
    const held = resolveDeepLinkTargetDetailed('rox://messenger', { timeoutMs: 1000, external: true })
    await tick()
    expect((await resolveDeepLinkTargetDetailed('rox://allSessions', { external: true })).target?.view).toBe('allSessions')
    applyUnifiedSurfaceRoutes(['messenger'])
    expect(await held).toEqual({ target: null, dropped: 'superseded' })
  })

  it('internal resolution (initialDeepLink) neither supersedes nor is superseded', async () => {
    const held = resolveDeepLinkTargetDetailed('rox://messenger', { timeoutMs: 1000, external: true })
    await tick()
    expect((await resolveDeepLinkTarget('rox://allSessions'))?.view).toBe('allSessions')
    applyUnifiedSurfaceRoutes(['messenger'])
    expect((await held).target?.view).toBe('messenger')
  })
})

describe('gate latch after timeout (review5 info #1)', () => {
  const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

  it('the first timeout latches: later mode-root links fail fast instead of waiting', async () => {
    expect(isSurfaceGateSettled()).toBe(false)
    expect(await resolveDeepLinkTargetDetailed('rox://messenger', { timeoutMs: 5, external: true })).toEqual({ target: null, dropped: 'timeout' })
    expect(isSurfaceGateLatched()).toBe(true)
    expect(isSurfaceGateReceived()).toBe(false)
    expect(isSurfaceGateSettled()).toBe(true)
    const start = Date.now()
    expect(await resolveDeepLinkTarget('rox://calendar', { timeoutMs: 5_000 })).toBeNull()
    expect(await resolveDeepLinkTarget('rox://workspace/ws1/goals', { timeoutMs: 5_000 })).toBeNull()
    expect(await whenSurfaceGateReady(5_000)).toBe(false)
    expect(Date.now() - start).toBeLessThan(1_000)
  })

  it('a timeout releases every other pending waiter at once', async () => {
    const start = Date.now()
    const long = whenSurfaceGateReady(5_000)
    const longLink = resolveDeepLinkTarget('rox://messenger', { timeoutMs: 5_000 })
    expect(await whenSurfaceGateReady(5)).toBe(false)
    expect(await long).toBe(false)
    expect(await longLink).toBeNull()
    expect(Date.now() - start).toBeLessThan(1_000)
  })

  it('a late push applies the flags but never re-closes the latch or re-queues dropped links', async () => {
    const sent: unknown[] = []
    const window = {
      isDestroyed: () => false,
      isMinimized: () => false,
      focus: () => {},
      restore: () => {},
      webContents: { id: 7, isLoading: () => false },
    }
    const windowManager = {
      focusOrCreateWindow: () => window,
      getFocusedWindow: () => window,
      getLastActiveWindow: () => window,
      getWorkspaceForWindow: () => 'ws1',
    } as never
    const sink = ((channel: string, target: unknown, nav: unknown) => void sent.push({ channel, target, nav })) as never
    expect(await resolveDeepLinkTarget('rox://messenger', { timeoutMs: 5 })).toBeNull()
    expect(isSurfaceGateLatched()).toBe(true)

    // Late push: flags apply (an open root parses at once), latch stays.
    applyUnifiedSurfaceRoutes(['messenger'])
    await tick()
    expect(sent).toEqual([])
    expect(isSurfaceGateLatched()).toBe(true)
    expect(isSurfaceGateReceived()).toBe(true)
    expect((await resolveDeepLinkTarget('rox://messenger'))?.view).toBe('messenger')

    // Turning the flag off again rejects at once — nothing waits, nothing re-queues.
    applyUnifiedSurfaceRoutes([])
    const start = Date.now()
    const result = await handleDeepLink('rox://messenger', windowManager, sink)
    expect(Date.now() - start).toBeLessThan(1_000)
    expect(result.success).toBe(false)
    expect(sent).toEqual([])
    expect(isSurfaceGateLatched()).toBe(true)
  })
})
