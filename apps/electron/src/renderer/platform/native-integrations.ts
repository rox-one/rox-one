/**
 * Renderer bridge to the frozen native-integration IPC surface: the quick
 * composer window, "launch at login", Finder/QuickLook/drag file actions and
 * the main-process `shell:action` event.
 *
 * The main-process preload may not expose every member on a given build (e.g.
 * the browser-served Web UI), so each is optional here and every consumer
 * degrades gracefully (hide/disable the control) when a channel is absent.
 * This is the single place that names the `window.electronAPI` members, so a
 * naming change touches one file.
 */

import type { ShellActionPayload } from '@rox/shared/protocol'

export type { ShellActionPayload }

export interface LoginItemState {
  openAtLogin: boolean
  supported: boolean
}

export interface StartDragInput {
  path: string
  iconPath?: string
}

export interface QuickComposerBridge {
  open?: () => void | Promise<void>
  close?: () => void | Promise<void>
  getShortcut?: () => Promise<string | null>
  setShortcut?: (accelerator: string | null) => Promise<void>
}

export interface AppIntegrationBridge {
  getLoginItem?: () => Promise<LoginItemState>
  setLoginItem?: (input: { openAtLogin: boolean }) => Promise<unknown>
}

export interface NativeIntegrationsBridge {
  quickComposer?: QuickComposerBridge
  appIntegration?: AppIntegrationBridge
  revealInFinder?: (path: string) => Promise<void> | void
  openPath?: (path: string) => Promise<void> | void
  copyPath?: (path: string) => Promise<void> | void
  quickLook?: (path: string) => Promise<void> | void
  quickLookClose?: () => Promise<void> | void
  startDrag?: (input: StartDragInput) => Promise<void> | void
  onShellAction?: (callback: (action: ShellActionPayload) => void) => () => void
}

/** Default accelerator applied when the quick composer is switched on. */
export const DEFAULT_QUICK_COMPOSER_ACCELERATOR = 'CommandOrControl+Shift+Space'

function fn<T>(value: unknown): T | undefined {
  return typeof value === 'function' ? (value as T) : undefined
}

function namespace(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined
}

export function nativeIntegrations(): NativeIntegrationsBridge {
  if (typeof window === 'undefined') return {}
  const api = namespace(window.electronAPI)
  if (!api) return {}
  const quick = namespace(api.quickComposer)
  const integration = namespace(api.appIntegration)
  return {
    quickComposer: quick
      ? {
          open: fn(quick.open),
          close: fn(quick.close),
          getShortcut: fn(quick.getShortcut),
          setShortcut: fn(quick.setShortcut),
        }
      : undefined,
    appIntegration: integration
      ? {
          getLoginItem: fn(integration.getLoginItem),
          setLoginItem: fn(integration.setLoginItem),
        }
      : undefined,
    revealInFinder: fn(api.revealInFinder),
    openPath: fn(api.openPath),
    copyPath: fn(api.copyPath),
    quickLook: fn(api.quickLook),
    quickLookClose: fn(api.quickLookClose),
    startDrag: fn(api.startDrag),
    onShellAction: fn(api.onShellAction),
  }
}