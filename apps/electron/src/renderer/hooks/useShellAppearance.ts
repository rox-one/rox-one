import { useEffect } from 'react'
import type { ZenShellSnapshot } from '../../../shared/shell-appearance'

function applySnapshot(snapshot: ZenShellSnapshot): void {
  const root = document.documentElement
  if (snapshot.enabled) {
    root.setAttribute('data-shell-style', 'zen')
    root.setAttribute('data-shell-material', snapshot.material)
  } else {
    if (root.getAttribute('data-shell-style') === 'zen') {
      root.removeAttribute('data-shell-style')
    }
    root.removeAttribute('data-shell-material')
  }
}

/**
 * Applies the main-owned Zen Shell snapshot to <html>.
 * Web UI never calls Electron APIs — missing electronAPI is a no-op.
 */
export function useShellAppearance(): void {
  useEffect(() => {
    const api = typeof window === 'undefined' ? undefined : window.electronAPI
    if (!api?.getShellSnapshot) return undefined

    let cancelled = false
    void api.getShellSnapshot().then((snapshot) => {
      if (!cancelled && snapshot) applySnapshot(snapshot)
    })
    const unsubscribe = api.onShellChanged?.((snapshot) => {
      if (!cancelled) applySnapshot(snapshot)
    })
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [])
}
