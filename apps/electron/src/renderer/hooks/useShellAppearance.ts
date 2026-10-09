import { useEffect } from 'react'
import type { ZenShellSnapshot } from '../../shared/shell-appearance'
import { subscribeDesktopShellAppearance } from '@/lib/shell-appearance-subscription'
import { resolveWebChromeMaterial, subscribeWebChromePreference } from '@/lib/web-chrome-preference'
import { applyRenderProfile } from '@/lib/render-profile-dom'

/** True when the engine can composite the glass step's backdrop blur. */
function supportsBackdropFilter(): boolean {
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return false
  return CSS.supports('backdrop-filter', 'blur(1px)') || CSS.supports('-webkit-backdrop-filter', 'blur(1px)')
}

/**
 * G8 chrome material ladder: derive `<html data-chrome-material>` from the
 * window material snapshot persisted on `<html>`. `dense` (opaque plate) is
 * the shipped default; a translucent window material (`vibrancy`/`mica`, or
 * browser CSS glass) or scenic zen unlocks the translucent steps. `glass`
 * (tint + one blur) needs a backdrop compositor, otherwise the plate keeps
 * the blur-free `tint` step. The performance profile, high contrast and a
 * reduced-transparency request always flatten the ladder to `dense`.
 */
export function deriveChromeMaterial(root: HTMLElement): 'dense' | 'tint' | 'glass' {
  if (root.getAttribute('data-render-profile') === 'performance') return 'dense'
  if (root.getAttribute('data-contrast') === 'high') return 'dense'
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    if (window.matchMedia('(prefers-reduced-transparency: reduce)').matches) return 'dense'
    if (window.matchMedia('(prefers-contrast: more)').matches) return 'dense'
  }
  const scenicZen = root.getAttribute('data-shell-style') === 'zen' && root.hasAttribute('data-scenic')
  const translucent = root.dataset.shellMaterial === 'vibrancy'
    || root.dataset.shellMaterial === 'mica'
    || root.dataset.shellCssMaterial === 'glass'
  if (!translucent && !scenicZen) return 'dense'
  return supportsBackdropFilter() ? 'glass' : 'tint'
}

function applyChromeMaterial(root: HTMLElement): void {
  root.setAttribute('data-chrome-material', deriveChromeMaterial(root))
}

/** Root attributes the chrome-material ladder reads; a change re-derives it. */
const CHROME_MATERIAL_SOURCES = [
  'data-shell-material',
  'data-shell-css-material',
  'data-shell-style',
  'data-scenic',
  'data-contrast',
  'data-render-profile',
]

function applySnapshot(snapshot: ZenShellSnapshot): void {
  const root = document.documentElement
  // Keep the material fallback even when shell styling is disabled, so an
  // explicit opt-out cannot leave the default glass chrome visible.
  root.setAttribute('data-shell-material', snapshot.material)
  applyRenderProfile(root, snapshot)
  if (snapshot.enabled) {
    root.setAttribute('data-shell-style', 'zen')
  } else {
    if (root.getAttribute('data-shell-style') === 'zen') {
      root.removeAttribute('data-shell-style')
    }
  }
  applyChromeMaterial(root)
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

    const syncChromeMaterial = () => applyChromeMaterial(root)
    const observer = typeof MutationObserver === 'undefined' ? null : new MutationObserver(syncChromeMaterial)
    observer?.observe(root, { attributes: true, attributeFilter: CHROME_MATERIAL_SOURCES })

    let stop: () => void
    if (runtime === 'web') {
      stop = subscribeWebChromePreference(preference => {
        root.dataset.shellCssMaterial = resolveWebChromeMaterial(preference)
        if (preference.enabled) root.dataset.shellStyle = 'zen'
        else if (root.dataset.shellStyle === 'zen') delete root.dataset.shellStyle
      })
    } else {
      delete root.dataset.shellCssMaterial
      stop = subscribeDesktopShellAppearance(api, applySnapshot, error => {
        root.dataset.shellMaterial = 'solid'
        if (error) console.warn('Desktop shell appearance unavailable:', error)
      })
    }
    syncChromeMaterial()

    return () => {
      stop()
      observer?.disconnect()
    }
  }, [])
}