import { safeHttpUrl } from './registry'

/** Open an http(s) link in the system browser; anything else is ignored. */
export function openExternalSafe(url: string): void {
  const safe = safeHttpUrl(url)
  if (!safe) return
  void window.electronAPI?.openUrl?.(safe)
}
