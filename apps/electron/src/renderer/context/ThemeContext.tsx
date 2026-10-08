import React, { createContext, useContext, useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo, type ReactNode } from 'react'
import * as storage from '@/lib/local-storage'
import { resolveVisualMode, persistThemeSelection, resolveUiProfile } from './theme-resolution'
import {
  resolveTheme,
  mergeThemeOverrides,
  themeToCSS,
  DEFAULT_SHIKI_THEME,
  getShikiTheme,
  shouldSetThemeOverride,
  type ThemeOverrides,
  type ThemeFile,
  type ShikiThemeConfig,
} from '@config/theme'
import {
  isContrastMode,
  prefersMoreContrast,
  resolveContrast,
  type ContrastMode,
} from './contrast-mode'
import {
  normalizeChatFont,
  normalizeTerminalFont,
  normalizeUiFont,
  resolveStoredUiFont,
  type ChatFontFamily,
  type TerminalFontFamily,
  type UiFontFamily,
} from './font-preferences'
import { toErrorMessage } from '@/lib/errors'

export type ThemeMode = 'light' | 'dark' | 'system'
export type FontFamily = UiFontFamily
export type { ChatFontFamily, ContrastMode, TerminalFontFamily }

interface ThemeContextType {
  // Preferences (persisted at app level)
  mode: ThemeMode
  /** App-level default color theme (used when workspace has no override) */
  colorTheme: string
  font: FontFamily
  chatFont: ChatFontFamily
  terminalFont: TerminalFontFamily
  contrast: ContrastMode
  setMode: (mode: ThemeMode) => void
  /** Set app-level default color theme */
  setColorTheme: (theme: string) => void
  setFont: (font: FontFamily) => void
  setChatFont: (font: ChatFontFamily) => void
  setTerminalFont: (font: TerminalFontFamily) => void
  setContrast: (contrast: ContrastMode) => void
  /** Resolved high/standard contrast after system preference */
  resolvedContrast: 'normal' | 'high'

  // Workspace-level theme override
  /** Active workspace ID (null if no workspace context) */
  activeWorkspaceId: string | null
  /** Workspace-specific color theme override (null = inherit from app default) */
  workspaceColorTheme: string | null
  /** Set workspace-specific color theme override (null = inherit) */
  setWorkspaceColorTheme: (theme: string | null) => Promise<boolean>

  // Derived/computed
  resolvedMode: 'light' | 'dark'
  systemPreference: 'light' | 'dark'
  /** Effective color theme for rendering (previewColorTheme ?? workspaceColorTheme ?? colorTheme) */
  effectiveColorTheme: string
  /** Temporary preview theme (hover state) - not persisted */
  previewColorTheme: string | null
  /** Set temporary preview theme for hover preview. Pass null to clear. */
  setPreviewColorTheme: (theme: string | null) => void
  /** Where effectiveColorTheme came from for current render cycle */
  effectiveColorThemeSource: 'preview' | 'workspace' | 'app'
  /** How the preset theme was resolved */
  themeResolvedFrom: 'none' | 'ipc' | 'fallback'
  /** Non-fatal theme loading error. Null when theme loaded normally. */
  themeLoadError: string | null

  // Theme resolution (singleton - loaded once)
  /** Loaded preset theme file, null if default or loading */
  presetTheme: ThemeFile | null
  /** Fully resolved theme (preset merged with any overrides) */
  resolvedTheme: ThemeOverrides
  /** Whether dark mode is active (scenic themes force dark) */
  isDark: boolean
  /** Whether theme is scenic mode (background image with glass panels) */
  isScenic: boolean
  /** Shiki syntax highlighting theme name for current mode */
  shikiTheme: string
  /** Shiki theme configuration (light/dark variants) */
  shikiConfig: ShikiThemeConfig
}

