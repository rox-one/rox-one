import { registerCustomTheme, resolveTheme } from '@pierre/diffs'
import { normalizedZedShikiTheme, ZED_SHIKI_THEMES } from './zedShikiThemes'

/**
 * Theme names registered by this module. `@pierre/diffs` 1.5.2 dropped the
 * `RegisteredCustomThemes` registry export, and `registerCustomTheme` logs
 * `DuplicateThemeError` instead of de-duplicating, so the guard lives here:
 * one entry per name for the lifetime of the module, which survives
 * StrictMode re-mounts and HMR re-imports of the callers.
 */
const registeredCraftThemes = new Set<string>()

/**
 * Register craft and Zed Shiki themes once per Pierre runtime.
 * Prevents duplicate registration warnings during HMR or StrictMode re-mounts.
 */
export function registerCraftShikiThemes() {
  if (!registeredCraftThemes.has('craft-dark')) {
    registeredCraftThemes.add('craft-dark')
    registerCustomTheme('craft-dark', async () => {
      const theme = await resolveTheme('pierre-dark')
      return { ...theme, name: 'craft-dark', bg: 'transparent', colors: { ...theme.colors, 'editor.background': 'transparent' } }
    })
  }

  if (!registeredCraftThemes.has('craft-light')) {
    registeredCraftThemes.add('craft-light')
    registerCustomTheme('craft-light', async () => {
      const theme = await resolveTheme('pierre-light')
      return { ...theme, name: 'craft-light', bg: 'transparent', colors: { ...theme.colors, 'editor.background': 'transparent' } }
    })
  }

  for (const name of Object.keys(ZED_SHIKI_THEMES)) {
    if (registeredCraftThemes.has(name)) continue
    registeredCraftThemes.add(name)
    registerCustomTheme(name, async () => normalizedZedShikiTheme(name))
  }
}