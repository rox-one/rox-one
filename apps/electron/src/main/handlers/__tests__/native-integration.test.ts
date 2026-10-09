import { describe, expect, it, mock } from 'bun:test'

import { RPC_CHANNELS } from '@rox/shared/protocol'
import type { HandlerFn, RequestContext, RpcHandlerOptions, RpcServer } from '@rox/server-core/transport'
import type { BrowserWindow } from 'electron'

import { electronMockExports } from '../../__tests__/electron-mock-exports'
import type { HandlerDeps } from '../handler-deps'
import type { QuickComposerDeps } from '../../quick-composer'

mock.module('electron', () => ({
  ...electronMockExports,
  // Dev-mode login item: app is not packaged, so writes must be refused.
  app: {
    ...electronMockExports.app,
    isPackaged: false,
    getLoginItemSettings: () => ({ openAtLogin: false }),
    setLoginItemSettings: () => {},
  },
}))

const { HANDLED_CHANNELS, registerNativeIntegrationHandlers } = await import('../native-integration')
const { initQuickComposer, disposeQuickComposer } = await import('../../quick-composer')

interface RecordingServer {
  server: RpcServer
  handlers: Map<string, HandlerFn>
  registrations: Map<string, RpcHandlerOptions | undefined>
}

function createRecordingServer(): RecordingServer {
  const handlers = new Map<string, HandlerFn>()
  const registrations = new Map<string, RpcHandlerOptions | undefined>()
  const server: RpcServer = {
    handle(channel, handler, options) {
      registrations.set(channel, options)
      handlers.set(channel, handler)
    },
    push() {},
    async invokeClient() { return undefined },
    hasClientCapability() { return false },
    findClientsWithCapability() { return [] },
  }
  return { server, handlers, registrations }
}

function emptyCtx(): RequestContext {
  return { clientId: 'test-client', workspaceId: null, webContentsId: null }
}

function createDeps(): HandlerDeps {
  return { windowManager: {} } as unknown as HandlerDeps
}

function createQuickComposerDeps(): QuickComposerDeps {
  const fakeWindow = {
    webContents: { id: 1 },
    isDestroyed: () => false,
    isMinimized: () => false,
    restore: () => {},
    show: () => {},
    focus: () => {},
    destroy: () => {},
    once: () => {},
    loadURL: async () => {},
    loadFile: async () => {},
    setVibrancy: () => {},
    setVisualEffectState: () => {},
    setWindowButtonVisibility: () => {},
  }
  // The fake implements only the BrowserWindow members the controller touches.
  const window = fakeWindow as unknown as BrowserWindow
  return {
    createWindow: () => window,
    registerAuxiliaryWindow: () => {},
    shortcuts: { register: () => true, unregister: () => {} },
    readShortcut: () => 'Alt+Space',
    writeShortcut: () => {},
    resolveWorkspaceId: () => 'workspace-1',
    isMac: true,
    prefersSolid: () => false,
  }
}

describe('native integration handler profile', () => {
  it('registers exactly the declared channels', () => {
    const recorder = createRecordingServer()
    registerNativeIntegrationHandlers(recorder.server, createDeps())
    expect([...recorder.handlers.keys()]).toEqual([...HANDLED_CHANNELS])
    expect(recorder.registrations.get(RPC_CHANNELS.quickComposer.OPEN)).toBeUndefined()
  })

  it('reports UNAVAILABLE for the composer before startup wiring', async () => {
    const recorder = createRecordingServer()
    registerNativeIntegrationHandlers(recorder.server, createDeps())

    const open = await recorder.handlers.get(RPC_CHANNELS.quickComposer.OPEN)!(emptyCtx())
    expect(open).toEqual({ ok: false, error: 'UNAVAILABLE' })
    const shortcut = await recorder.handlers.get(RPC_CHANNELS.quickComposer.GET_SHORTCUT)!(emptyCtx())
    expect(shortcut).toBeNull()
  })

  it('rejects non-absolute file paths without throwing', async () => {
    const recorder = createRecordingServer()
    registerNativeIntegrationHandlers(recorder.server, createDeps())

    const relative = await recorder.handlers.get(RPC_CHANNELS.files.REVEAL_IN_FINDER)!(emptyCtx(), 'relative/path.txt')
    expect(relative).toEqual({ ok: false, error: 'INVALID_PATH' })
    const empty = await recorder.handlers.get(RPC_CHANNELS.files.COPY_PATH)!(emptyCtx(), '')
    expect(empty).toEqual({ ok: false, error: 'INVALID_PATH' })
    const notString = await recorder.handlers.get(RPC_CHANNELS.files.OPEN_PATH)!(emptyCtx(), 42)
    expect(notString).toEqual({ ok: false, error: 'INVALID_PATH' })
  })

  it('reports drag unavailable without a requesting window', async () => {
    const recorder = createRecordingServer()
    registerNativeIntegrationHandlers(recorder.server, createDeps())
    const result = await recorder.handlers.get(RPC_CHANNELS.files.START_DRAG)!(emptyCtx(), { path: '/tmp/x.png' })
    expect(result).toEqual({ ok: false, error: 'WINDOW_UNAVAILABLE' })
  })

  it('never writes a login item from an unpackaged build', async () => {
    const recorder = createRecordingServer()
    registerNativeIntegrationHandlers(recorder.server, createDeps())

    const status = await recorder.handlers.get(RPC_CHANNELS.appIntegration.GET_LOGIN_ITEM)!(emptyCtx())
    expect(status).toEqual({ openAtLogin: false, supported: false })

    const write = await recorder.handlers.get(RPC_CHANNELS.appIntegration.SET_LOGIN_ITEM)!(emptyCtx(), { openAtLogin: true })
    expect(write).toEqual({ ok: false, openAtLogin: false, error: 'UNSUPPORTED' })
  })

  it('serves the composer handlers once a controller is wired', async () => {
    const recorder = createRecordingServer()
    registerNativeIntegrationHandlers(recorder.server, createDeps())
    initQuickComposer(createQuickComposerDeps())
    try {
      const shortcut = await recorder.handlers.get(RPC_CHANNELS.quickComposer.GET_SHORTCUT)!(emptyCtx())
      expect(shortcut).toBe('Alt+Space')

      const open = await recorder.handlers.get(RPC_CHANNELS.quickComposer.OPEN)!(emptyCtx())
      expect(open).toEqual({ ok: true })

      const set = await recorder.handlers.get(RPC_CHANNELS.quickComposer.SET_SHORTCUT)!(emptyCtx(), 'Cmd+Shift+Space')
      expect(set).toEqual({ ok: true, accelerator: 'Cmd+Shift+Space' })
    } finally {
      disposeQuickComposer()
    }
  })
})