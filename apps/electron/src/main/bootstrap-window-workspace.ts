import type { IpcMainEvent } from 'electron'
import type { WindowManager } from './window-manager'

/** Window-local bootstrap metadata is available only to its live main frame. */
export function readBoundWindowWorkspace(
  event: Pick<IpcMainEvent, 'sender' | 'senderFrame'>,
  manager: Pick<WindowManager, 'getWindowByWebContentsId' | 'getWorkspaceForWindow'> | null | undefined,
): string {
  const owner = manager?.getWindowByWebContentsId(event.sender.id)
  if (!owner || owner.isDestroyed() || event.sender.isDestroyed()
    || owner.webContents !== event.sender || event.senderFrame !== event.sender.mainFrame) return ''
  return manager?.getWorkspaceForWindow(event.sender.id) ?? ''
}
