import { useEffect } from 'react'
import type { ZenShellSnapshot } from '../../shared/shell-appearance'
import { readDesktopAppearance } from '@/lib/desktop-appearance'

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
 * The web adapter conveys no desktop shell capability.
 */
export function useShellAppearance(): void {
  useEffect(() => {
    const api = typeof window === 'undefined' ? undefined : window.electronAPI
    if (!api?.getShellSnapshot || api.getRuntimeEnvironment?.() !== 'electron') return undefined

    let cancelled = false
    const cancelRead = readDesktopAppearance(api, () => api.getShellSnapshot(), snapshot => {
      if (!cancelled && snapshot) applySnapshot(snapshot)
    }, error => { if (error) console.warn('Desktop shell appearance unavailable:', error) })
    const unsubscribe = api.onShellChanged?.((snapshot) => {
      if (!cancelled) applySnapshot(snapshot)
    })
    return () => {
      cancelled = true
      cancelRead()
      unsubscribe?.()
    }
  }, [])
}
