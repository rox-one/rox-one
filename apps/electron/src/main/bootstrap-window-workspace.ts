import type { IpcMainEvent } from 'electron'
import type { WindowManager } from './window-manager'

/** Window-local bootstrap metadata is available only to its live main frame. */
export function readBoundWindowWorkspace(
  event: Pick<IpcMainEvent, 'sender' | 'senderFrame'>,
  manager: Pick<WindowManager, 'getWindowByWebContentsId' | 'getWorkspaceForWindow'> | null | undefined,
): string {
  const owner = manager?.getWindowByWebContentsId(event.sender.id)
  if (!owner || owner.isDestroyed() || event.sender.isDestroyed()
    || owner.webContents !== event.sender) return ''
  // Preload bootstrap runs before the main frame is always observable; a null
  // senderFrame is normal there. Reject only explicit subframes.
  const frame = event.senderFrame
  if (frame && frame !== event.sender.mainFrame) return ''
  return manager?.getWorkspaceForWindow(event.sender.id) ?? ''
}
