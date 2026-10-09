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
  // Delivery goes through the window-manager relay: the typed RPC event sink
  // when the client is known, and its own pre-handshake fallback otherwise —
  // never a second copy of that logic here (`scripts/check-raw-sends.sh`).
  windowManager.pushToWindow(window, RPC_CHANNELS.shell.ACTION, payload)
  return true
}