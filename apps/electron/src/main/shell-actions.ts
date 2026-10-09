/**
 * Native shell affordance dispatcher.
 *
 * Dock menu, tray and notification-click actions all resolve to one structured
 * `shell:action` payload delivered to the focused (or, when the app is in the
 * background, the last-active) window. Delivery goes through the RPC event sink
 * so it follows the same path as the application menu — never a raw push to an
 * arbitrary webContents.
 */

import { RPC_CHANNELS } from '../shared/types'
import type { ShellActionPayload } from '../shared/types'
import type { WindowManager } from './window-manager'

export function dispatchShellAction(
  windowManager: WindowManager | null | undefined,
  payload: ShellActionPayload,
): boolean {
  if (!windowManager) return false
  const window = windowManager.getFocusedWindow() ?? windowManager.getLastActiveWindow()
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return false
  const sink = windowManager.getRpcEventSink()
  const clientId = windowManager.getClientIdForWindow(window.webContents.id)
  if (sink && clientId) {
    sink(RPC_CHANNELS.shell.ACTION, { to: 'client', clientId }, payload)
    return true
  }
  // No RPC client (e.g. before the server handshake settled) — fall back to the
  // window's own webContents, mirroring WindowManager.pushToWindow.
  window.webContents.send(RPC_CHANNELS.shell.ACTION, payload)
  return true
}