import { useEffect, useState } from 'react'
import {
  DEFAULT_THEME,
  type ThemeOverrides,
  type ThemeFile,
  type ShikiThemeConfig,
} from '@config/theme'
import { useTheme as useThemeContext } from '@/context/ThemeContext'

/**
 * Loads app-wide token overrides and keeps them current across Electron
 * windows. A live IPC event is newer than the asynchronous bootstrap read.
 */
export function useAppTheme(): ThemeOverrides | null {
  const [appTheme, setAppTheme] = useState<ThemeOverrides | null>(null)

  useEffect(() => {
    let active = true
    let receivedAppThemeChange = false

    const cleanup = window.electronAPI.onAppThemeChange((theme) => {
      receivedAppThemeChange = true
      setAppTheme(theme)
    })

    void window.electronAPI.getAppTheme().then((theme) => {
      if (active && !receivedAppThemeChange) setAppTheme(theme)
    }).catch(() => {
      // Keep the provider's default theme when the optional override is unavailable.
    })

    return () => {
      active = false
      cleanup()
    }
  }, [])

  return appTheme
}

interface UseThemeResult {
  theme: ThemeOverrides
  defaultTheme: ThemeOverrides
  shikiTheme: string
  shikiConfig: ShikiThemeConfig
  presetTheme: ThemeFile | null
  isDark: boolean
  /** Whether the theme is in scenic mode (background image with glass panels) */
  isScenic: boolean
}

/**
 * Hook to access theme state from ThemeContext.
 *
 * Theme loading and DOM manipulation happen in ThemeProvider (singleton).
 * This hook just reads the already-resolved values - no async loading,
 * no per-component effects.
 *
 * @example
 * ```tsx
 * const { isDark, shikiTheme } = useTheme()
 * ```
 */
export function useTheme(): UseThemeResult {
  const context = useThemeContext()

  return {
    theme: context.resolvedTheme,
    defaultTheme: DEFAULT_THEME,
    shikiTheme: context.shikiTheme,
    shikiConfig: context.shikiConfig,
    presetTheme: context.presetTheme,
    isDark: context.isDark,
    isScenic: context.isScenic,
  }
}
