import { BrowserWindow } from 'electron'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import type { UiAppearanceSnapshot } from '@rox/shared/protocol'
import { pushTyped, type RpcServer } from '@rox/server-core/transport'
import { getUiPreferences, setUiPreferences, setRenderProfilePreference, setZenShellPreference } from '@rox/shared/config'
import { parseZenShellPatch } from '../../shared/shell-appearance'
import { peekZenShellSnapshotForWindow, reapplyZenShellOnAllWindows } from '../shell-material'
import { attachSystemAccentSubscription, broadcastSystemAccent, readSystemAccent } from '../system-accent'
import type { HandlerDeps } from './handler-deps'

export const GUI_HANDLED_CHANNELS = [
  RPC_CHANNELS.power.SET_KEEP_AWAKE,
  RPC_CHANNELS.settings.SET_NETWORK_PROXY,
  RPC_CHANNELS.appearance.SET_DEFAULT_ZOOM_LEVEL,
  RPC_CHANNELS.appearance.GET_SHELL_SNAPSHOT,
  RPC_CHANNELS.appearance.SET_ZEN_SHELL,
  RPC_CHANNELS.appearance.GET_UI_PREFERENCES,
  RPC_CHANNELS.appearance.SET_UI_PREFERENCES,
] as const

// ============================================================
// GUI-only settings (require Electron-specific APIs)
// ============================================================

export function registerSettingsGuiHandlers(server: RpcServer, deps: HandlerDeps): void {
  // Set keep awake while running setting (requires Electron power-manager)
  server.handle(RPC_CHANNELS.power.SET_KEEP_AWAKE, async (_ctx, enabled: boolean) => {
    const { setKeepAwakeWhileRunning } = await import('@rox/shared/config/storage')
    const { setKeepAwakeSetting } = await import('../power-manager')
    // Save to config
    setKeepAwakeWhileRunning(enabled)
    // Update the power manager's cached value and power state
    setKeepAwakeSetting(enabled)
  })

  // Set network proxy settings (requires Electron session proxy)
  server.handle(RPC_CHANNELS.settings.SET_NETWORK_PROXY, async (_ctx, settings: import('@rox/shared/config/types').NetworkProxySettings) => {
    const { updateConfiguredProxySettings } = await import('../network-proxy')
    await updateConfiguredProxySettings(settings)
  })

  // Set default zoom level and apply immediately to all open Electron windows
  server.handle(RPC_CHANNELS.appearance.SET_DEFAULT_ZOOM_LEVEL, async (_ctx, level: number) => {
    const { setDefaultZoomLevel, getDefaultZoomLevel } = await import('@rox/shared/config/storage')
    setDefaultZoomLevel(level)
    const zoomFactor = getDefaultZoomLevel() / 100
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
        win.webContents.setZoomFactor(zoomFactor)
      }
    }
  })

  server.handle(RPC_CHANNELS.appearance.GET_SHELL_SNAPSHOT, async ctx => {
    return peekZenShellSnapshotForWindow(deps.windowManager?.getWindowByWebContentsId(ctx.webContentsId!))
  })

  server.handle(RPC_CHANNELS.appearance.SET_ZEN_SHELL, async (ctx, raw: unknown) => {
    const { renderProfile, ...shellPatch } = parseZenShellPatch(raw)
    // A low-power-only patch must not pin Zen defaults or write twice.
    if (Object.keys(shellPatch).length > 0) setZenShellPreference(shellPatch)
    // PERF-07: the low-power toggle persists here and ships in the same snapshot.
    if (renderProfile !== undefined) setRenderProfilePreference(renderProfile)
    reapplyZenShellOnAllWindows()
    // Paint and GPU state can differ between windows; publish each actual state.
    for (const window of BrowserWindow.getAllWindows()) {
      const clientId = deps.windowManager?.getClientIdForWindow(window.webContents.id)
      if (clientId) pushTyped(server, RPC_CHANNELS.appearance.SHELL_CHANGED, { to: 'client', clientId }, peekZenShellSnapshotForWindow(window))
    }
    return peekZenShellSnapshotForWindow(deps.windowManager?.getWindowByWebContentsId(ctx.webContentsId!))
  })

  // A6 + B10 — persisted «Интерфейс» prefs + the live macOS accent. One
  // process-level subscription drives the ACCENT_CHANGED push.
  attachSystemAccentSubscription(server)
  server.handle(RPC_CHANNELS.appearance.GET_UI_PREFERENCES, async (): Promise<UiAppearanceSnapshot> => {
    return { ...getUiPreferences(), accent: readSystemAccent() }
  })
  server.handle(RPC_CHANNELS.appearance.SET_UI_PREFERENCES, async (_ctx, patch: unknown): Promise<UiAppearanceSnapshot> => {
    const next = patch && typeof patch === 'object' ? patch as Record<string, unknown> : {}
    const statusBarVisible = typeof next.statusBarVisible === 'boolean' ? next.statusBarVisible : undefined
    const accentSource = next.accentSource === 'brand' || next.accentSource === 'system' ? next.accentSource : undefined
    setUiPreferences({ statusBarVisible, accentSource })
    // A switched accent source must repaint every window immediately.
    if (accentSource !== undefined) broadcastSystemAccent()
    return { ...getUiPreferences(), accent: readSystemAccent() }
  })
}
