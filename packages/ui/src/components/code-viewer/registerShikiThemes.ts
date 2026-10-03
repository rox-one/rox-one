import { registerCustomTheme, resolveTheme, RegisteredCustomThemes } from '@pierre/diffs'
import { normalizedZedShikiTheme, ZED_SHIKI_THEMES } from './zedShikiThemes'

/**
 * Register craft and Zed Shiki themes once per Pierre runtime.
 * Prevents duplicate registration warnings during HMR or StrictMode re-mounts.
 */
export function registerCraftShikiThemes() {
  if (!RegisteredCustomThemes.has('craft-dark')) registerCustomTheme('craft-dark', async () => {
    const theme = await resolveTheme('pierre-dark')
    return { ...theme, name: 'craft-dark', bg: 'transparent', colors: { ...theme.colors, 'editor.background': 'transparent' } }
  })

  if (!RegisteredCustomThemes.has('craft-light')) registerCustomTheme('craft-light', async () => {
    const theme = await resolveTheme('pierre-light')
    return { ...theme, name: 'craft-light', bg: 'transparent', colors: { ...theme.colors, 'editor.background': 'transparent' } }
  })

  for (const name of Object.keys(ZED_SHIKI_THEMES)) {
    if (!RegisteredCustomThemes.has(name)) registerCustomTheme(name, async () => normalizedZedShikiTheme(name))
  }
}
