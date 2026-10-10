import { describe, expect, it, mock } from 'bun:test'
// NOTE: this file installs a PROCESS-GLOBAL `electron` mock via `mock.module`.
// It must not share a single `bun test` invocation with another file that mocks
// `electron` differently (bun caches the first mock across files) — the repo's
// gate script runs such files in separate groups for this reason.
import {
  ROX_DESKTOP_BRIDGE_CHANNEL,
  ROX_DESKTOP_BRIDGE_METHODS,
  ROX_DESKTOP_BRIDGE_VERSION,
} from '@rox/shared/desktop-bridge/contract'
import { createControlUiWindowOptions, type IsolatedSession } from '../openclaw-host-control'
import { createDesktopBridgeHandlers, dispatchDesktopBridgeRequest } from '../desktop-bridge'

// The preload module imports `electron`, which does not resolve outside the
// Electron runtime. A static import would be evaluated before `mock.module`
// registers the stub, so these two suites load it via `await import()` after
// the mock — a deliberate module-loading-boundary test.
mock.module('electron', () => ({
  contextBridge: { exposeInMainWorld: () => {} },
  ipcRenderer: { invoke: async () => undefined },
}))

const FAKE_PRELOAD = '/app/dist/rox-desktop-preload.cjs'
const fakeSession = {} as unknown as IsolatedSession

function createStubDeps() {
  const notified: Array<{ title: string; body?: string }> = []
  const openedUrls: string[] = []
  return {
    notified,
    openedUrls,
    deps: {
      browser: {
        openInstance: async () => 'browser-1',
        navigateInstance: async () => ({ url: 'https://example.invalid/', title: 'Example' }),
        releaseScope: async () => ({ released: ['browser-1'] }),
      },
      permissions: { probePermissions: async () => ({ platform: 'darwin', statuses: {} }) },
      openExternal: async (url: string) => {
        openedUrls.push(url)
      },
      gateway: { getStatus: async () => ({ phase: 'ready' }) },
      notify: (params: { title: string; body?: string }) => {
        notified.push(params)
      },
    },
  }
}

describe('desktop bridge handler map', () => {
  it('matches the contract registry exactly (no drift)', () => {
    const { deps } = createStubDeps()
    const handlers = createDesktopBridgeHandlers(deps)
    expect(Object.keys(handlers).sort()).toEqual([...ROX_DESKTOP_BRIDGE_METHODS].sort())
  })

  it('dispatches a validated call and refuses unknown methods and foreign versions typed', async () => {
    const { deps } = createStubDeps()

    await expect(dispatchDesktopBridgeRequest(deps, { v: 1, method: 'app.openLink', params: { url: 'https://example.invalid/' } }))
      .resolves.toEqual({ ok: true, result: { opened: true } })

    const unknown = await dispatchDesktopBridgeRequest(deps, { v: 1, method: 'browser.not-real' })
    expect(unknown).toMatchObject({ ok: false, code: 'ROX_DESKTOP_BRIDGE_UNKNOWN_METHOD', method: 'browser.not-real' })

    const wrongVersion = await dispatchDesktopBridgeRequest(deps, { v: 2, method: 'app.openLink' })
    expect(wrongVersion).toMatchObject({
      ok: false,
      code: 'ROX_DESKTOP_BRIDGE_VERSION_MISMATCH',
      expectedVersion: ROX_DESKTOP_BRIDGE_VERSION,
      receivedVersion: 2,
    })
  })

  it('turns a failing handler into a typed refusal instead of throwing across IPC', async () => {
    const { deps } = createStubDeps()
    deps.openExternal = async () => {
      throw new Error('no shell')
    }
    const result = await dispatchDesktopBridgeRequest(deps, { v: 1, method: 'app.openLink', params: { url: 'https://x.invalid/' } })
    expect(result).toMatchObject({ ok: false, code: 'ROX_DESKTOP_BRIDGE_HANDLER_FAILED', method: 'app.openLink' })
  })
})

describe('desktop bridge preload gate', () => {
  it('refuses an unknown method or a foreign version before any IPC is sent', async () => {
    const { createRoxDesktopBridge } = await import('../../preload/rox-desktop')
    const calls: unknown[][] = []
    const bridge = createRoxDesktopBridge({
      invoke: async (channel, ...args) => {
        calls.push([channel, ...args])
        return { ok: true, result: 'forwarded' }
      },
      expose: () => {},
    })

    expect(await bridge.call({ v: 1, method: 'browser.nope' })).toMatchObject({
      ok: false,
      code: 'ROX_DESKTOP_BRIDGE_UNKNOWN_METHOD',
      method: 'browser.nope',
    })
    expect(await bridge.call({ v: 2, method: 'app.openLink' })).toMatchObject({
      ok: false,
      code: 'ROX_DESKTOP_BRIDGE_VERSION_MISMATCH',
    })
    expect(calls).toEqual([])

    const request = { v: ROX_DESKTOP_BRIDGE_VERSION, method: 'app.openLink', params: { url: 'https://example.invalid/' } } as const
    expect(await bridge.call(request)).toEqual({ ok: true, result: 'forwarded' })
    expect(calls).toEqual([[ROX_DESKTOP_BRIDGE_CHANNEL, request]])
  })

  it('exposes the world key through the install seam', async () => {
    const { installRoxDesktopBridge } = await import('../../preload/rox-desktop')
    const exposed = new Map<string, unknown>()
    installRoxDesktopBridge({
      invoke: async () => ({ ok: true, result: null }),
      expose: (key, api) => exposed.set(key, api),
    })
    expect(exposed.has('roxDesktop')).toBe(true)
  })
})

describe('Control-UI window options install the embedded bridge preload', () => {
  it('attaches the desktop preload on the Control-UI host', () => {
    const options = createControlUiWindowOptions(fakeSession, { isClientOnly: false, preloadPath: FAKE_PRELOAD })
    expect(options.webPreferences.preload).toBe(FAKE_PRELOAD)
    expect(options.webPreferences).toMatchObject({ contextIsolation: true, sandbox: true, nodeIntegration: false })
  })

  it('never attaches the preload in client-only mode or when no bridge is configured', () => {
    const clientOnly = createControlUiWindowOptions(fakeSession, { isClientOnly: true, preloadPath: FAKE_PRELOAD })
    expect(clientOnly.webPreferences.preload).toBeUndefined()

    const noBridge = createControlUiWindowOptions(fakeSession)
    expect(noBridge.webPreferences.preload).toBeUndefined()
  })
})