interface StoredTheme {
  mode: ThemeMode
  colorTheme: string
  font?: FontFamily
  chatFont?: ChatFontFamily
  terminalFont?: TerminalFontFamily
  contrast?: ContrastMode
  /** True when user explicitly changed theme in UI (not auto-saved on startup) */
  isUserOverride?: boolean
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

const bundledThemeModules = import.meta.glob('../../../resources/themes/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, ThemeFile>

const BUNDLED_THEMES = new Map<string, ThemeFile>(
  Object.entries(bundledThemeModules).map(([path, theme]) => {
    const fileName = path.split('/').pop() ?? ''
    const id = fileName.replace('.json', '')
    return [id, theme]
  })
)

interface ThemeProviderProps {
  children: ReactNode
  defaultMode?: ThemeMode
  defaultColorTheme?: string
  defaultFont?: FontFamily
  /** Active workspace ID for workspace-level theme overrides */
  activeWorkspaceId?: string | null
}

function getSystemPreference(): 'light' | 'dark' {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return 'light'
}

function storedContrast(stored: StoredTheme | null): ContrastMode {
  return stored && isContrastMode(stored.contrast) ? stored.contrast : 'system'
}

function loadStoredTheme(): StoredTheme | null {
  if (typeof window === 'undefined') return null
  return storage.get<StoredTheme | null>(storage.KEYS.theme, null)
}

function saveTheme(theme: StoredTheme): void {
  storage.set(storage.KEYS.theme, theme)
}

export function ThemeProvider({
  children,
  defaultMode = 'dark',
  defaultColorTheme = 'pierre',
  defaultFont = 'rox',
  activeWorkspaceId = null
}: ThemeProviderProps) {
  const stored = loadStoredTheme()

  // === Preference state (persisted at app level) ===
  const [mode, setModeState] = useState<ThemeMode>(stored?.mode ?? defaultMode)
  // Only use localStorage colorTheme if user explicitly set it via UI
  const [colorTheme, setColorThemeState] = useState<string>(() => {
    if (stored?.isUserOverride && stored.colorTheme) {
      return stored.colorTheme
    }
    return defaultColorTheme // Will be updated by config.json effect
  })
  const [font, setFontState] = useState<FontFamily>(resolveStoredUiFont(stored, defaultFont))
  const [chatFont, setChatFontState] = useState<ChatFontFamily>(normalizeChatFont(stored?.chatFont, defaultFont))
  const [terminalFont, setTerminalFontState] = useState<TerminalFontFamily>(
    normalizeTerminalFont(stored?.terminalFont),
  )
  const [contrast, setContrastState] = useState<ContrastMode>(storedContrast(stored))
  const [systemPreference, setSystemPreference] = useState<'light' | 'dark'>(getSystemPreference)
  const [systemPrefersMoreContrast, setSystemPrefersMoreContrast] = useState(prefersMoreContrast)
  const [previewColorTheme, setPreviewColorTheme] = useState<string | null>(null)

  // === Workspace-level theme override ===
  const [workspaceColorTheme, setWorkspaceColorThemeState] = useState<string | null>(null)

  // Track if we're receiving an external update to prevent echo broadcasts
  const isExternalUpdate = useRef(false)
  const themeWriteQueue = useRef<Promise<void>>(Promise.resolve())
  const workspaceWriteQueue = useRef<Promise<void>>(Promise.resolve())
  const selectionRequestVersion = useRef(0)
  const workspaceReadVersion = useRef(0)
  const workspaceRef = useRef(activeWorkspaceId)
  workspaceRef.current = activeWorkspaceId
  const [appTheme, setAppTheme] = useState<ThemeOverrides | null>(null)

  // Load app-level colorTheme from config.json on mount (only if user hasn't overridden)
  useEffect(() => {
    // Skip if user has explicitly set a theme via UI
    if (stored?.isUserOverride) return

    const version = selectionRequestVersion.current
    window.electronAPI?.getColorTheme?.().then((configTheme) => {
      if (selectionRequestVersion.current === version && configTheme) {
        setColorThemeState(configTheme)
      }
    }).catch(() => {
      // Keep default on error
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Only run on mount

  // App overrides participate in the same singleton CSS resolver as presets.
  useEffect(() => {
    let cancelled = false
    let receivedLiveTheme = false
    const api = window.electronAPI
    api?.getAppTheme?.().then(theme => {
      if (!cancelled && !receivedLiveTheme) setAppTheme(theme)
    }).catch(error => console.warn('App theme overrides unavailable:', error))
    const unsubscribe = api?.onAppThemeChange?.(theme => { receivedLiveTheme = true; if (!cancelled) setAppTheme(theme) })
    return () => { cancelled = true; unsubscribe?.() }
  }, [])

  // === Preset theme state (singleton) ===
  const [presetTheme, setPresetTheme] = useState<ThemeFile | null>(null)
  const [themeResolvedFrom, setThemeResolvedFrom] = useState<'none' | 'ipc' | 'fallback'>('none')
  const [themeLoadError, setThemeLoadError] = useState<string | null>(null)

  // === Derived values ===
  const resolvedMode = mode === 'system' ? systemPreference : mode
  const resolvedContrast = resolveContrast(contrast, systemPrefersMoreContrast)
  // Effective theme: preview > workspace override > app default
  const effectiveColorTheme = previewColorTheme ?? workspaceColorTheme ?? colorTheme
  const effectiveColorThemeSource: 'preview' | 'workspace' | 'app' =
    previewColorTheme !== null ? 'preview' : workspaceColorTheme !== null ? 'workspace' : 'app'

  // Late responses from a previous workspace cannot replace the active one.
  useEffect(() => {
    let cancelled = false
    const version = ++workspaceReadVersion.current
    setWorkspaceColorThemeState(null)
    if (activeWorkspaceId) {
      window.electronAPI?.getWorkspaceColorTheme?.(activeWorkspaceId).then(theme => {
        if (!cancelled && workspaceReadVersion.current === version) setWorkspaceColorThemeState(theme)
      }).catch(() => { if (!cancelled && workspaceReadVersion.current === version) setWorkspaceColorThemeState(null) })
    }
    return () => { cancelled = true }
  }, [activeWorkspaceId])

  // Load preset theme when effectiveColorTheme changes (SINGLETON - only here, not in useTheme)
  useEffect(() => {
    let cancelled = false

    const applyFallback = (reason: string) => {
      const fallbackTheme = BUNDLED_THEMES.get(effectiveColorTheme)
      if (fallbackTheme) {
        if (!cancelled) {
          setPresetTheme(fallbackTheme)
          setThemeResolvedFrom('fallback')
          setThemeLoadError(reason)
        }
        console.warn(`[ThemeContext] ${reason} Falling back to bundled theme: ${effectiveColorTheme}`)
        return
      }

      if (!cancelled) {
        setPresetTheme(null)
        setThemeResolvedFrom('none')
        setThemeLoadError(reason)
      }
      console.error(`[ThemeContext] ${reason} No bundled fallback found for: ${effectiveColorTheme}`)
    }

    if (!effectiveColorTheme || effectiveColorTheme === 'default') {
      setPresetTheme(null)
      setThemeResolvedFrom('none')
      setThemeLoadError(null)
      return () => {
        cancelled = true
      }
    }

    // Load preset theme via IPC (app-level), then fallback to bundled themes.
    // In playground/browser mode electronAPI may exist without loadPresetTheme.
    const loadPresetTheme = window.electronAPI?.loadPresetTheme
    if (!loadPresetTheme) {
      applyFallback(`electronAPI.loadPresetTheme is unavailable for "${effectiveColorTheme}".`)
      return () => {
        cancelled = true
      }
    }

    loadPresetTheme(effectiveColorTheme).then((preset) => {
      if (cancelled) return

      if (preset?.theme) {
        setPresetTheme(preset.theme)
        setThemeResolvedFrom('ipc')
        setThemeLoadError(null)
        return
      }

      applyFallback(`Preset theme was not returned by IPC for "${effectiveColorTheme}".`)
    }).catch((error) => {
      applyFallback(`Failed to load preset theme via IPC for "${effectiveColorTheme}": ${toErrorMessage(error)}.`)
    })

    return () => {
      cancelled = true
    }
  }, [effectiveColorTheme])

  // Resolve theme (preset → final)
  const resolvedTheme = useMemo(() => {
    return resolveTheme(mergeThemeOverrides(presetTheme ?? undefined, appTheme ?? undefined))
  }, [presetTheme, appTheme])

  // Determine scenic mode (background image with glass panels)
  const isScenic = useMemo(() => {
    return resolvedTheme.mode === 'scenic' && !!resolvedTheme.backgroundImage
  }, [resolvedTheme])

  const visualMode = resolveVisualMode(resolvedMode, presetTheme?.supportedModes, isScenic)
  const isDark = visualMode === 'dark'

  // Shiki theme configuration
  const shikiConfig = useMemo(() => {
    return presetTheme?.shikiTheme || DEFAULT_SHIKI_THEME
  }, [presetTheme])

  // Get current Shiki theme name based on mode
  const shikiTheme = useMemo(() => {
    const supportedModes = presetTheme?.supportedModes
    const currentMode = isDark ? 'dark' : 'light'

    // If theme has limited mode support and doesn't include current mode,
    // use the mode it does support for Shiki
    if (supportedModes && supportedModes.length > 0 && !supportedModes.includes(currentMode)) {
      const effectiveMode = supportedModes[0] === 'dark'
      return getShikiTheme(shikiConfig, effectiveMode)
    }

    return getShikiTheme(shikiConfig, isDark)
  }, [shikiConfig, isDark, presetTheme])

  // === DOM Effects (SINGLETON - all theme DOM manipulation happens here) ===

  // Apply base theme class and data attributes
  useLayoutEffect(() => {
    const root = document.documentElement

    // Apply font roles. The default ("rox") and "inter" presets both render
    // the locally bundled Inter for UI/chat; system uses the OS stack. Mono
    // (code/terminal/command input) stays Rox via --font-mono.
    root.dataset.font = font
    root.dataset.chatFont = chatFont
    root.dataset.terminalFont = terminalFont

    // Apply color theme data attribute
    if (effectiveColorTheme && effectiveColorTheme !== 'default') {
      root.dataset.theme = effectiveColorTheme
    } else {
      delete root.dataset.theme
    }

    if (shouldSetThemeOverride(effectiveColorTheme, isScenic)) {
      root.dataset.themeOverride = 'true'
    } else {
      delete root.dataset.themeOverride
    }
    root.dataset.contrast = resolvedContrast
  }, [effectiveColorTheme, font, chatFont, terminalFont, resolvedContrast, isScenic])

  // Apply dark/light class and theme-specific DOM attributes
  // This runs when preset loads or mode changes
  useLayoutEffect(() => {
    const root = document.documentElement

    root.classList.remove('light', 'dark')
    root.classList.add(visualMode)
    // The selected palette provides its own opaque reading surfaces. A mode
    // different from the OS must not add another window-wide color overlay.
    delete root.dataset.themeMismatch

    // Set scenic mode data attribute for CSS targeting
    if (isScenic) {
      root.dataset.scenic = 'true'
      if (resolvedTheme.backgroundImage) {
        root.style.setProperty('--background-image', `url("${resolvedTheme.backgroundImage}")`)
      }
    } else {
      delete root.dataset.scenic
      root.style.removeProperty('--background-image')
    }
    if (resolvedTheme.mode === 'blurred') {
      root.dataset.blurred = 'true'
    } else {
      delete root.dataset.blurred
    }

    const uiProfile = resolveUiProfile(presetTheme)
    if (uiProfile) {
      root.dataset.uiProfile = uiProfile
    } else {
      delete root.dataset.uiProfile
    }

  }, [presetTheme, visualMode, isScenic, resolvedTheme])

  // Inject CSS variables
  useLayoutEffect(() => {
    const styleId = 'craft-theme-overrides'
    let styleEl = document.getElementById(styleId) as HTMLStyleElement | null

    if (!styleEl) {
      styleEl = document.createElement('style')
      styleEl.id = styleId
      document.head.appendChild(styleEl)
    }

    // When using default theme, clear custom CSS
    if ((!effectiveColorTheme || effectiveColorTheme === 'default') && !appTheme) {
      styleEl.textContent = ''
      return
    }

    // Only inject CSS when preset is loaded (prevents flash with empty/wrong values)
    if (!presetTheme && effectiveColorTheme !== 'default' && !themeLoadError) {
      // Keep existing CSS while loading
      return
    }

    // Generate CSS variable declarations
    const cssVars = themeToCSS(resolvedTheme, isDark)

    if (cssVars) {
      styleEl.textContent = `:root {\n  ${cssVars}\n}`
    } else {
      styleEl.textContent = ''
    }
  }, [effectiveColorTheme, presetTheme, resolvedTheme, isDark, appTheme, themeLoadError])

  // === System preference listener ===
  useEffect(() => {
    let active = true
    let revision = 0
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleMediaChange = (e: MediaQueryListEvent) => {
      if (!active) return
      revision += 1
      setSystemPreference(e.matches ? 'dark' : 'light')
    }
    const contrastQuery = window.matchMedia('(prefers-contrast: more)')
    const handleContrastChange = (e: MediaQueryListEvent) => {
      if (!active) return
      setSystemPrefersMoreContrast(e.matches)
    }

    mediaQuery.addEventListener('change', handleMediaChange)
    contrastQuery.addEventListener('change', handleContrastChange)

    // Listen via Electron IPC if available (more reliable on macOS)
    let cleanup: (() => void) | undefined
    if (window.electronAPI?.onSystemThemeChange) {
      cleanup = window.electronAPI.onSystemThemeChange((isDark) => {
        if (!active) return
        revision += 1
        setSystemPreference(isDark ? 'dark' : 'light')
      })
    }

    // Fetch initial system theme from Electron
    if (window.electronAPI?.getSystemTheme) {
      void window.electronAPI.getSystemTheme().then((isDark) => {
        if (active && revision === 0) setSystemPreference(isDark ? 'dark' : 'light')
      }).catch(() => {})
    }

    return () => {
      active = false
      mediaQuery.removeEventListener('change', handleMediaChange)
      contrastQuery.removeEventListener('change', handleContrastChange)
      cleanup?.()
    }
  }, [])

  // === Cross-window sync listener ===
  useEffect(() => {
    if (!window.electronAPI?.onThemePreferencesChange) return

    const cleanup = window.electronAPI.onThemePreferencesChange((preferences) => {
      isExternalUpdate.current = true
      selectionRequestVersion.current += 1
      const nextContrast = isContrastMode(preferences.contrast) ? preferences.contrast : storedContrast(loadStoredTheme())
      setModeState(preferences.mode as ThemeMode)
      setColorThemeState(preferences.colorTheme)
      setFontState(normalizeUiFont(preferences.font))
      setContrastState(nextContrast)
      const existingStored = loadStoredTheme()
      saveTheme({
        mode: preferences.mode as ThemeMode,
        colorTheme: preferences.colorTheme,
        font: normalizeUiFont(preferences.font),
        chatFont: existingStored?.chatFont,
        terminalFont: existingStored?.terminalFont,
        contrast: nextContrast,
        isUserOverride: true
      })
      setTimeout(() => {
        isExternalUpdate.current = false
      }, 0)
    })

    return cleanup
  }, [])

  // === Setters with persistence and broadcast ===
  const setMode = useCallback((newMode: ThemeMode) => {
    setModeState(newMode)
    const existing = loadStoredTheme()
    saveTheme({
      mode: newMode,
      colorTheme,
      font,
      chatFont,
      terminalFont,
      contrast,
      isUserOverride: existing?.isUserOverride,
    })
    if (!isExternalUpdate.current && window.electronAPI?.broadcastThemePreferences) {
      window.electronAPI.broadcastThemePreferences({ mode: newMode, colorTheme, font, contrast })
    }
  }, [colorTheme, font, chatFont, terminalFont, contrast])

  const setColorTheme = useCallback((newTheme: string) => {
    selectionRequestVersion.current += 1
    // Serialize config writes. Rejected writes retain the last committed
    // selection and never broadcast a preference that was not saved.
    themeWriteQueue.current = themeWriteQueue.current.then(async () => {
      try {
        await persistThemeSelection(newTheme, window.electronAPI?.setColorTheme, () => {
          setColorThemeState(newTheme)
          const current = loadStoredTheme()
          const preferences = {
            mode: current?.mode ?? mode,
            colorTheme: newTheme,
            font: normalizeUiFont(current?.font ?? font),
            chatFont: current?.chatFont ?? chatFont,
            terminalFont: current?.terminalFont ?? terminalFont,
            contrast: current?.contrast ?? contrast,
            isUserOverride: true,
          }
          saveTheme(preferences)
          setThemeLoadError(null)
          if (!isExternalUpdate.current) {
            window.electronAPI?.broadcastThemePreferences?.(preferences)
          }
        })
      } catch (error) {
        console.error('Failed to persist theme selection:', error)
        setThemeLoadError('THEME_SAVE_FAILED')
      }
    })
  }, [mode, font, chatFont, terminalFont, contrast])

  const setFont = useCallback((newFont: FontFamily) => {
    const next = normalizeUiFont(newFont)
    setFontState(next)
    const existing = loadStoredTheme()
    saveTheme({
      mode,
      colorTheme,
      font: next,
      chatFont,
      terminalFont,
      contrast,
      isUserOverride: existing?.isUserOverride,
    })
    if (!isExternalUpdate.current && window.electronAPI?.broadcastThemePreferences) {
      window.electronAPI.broadcastThemePreferences({ mode, colorTheme, font: next, contrast })
    }
  }, [mode, colorTheme, chatFont, terminalFont, contrast])

  const setChatFont = useCallback((newFont: ChatFontFamily) => {
    const next = normalizeChatFont(newFont)
    setChatFontState(next)
    const existing = loadStoredTheme()
    saveTheme({
      mode,
      colorTheme,
      font,
      chatFont: next,
      terminalFont,
      contrast,
      isUserOverride: existing?.isUserOverride,
    })
  }, [mode, colorTheme, font, terminalFont, contrast])

  const setTerminalFont = useCallback((newFont: TerminalFontFamily) => {
    const next = normalizeTerminalFont(newFont)
    setTerminalFontState(next)
    const existing = loadStoredTheme()
    saveTheme({
      mode,
      colorTheme,
      font,
      chatFont,
      terminalFont: next,
      contrast,
      isUserOverride: existing?.isUserOverride,
    })
  }, [mode, colorTheme, font, chatFont, contrast])

  const setContrast = useCallback((newContrast: ContrastMode) => {
    setContrastState(newContrast)
    const existing = loadStoredTheme()
    saveTheme({
      mode,
      colorTheme,
      font,
      chatFont,
      terminalFont,
      contrast: newContrast,
      isUserOverride: existing?.isUserOverride,
    })
    if (!isExternalUpdate.current && window.electronAPI?.broadcastThemePreferences) {
      window.electronAPI.broadcastThemePreferences({ mode, colorTheme, font, contrast: newContrast })
    }
  }, [mode, colorTheme, font, chatFont, terminalFont])

  // Workspace writes have the same acknowledgement boundary as app writes.
  const setWorkspaceColorTheme = useCallback((newTheme: string | null) => {
    const workspaceId = activeWorkspaceId
    if (!workspaceId) return Promise.resolve(false)
    workspaceReadVersion.current += 1
    const result = workspaceWriteQueue.current.then(async () => {
      try {
        await window.electronAPI?.setWorkspaceColorTheme?.(workspaceId, newTheme)
        if (workspaceRef.current === workspaceId) {
          workspaceReadVersion.current += 1
          setWorkspaceColorThemeState(newTheme)
          setThemeLoadError(null)
        }
        window.electronAPI?.broadcastWorkspaceThemeChange?.(workspaceId, newTheme)
        return true
      } catch (error) {
        console.error('Failed to persist workspace theme:', error)
        if (workspaceRef.current === workspaceId) setThemeLoadError('THEME_SAVE_FAILED')
        return false
      }
    })
    workspaceWriteQueue.current = result.then(() => {})
    return result
  }, [activeWorkspaceId])

  // Listen for workspace theme changes from other windows
  useEffect(() => {
    if (!window.electronAPI?.onWorkspaceThemeChange) return

    const cleanup = window.electronAPI.onWorkspaceThemeChange(({ workspaceId, themeId }) => {
      // Only update if this is our active workspace
      if (workspaceId === activeWorkspaceId) {
        workspaceReadVersion.current += 1
        setWorkspaceColorThemeState(themeId)
      }
    })

    return cleanup
  }, [activeWorkspaceId])

  return (
    <ThemeContext.Provider
      value={{
        // App-level preferences
        mode,
        colorTheme,
        font,
        chatFont,
        terminalFont,
        contrast,
        setMode,
        setColorTheme,
        setFont,
        setChatFont,
        setTerminalFont,
        setContrast,
        resolvedContrast,

        // Workspace-level theme override
        activeWorkspaceId,
        workspaceColorTheme,
        setWorkspaceColorTheme,

        // Derived
        resolvedMode: visualMode,
        systemPreference,
        effectiveColorTheme,
        previewColorTheme,
        setPreviewColorTheme,
        effectiveColorThemeSource,
        themeResolvedFrom,
        themeLoadError,

        // Theme resolution (singleton)
        presetTheme,
        resolvedTheme,
        isDark,
        isScenic,
        shikiTheme,
        shikiConfig,
      }}
    >
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext)
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
