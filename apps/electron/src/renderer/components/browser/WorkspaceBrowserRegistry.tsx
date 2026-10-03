import { useWorkspaceBrowserWindows } from './use-workspace-browser-windows'

/** Keep IPC state alive when shell chrome does not mount BrowserTabStrip. */
export function WorkspaceBrowserRegistry({ enabled = true }: { enabled?: boolean }) {
  useWorkspaceBrowserWindows({ enabled })
  return null
}
