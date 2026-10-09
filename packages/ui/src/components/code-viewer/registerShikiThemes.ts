import { registerCustomTheme, resolveTheme } from '@pierre/diffs'
import { normalizedZedShikiTheme, ZED_SHIKI_THEMES } from './zedShikiThemes'

/**
 * Names registered through this module.
 *
 * @pierre/diffs >= 1.5 replaced the exported `RegisteredCustomThemes` loader
 * registry with an internal `@pierre/theming` resolver, which is not exported
 * from the package index. Track our own registrations instead so re-mounts
 * (HMR / StrictMode) don't hit the resolver's duplicate-theme path, which
 * console.errors.
 */
const registeredCustomThemes = new Set<string>()

function registerThemeOnce(
  name: string,
  loader: Parameters<typeof registerCustomTheme>[1],
): void {
  if (registeredCustomThemes.has(name)) return
  registeredCustomThemes.add(name)
  registerCustomTheme(name, loader)
}

/**
 * Register craft and Zed Shiki themes once per Pierre runtime.
 * Prevents duplicate registration warnings during HMR or StrictMode re-mounts.
 */
export function registerCraftShikiThemes() {
  registerThemeOnce('craft-dark', async () => {
    const theme = await resolveTheme('pierre-dark')
    return { ...theme, name: 'craft-dark', bg: 'transparent', colors: { ...theme.colors, 'editor.background': 'transparent' } }
  })

  registerThemeOnce('craft-light', async () => {
    const theme = await resolveTheme('pierre-light')
    return { ...theme, name: 'craft-light', bg: 'transparent', colors: { ...theme.colors, 'editor.background': 'transparent' } }
  })

  for (const name of Object.keys(ZED_SHIKI_THEMES)) {
    registerThemeOnce(name, async () => normalizedZedShikiTheme(name))
  }
}
