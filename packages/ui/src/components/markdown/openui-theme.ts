/**
 * ROX → OpenUI theme bridge.
 *
 * OpenUI's ThemeProvider injects `--openui-*` custom properties and every
 * OpenUI component reads its design tokens from them. Instead of snapshotting
 * computed values we map the ROX tokens onto OpenUI's token names as
 * `var(--…)` references: ThemeProvider only validates token *keys*
 * (`createTheme`), so the references are accepted and the rendered block
 * follows the app theme (light/dark, presets) through the CSS cascade — no
 * re-render needed when the theme changes.
 *
 * The active mode still has to be tracked separately: ThemeProvider uses it to
 * pick the built-in defaults for the tokens we do not override.
 */
import * as React from 'react'
import { createTheme, type Theme, type ThemeMode } from '@openuidev/react-ui'

export interface RoxOpenUITheme {
  mode: ThemeMode
  lightTheme: Theme
  darkTheme: Theme
}

const DARK_CLASS = 'dark'

// ROX tokens → OpenUI tokens. Values are CSS references resolved by the
// browser at use time, so the same overrides are valid for both modes.
const ROX_TOKENS = {
  background: 'var(--surface-canvas)',
  foreground: 'var(--surface-canvas)',
  popoverBackground: 'var(--surface-popover)',
  sunk: 'var(--surface-rail)',
  sunkLight: 'var(--surface-rail)',
  elevated: 'var(--surface-elevated)',
  elevatedLight: 'var(--surface-elevated)',
  textNeutralPrimary: 'var(--text-primary)',
  textNeutralSecondary: 'var(--text-secondary)',
  textNeutralTertiary: 'var(--text-muted)',
  textNeutralLink: 'var(--accent-text)',
  borderDefault: 'var(--border-subtle)',
  borderInteractive: 'var(--border-strong)',
  interactiveAccentDefault: 'var(--accent)',
  interactiveAccentHover: 'color-mix(in oklab, var(--accent) 88%, var(--text-primary))',
  interactiveAccentDisabled: 'var(--text-muted)',
  interactiveDestructiveDefault: 'var(--destructive)',
  interactiveDestructiveHover: 'color-mix(in oklab, var(--destructive) 88%, var(--text-primary))',
  infoBackground: 'color-mix(in oklab, var(--info) 14%, var(--surface-canvas))',
  successBackground: 'color-mix(in oklab, var(--success) 14%, var(--surface-canvas))',
  dangerBackground: 'color-mix(in oklab, var(--destructive) 14%, var(--surface-canvas))',
  textInfoPrimary: 'var(--info-text)',
  textSuccessPrimary: 'var(--success-text)',
  textDangerPrimary: 'var(--destructive-text)',
  borderInfoEmphasis: 'var(--info)',
  borderSuccessEmphasis: 'var(--success)',
  borderDangerEmphasis: 'var(--destructive)',
  fontBody: 'var(--font-sans)',
  fontHeading: 'var(--font-sans)',
  fontLabel: 'var(--font-sans)',
  fontCode: 'var(--font-mono)',
  radiusS: 'var(--radius-sm)',
  radiusM: 'var(--radius-md)',
  radiusL: 'var(--radius-lg)',
  shadowS: 'var(--shadow-minimal)',
  shadowM: 'var(--shadow-control)',
  chatUserResponseBg: 'var(--surface-elevated)',
  chatUserResponseText: 'var(--text-primary)',
} satisfies Theme

// Same reference overrides for both modes: the `var()` values already resolve
// per mode, so there is nothing mode-specific to recompute here.
const LIGHT_THEME = createTheme(ROX_TOKENS)
const DARK_THEME = createTheme(ROX_TOKENS)

/**
 * Track the app theme mode and return the OpenUI theme overrides.
 *
 * Mirrors `CodeBlock`'s DOM detection (the `dark` class on
 * `document.documentElement`) and keeps up with later theme switches via a
 * MutationObserver.
 */
export function useRoxOpenUITheme(): RoxOpenUITheme {
  const [mode, setMode] = React.useState<ThemeMode>(
    () => (typeof document !== 'undefined' && document.documentElement.classList.contains(DARK_CLASS) ? 'dark' : 'light'),
  )

  React.useEffect(() => {
    const root = document.documentElement
    const sync = () => setMode(root.classList.contains(DARK_CLASS) ? 'dark' : 'light')
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  return React.useMemo(
    () => ({ mode, lightTheme: LIGHT_THEME, darkTheme: DARK_THEME }),
    [mode],
  )
}