/**
 * The ROX Zed theme data and lookups, without the Shiki runtime.
 *
 * Only type imports from 'shiki' here, so startup code (diff headers, theme
 * type checks, the lazy highlighter's callers) does not pull Shiki's engine
 * into the startup bundle (PERF-04). Runtime helpers that need Shiki live in
 * zedShikiThemes.ts.
 */
import type { BundledTheme, ThemeRegistrationRaw } from 'shiki'
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
