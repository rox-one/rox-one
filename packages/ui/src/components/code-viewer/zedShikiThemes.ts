import { bundledThemes, normalizeTheme, type BundledTheme, type ThemeRegistrationRaw } from 'shiki'
import nordfox from './themes/rox-nordfox-opaque.json'
import minDark from './themes/rox-min-dark-blurred.json'
import siriLight from './themes/rox-siri-light.json'

/** Static adaptations of the installed Zed themes. See docs/themes/zed-syntax.md. */
export const ZED_SHIKI_THEMES: Readonly<Record<string, ThemeRegistrationRaw>> = {
  'rox-nordfox-opaque': nordfox as ThemeRegistrationRaw,
  'rox-min-dark-blurred': minDark as ThemeRegistrationRaw,
  'rox-siri-light': siriLight as ThemeRegistrationRaw,
}

/** Resolve ROX names without asking Shiki to find them in its built-in catalogue. */
export function resolveShikiTheme(name: string): ThemeRegistrationRaw | BundledTheme {
  return Object.hasOwn(ZED_SHIKI_THEMES, name) ? ZED_SHIKI_THEMES[name]! : name as BundledTheme
}

export function getShikiThemeType(name: string): 'light' | 'dark' | undefined {
  return Object.hasOwn(ZED_SHIKI_THEMES, name) ? ZED_SHIKI_THEMES[name]?.type : undefined
}

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
