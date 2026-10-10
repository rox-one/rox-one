/**
 * Embedded-surface desktop bridge preload (`window.roxDesktop`).
 *
 * This preload is installed ONLY on the host-side Control-UI window. The main
 * app shell keeps using `bootstrap-preload.cjs`, and thin-client
 * (`CRAFT_SERVER_URL`) mode never creates the Control-UI window at all, so the
 * bridge object is absent there by construction.
 *
 * Every call carries an explicit `{ v }` handshake. The shared contract
 * validator runs here first: an unknown method or a non-current revision is
 * refused with a typed refusal BEFORE any IPC leaves the renderer.
 */

import { contextBridge, ipcRenderer } from 'electron'
import {
  ROX_DESKTOP_BRIDGE_CHANNEL,
  ROX_DESKTOP_BRIDGE_VERSION,
  ROX_DESKTOP_BRIDGE_WORLD_KEY,
  validateRoxDesktopBridgeRequest,
  type RoxDesktopBridgeRequest,
  type RoxDesktopBridgeResponse,
} from '@rox/shared/desktop-bridge/contract'

export interface RoxDesktopBridgeApi {
  /** The protocol revision this preload speaks; callers send it back in `{ v }`. */
  readonly version: number
  call(request: RoxDesktopBridgeRequest): Promise<RoxDesktopBridgeResponse>
}

export interface RoxDesktopBridgeInstallOptions {
  readonly invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
  readonly expose: (key: string, api: unknown) => void
}

/**
 * Builds the frozen bridge object. Pure and side-effect free so the version and
 * method gates can be exercised without an Electron runtime.
 */
export function createRoxDesktopBridge(options: RoxDesktopBridgeInstallOptions): RoxDesktopBridgeApi {
  return Object.freeze({
    version: ROX_DESKTOP_BRIDGE_VERSION,
    async call(request: RoxDesktopBridgeRequest): Promise<RoxDesktopBridgeResponse> {
      const validation = validateRoxDesktopBridgeRequest(request)
      // Refuse before IPC: the main process must never see an unknown method or
      // a foreign revision from this surface.
      if (!validation.ok) return validation
      return (await options.invoke(ROX_DESKTOP_BRIDGE_CHANNEL, request)) as RoxDesktopBridgeResponse
    },
  })
}

/** Exposes the bridge on `window[ROX_DESKTOP_BRIDGE_WORLD_KEY]`. */
export function installRoxDesktopBridge(options: RoxDesktopBridgeInstallOptions): RoxDesktopBridgeApi {
  const api = createRoxDesktopBridge(options)
  options.expose(ROX_DESKTOP_BRIDGE_WORLD_KEY, api)
  return api
}

if (process.isMainFrame) {
  installRoxDesktopBridge({
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    expose: (key, api) => contextBridge.exposeInMainWorld(key, api),
  })
}