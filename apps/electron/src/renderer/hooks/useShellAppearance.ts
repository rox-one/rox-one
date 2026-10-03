import { useEffect } from 'react'
import type { ZenShellSnapshot } from '../../shared/shell-appearance'
import { subscribeDesktopShellAppearance } from '@/lib/shell-appearance-subscription'
import { resolveWebChromeMaterial, subscribeWebChromePreference } from '@/lib/web-chrome-preference'

function applySnapshot(snapshot: ZenShellSnapshot): void {
  const root = document.documentElement
  // Keep the material fallback even when shell styling is disabled, so an
  // explicit opt-out cannot leave the default glass chrome visible.
  root.setAttribute('data-shell-material', snapshot.material)
  if (snapshot.enabled) {
    root.setAttribute('data-shell-style', 'zen')
  } else {
    if (root.getAttribute('data-shell-style') === 'zen') {
      root.removeAttribute('data-shell-style')
    }
  }
}

/**
 * Applies the main-owned Zen Shell snapshot to <html>.
 * The web adapter conveys no desktop shell capability.
 */
export function useShellAppearance(): void {
  useEffect(() => {
    const api = typeof window === 'undefined' ? undefined : window.electronAPI
    const root = document.documentElement
    const runtime = api?.getRuntimeEnvironment?.() === 'electron' ? 'electron' : 'web'
    root.dataset.shellRuntime = runtime
    // A desktop window starts solid until the main compositor acknowledges
    // a healthy material. Browser CSS glass has its own capability policy.
    root.dataset.shellMaterial = 'solid'
    if (runtime === 'web') {
      return subscribeWebChromePreference(preference => {
        root.dataset.shellCssMaterial = resolveWebChromeMaterial(preference)
        if (preference.enabled) root.dataset.shellStyle = 'zen'
        else if (root.dataset.shellStyle === 'zen') delete root.dataset.shellStyle
      })
    }
    delete root.dataset.shellCssMaterial
    return subscribeDesktopShellAppearance(api, applySnapshot, error => {
      root.dataset.shellMaterial = 'solid'
      if (error) console.warn('Desktop shell appearance unavailable:', error)
    })
  }, [])
}
