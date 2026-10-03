import type { ElectronAPI } from '../../shared/types'
import type { ZenShellSnapshot } from '../../shared/shell-appearance'
import { readDesktopAppearance } from './desktop-appearance'

type ShellAppearanceAPI = Pick<ElectronAPI, 'getRuntimeEnvironment' | 'getShellSnapshot' | 'onShellChanged'>

/** A live policy/paint event supersedes an older, in-flight initial read. */
export function subscribeDesktopShellAppearance(
  api: ShellAppearanceAPI | undefined,
  onSnapshot: (snapshot: ZenShellSnapshot) => void,
  onUnavailable: (error?: unknown) => void,
): () => void {
  if (!api?.getShellSnapshot || api.getRuntimeEnvironment?.() !== 'electron') return () => {}
  let cancelled = false
  let receivedLiveSnapshot = false
  const unsubscribe = api.onShellChanged?.(snapshot => {
    receivedLiveSnapshot = true
    if (!cancelled) onSnapshot(snapshot)
  })
  const cancelRead = readDesktopAppearance(api, () => api.getShellSnapshot(), snapshot => {
    if (!cancelled && !receivedLiveSnapshot && snapshot) onSnapshot(snapshot)
  }, error => {
    if (!cancelled && !receivedLiveSnapshot) onUnavailable(error)
  })
  return () => {
    cancelled = true
    cancelRead()
    unsubscribe?.()
  }
}
