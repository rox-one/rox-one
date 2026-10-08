import { bundledThemes, normalizeTheme } from 'shiki'
import { ZED_SHIKI_THEMES } from './zedShikiThemeData'

export { ZED_SHIKI_THEMES, resolveShikiTheme, getShikiThemeType } from './zedShikiThemeData'

/**
 * TipTap's Shiki extension only loads names present in bundledThemes. Register
 * the three static loaders before it creates its singleton highlighter.
 */
export function registerZedShikiLoaders(): void {
  const loaders = bundledThemes as Record<string, () => Promise<unknown>>
  for (const [name, theme] of Object.entries(ZED_SHIKI_THEMES)) {
    if (!loaders[name]) loaders[name] = async () => theme
  }
}

export function normalizedZedShikiTheme(name: string) {
  const theme = ZED_SHIKI_THEMES[name]
  if (!theme) throw new Error(`Unknown Zed Shiki theme: ${name}`)
  return normalizeTheme(theme)
}
