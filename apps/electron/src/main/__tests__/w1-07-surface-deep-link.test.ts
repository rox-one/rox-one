/**
 * W1-07 (#1504): mode-root deep links (rox://messenger, …) follow their own
 * mode flag in the main process; the gate is pushed from the renderer over
 * IPC and is default-closed.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { parseDeepLink } from '../deep-link'
import { SURFACE_ROUTES_IPC_CHANNEL, applyUnifiedSurfaceRoutes, registerSurfaceRoutesIpc } from '../surface-routes-ipc'
import { resetEntityRoutesEnabled, setEntityRoutesEnabled } from '../../shared/route-parser'
import { isClosedUnifiedSurfaceRoot, isUnifiedSurfaceRouteEnabled, resetUnifiedSurfaceRoutes } from '../../shared/surface-routes'

afterEach(() => {
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
    const preload = await Bun.file(new URL('../../preload/bootstrap.ts', import.meta.url)).text()
    expect(preload).toContain(`ipcRenderer.invoke('${SURFACE_ROUTES_IPC_CHANNEL}', ids)`)
  })
})
