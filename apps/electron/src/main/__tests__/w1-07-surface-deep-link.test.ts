/**
 * W1-07 (#1504): mode-root deep links (rox://messenger, …) follow their own
 * mode flag in the main process; the gate is pushed from the renderer over
 * IPC and is default-closed.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { handleDeepLink, isClosedSurfaceRootDeepLink, parseDeepLink, resolveDeepLinkTarget } from '../deep-link'
import {
  SURFACE_ROUTES_IPC_CHANNEL,
  __resetSurfaceGateForTests,
  applyUnifiedSurfaceRoutes,
  isSurfaceGateReceived,
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

  it('wiring: handleDeepLink and the initial-window path use resolveDeepLinkTarget', () => {
    const src = (file: string) => readFileSync(join(import.meta.dir, '..', file), 'utf8')
    expect(src('deep-link.ts')).toContain('const target = await resolveDeepLinkTarget(url)')
    expect(src('window-manager.ts')).toContain('await resolveDeepLinkTarget(initialDeepLink)')
    expect(src('index.ts')).toContain('await handleDeepLink(pendingDeepLink')
  })
})
