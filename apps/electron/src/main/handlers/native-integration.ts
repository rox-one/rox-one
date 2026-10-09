/**
 * Native integration GUI handlers — quick composer, OS login item and the
 * Finder/filesystem affordances. All channels are LOCAL_ONLY (see routing.ts):
 * they touch the host window, the host OS and the host filesystem.
 */

import { app, webContents as electronWebContents } from 'electron'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import type { RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from './handler-deps'
import { getQuickComposerController } from '../quick-composer'
import {
  closeQuickLookPath,
  copyPath,
  openPath,
  quickLookPath,
  revealInFinder,
  startDrag,
} from '../files-actions'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.quickComposer.OPEN,
  RPC_CHANNELS.quickComposer.CLOSE,
  RPC_CHANNELS.quickComposer.GET_SHORTCUT,
  RPC_CHANNELS.quickComposer.SET_SHORTCUT,
  RPC_CHANNELS.appIntegration.GET_LOGIN_ITEM,
  RPC_CHANNELS.appIntegration.SET_LOGIN_ITEM,
  RPC_CHANNELS.files.REVEAL_IN_FINDER,
  RPC_CHANNELS.files.OPEN_PATH,
  RPC_CHANNELS.files.COPY_PATH,
  RPC_CHANNELS.files.QUICK_LOOK,
  RPC_CHANNELS.files.QUICK_LOOK_CLOSE,
  RPC_CHANNELS.files.START_DRAG,
] as const

const LOGIN_ITEM_PLATFORM_SUPPORTED = process.platform === 'darwin' || process.platform === 'win32'

/** Accepts the positional accelerator and (defensively) a `{ accelerator }` object. */
function readAcceleratorInput(input: unknown): { value: string | null } | { error: string } {
  if (input === null || input === undefined) return { value: null }
  if (typeof input === 'string') return { value: input }
  if (typeof input === 'object' && 'accelerator' in input) {
    const accelerator = input.accelerator
    if (accelerator === null || typeof accelerator === 'string') return { value: accelerator }
  }
  return { error: 'INVALID_ACCELERATOR' }
}

function readOpenAtLogin(input: unknown): boolean | null {
  if (typeof input === 'boolean') return input
  if (typeof input === 'object' && input !== null && 'openAtLogin' in input) {
    const value = input.openAtLogin
    return typeof value === 'boolean' ? value : null
  }
  return null
}

export function registerNativeIntegrationHandlers(server: RpcServer, deps: HandlerDeps): void {
  const windowManager = deps.windowManager

  server.handle(RPC_CHANNELS.quickComposer.OPEN, async (ctx) => {
    const controller = getQuickComposerController()
    if (!controller) return { ok: false, error: 'UNAVAILABLE' }
    const workspaceId = ctx.workspaceId
      ?? (ctx.webContentsId != null ? windowManager?.getWorkspaceForWindow(ctx.webContentsId) : null)
    return controller.open(workspaceId ?? null)
  })

  server.handle(RPC_CHANNELS.quickComposer.CLOSE, async () => {
    const controller = getQuickComposerController()
    if (!controller) return { ok: false, error: 'UNAVAILABLE' }
    return controller.close()
  })

  server.handle(RPC_CHANNELS.quickComposer.GET_SHORTCUT, async () => {
    return getQuickComposerController()?.getShortcut() ?? null
  })

  server.handle(RPC_CHANNELS.quickComposer.SET_SHORTCUT, async (_ctx, input: unknown) => {
    const controller = getQuickComposerController()
    if (!controller) return { ok: false, error: 'UNAVAILABLE' }
    const parsed = readAcceleratorInput(input)
    if ('error' in parsed) return { ok: false, error: parsed.error }
    return controller.setShortcut(parsed.value)
  })

  server.handle(RPC_CHANNELS.appIntegration.GET_LOGIN_ITEM, async () => ({
    openAtLogin: app.getLoginItemSettings().openAtLogin,
    supported: app.isPackaged && LOGIN_ITEM_PLATFORM_SUPPORTED,
  }))

  server.handle(RPC_CHANNELS.appIntegration.SET_LOGIN_ITEM, async (_ctx, input: unknown) => {
    const openAtLogin = readOpenAtLogin(input)
    if (openAtLogin === null) {
      return { ok: false, openAtLogin: app.getLoginItemSettings().openAtLogin, error: 'INVALID_INPUT' }
    }
    // Dev builds must never register the Electron helper as a login item.
    if (!app.isPackaged || !LOGIN_ITEM_PLATFORM_SUPPORTED) {
      return { ok: false, openAtLogin: app.getLoginItemSettings().openAtLogin, error: 'UNSUPPORTED' }
    }
    app.setLoginItemSettings({ openAtLogin })
    return { ok: true, openAtLogin: app.getLoginItemSettings().openAtLogin }
  })

  server.handle(RPC_CHANNELS.files.REVEAL_IN_FINDER, async (_ctx, path: unknown) => revealInFinder(path))
  server.handle(RPC_CHANNELS.files.OPEN_PATH, async (_ctx, path: unknown) => openPath(path))
  server.handle(RPC_CHANNELS.files.COPY_PATH, async (_ctx, path: unknown) => copyPath(path))
  server.handle(RPC_CHANNELS.files.QUICK_LOOK, async (_ctx, path: unknown) => quickLookPath(path))
  server.handle(RPC_CHANNELS.files.QUICK_LOOK_CLOSE, async () => closeQuickLookPath())
  server.handle(RPC_CHANNELS.files.START_DRAG, async (ctx, input: unknown) => {
    const target = ctx.webContentsId != null ? electronWebContents.fromId(ctx.webContentsId) : undefined
    return startDrag(target ?? null, input)
  })
}