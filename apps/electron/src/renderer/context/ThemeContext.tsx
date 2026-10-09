import React, { createContext, useContext, useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo, type ReactNode } from 'react'
import * as storage from '@/lib/local-storage'
import { resolveVisualMode, persistThemeSelection, resolveUiProfile } from './theme-resolution'
import {
  resolveTheme,
  mergeThemeOverrides,
  themeToCSS,
  DEFAULT_SHIKI_THEME,
  getShikiTheme,
  resolveMaterial,
  shouldSetThemeOverride,
  ROX_THEME_ID,
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
import { isGeneratedMaterialEffect, materialEffectDataUrl } from '@/lib/material-effect-art'
import { useRenderProfile } from '@/lib/render-profile-motion'

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
  /** Temporary preview mode (story/hover state) - not persisted or broadcast */
  previewMode: ThemeMode | null
  /** Set temporary preview mode for the UI. Pass null to restore the app mode. */
  setPreviewMode: (mode: ThemeMode | null) => void
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

/** Lazily create the fixed, aria-hidden material layers once per document. */
function ensureMaterialLayer(kind: 'texture' | 'chat-effect' | 'haze'): HTMLDivElement | null {
  if (typeof document === 'undefined') return null
  let layer = document.querySelector<HTMLDivElement>(`.material-layer--${kind}`)
  if (!layer) {
    layer = document.createElement('div')
    layer.className = `material-layer material-layer--${kind}`
    layer.setAttribute('aria-hidden', 'true')
    document.body.appendChild(layer)
  }
  return layer
}

/** Parse a `#rrggbb`, `rgb()`/`rgba()` string into a byte triplet. */
function parseRgbTriplet(raw: string): [number, number, number] | null {
  const hex = raw.match(/^#?([0-9a-f]{6})$/i)
  if (hex?.[1]) {
    const value = parseInt(hex[1], 16)
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
  }
  const rgb = raw.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i)
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
  return null
}

/** Current foreground token as RGB, for painting generated effect art. */
function materialEffectRgb(): [number, number, number] {
  if (typeof window === 'undefined') return [255, 255, 255]
  const root = getComputedStyle(document.documentElement)
  // Prefer the pre-computed byte triplet (emitted by themeToCSS for hex themes
  // and present in the base tokens); it stays correct for oklch()/hsl()
  // foregrounds the hex/rgb parsers below cannot read.
  const triplet = root.getPropertyValue('--foreground-rgb').trim().match(/^(\d+)[,\s]+(\d+)[,\s]+(\d+)/)
  if (triplet) return [Number(triplet[1]), Number(triplet[2]), Number(triplet[3])]
  const fromToken = parseRgbTriplet(root.getPropertyValue('--foreground').trim())
  if (fromToken) return fromToken
  // `--foreground` may be an unparseable oklch()/color-mix(); the computed
  // `color` always resolves to rgb(), so read it from the painted root instead
  // of defaulting to invisible white-on-light ink.
  if (typeof document !== 'undefined' && document.body) {
    const body = getComputedStyle(document.body)
    const fromColor = parseRgbTriplet(body.color)
    if (fromColor) return fromColor
    // Last resort: keep ink readable against the canvas background.
    const background = parseRgbTriplet(body.backgroundColor)
    if (background) {
      const luma = (0.2126 * background[0] + 0.7152 * background[1] + 0.0722 * background[2]) / 255
      return luma > 0.5 ? [17, 17, 17] : [255, 255, 255]
    }
  }
  return [255, 255, 255]
}

interface ThemeProviderProps {
  children: ReactNode
  defaultMode?: ThemeMode
  defaultColorTheme?: string
  defaultFont?: FontFamily
  /** Active workspace ID for workspace-level theme overrides */
  activeWorkspaceId?: string | null
  /**
   * App-level theme override. When omitted, ThemeProvider subscribes to the
   * main process via useAppTheme(); pass a value to override that source.
   */
  appTheme?: ThemeOverrides | null
  /**
   * When set, the app is pinned to a single color theme: users cannot change
   * the mode or color theme, stored selections are migrated to this id, and
   * workspace theme overrides are ignored. Rox passes {@link ROX_THEME_ID}.
   */
  fixedColorTheme?: string
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
  defaultColorTheme = ROX_THEME_ID,
  defaultFont = 'rox',
  activeWorkspaceId = null,
  appTheme: appThemeProp,
  fixedColorTheme
}: ThemeProviderProps) {
  const stored = loadStoredTheme()

  // When the app pins a single theme, every theme/mode control becomes a no-op
  // and persisted selections coerce to the pinned value.
  const themeLocked = fixedColorTheme !== undefined
  const lockedColorTheme = fixedColorTheme ?? ROX_THEME_ID

  // === Preference state (persisted at app level) ===
  const [mode, setModeState] = useState<ThemeMode>(() =>
    themeLocked ? defaultMode : (stored?.mode ?? defaultMode)
  )
  // Only use localStorage colorTheme if user explicitly set it via UI
  const [colorTheme, setColorThemeState] = useState<string>(() => {
    if (themeLocked) return lockedColorTheme
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
  const [systemPrefersReducedTransparency, setSystemPrefersReducedTransparency] = useState(
    () => typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-transparency: reduce)').matches
      : false,
  )
  const [previewColorTheme, setPreviewColorTheme] = useState<string | null>(null)
  const [previewMode, setPreviewMode] = useState<ThemeMode | null>(null)

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

  // App theme overrides: an explicit prop wins, otherwise the main-process
  // source is tracked by useAppTheme (live IPC updates beat the bootstrap read).
  const ipcAppTheme = useAppTheme()
  const appTheme = appThemeProp !== undefined ? appThemeProp : ipcAppTheme

  // Load app-level colorTheme from config.json on mount (only if user hasn't overridden).
  // With a fixed theme, migrate any legacy config selection to the pinned id.
  useEffect(() => {
    if (themeLocked) {
      const api = window.electronAPI
      if (!api?.getColorTheme) return
      void api.getColorTheme?.().then((configTheme) => {
        setColorThemeState(lockedColorTheme)
        if (configTheme && configTheme !== lockedColorTheme) {
          void api.setColorTheme?.(lockedColorTheme).catch(() => {})
        }
      }).catch(() => {})
      return
    }

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

  // With a fixed theme, coerce any locally stored legacy selection on boot.
  useEffect(() => {
    if (!themeLocked) return
    const existing = loadStoredTheme()
    if (existing && (existing.colorTheme !== lockedColorTheme || existing.mode !== defaultMode)) {
      saveTheme({ ...existing, mode: defaultMode, colorTheme: lockedColorTheme })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Only run on mount

  // === Preset theme state (singleton) ===
  const [presetTheme, setPresetTheme] = useState<ThemeFile | null>(null)
  const [themeResolvedFrom, setThemeResolvedFrom] = useState<'none' | 'ipc' | 'fallback'>('none')
  const [themeLoadError, setThemeLoadError] = useState<string | null>(null)

  // === Derived values ===
  // Preview mode is UI-only: it changes the resolved mode without touching the
  // persisted app preference. Preview > app mode; 'system' defers to the OS.
  const requestedMode = previewMode ?? mode
  const resolvedMode = requestedMode === 'system' ? systemPreference : requestedMode
  const resolvedContrast = resolveContrast(contrast, systemPrefersMoreContrast)
  // Effective theme: with a fixed theme the pinned id always wins; otherwise
  // preview > workspace override > app default.
  const effectiveColorTheme = themeLocked
    ? lockedColorTheme
    : previewColorTheme ?? workspaceColorTheme ?? colorTheme
  const effectiveColorThemeSource: 'preview' | 'workspace' | 'app' = themeLocked
    ? 'app'
    : previewColorTheme !== null ? 'preview' : workspaceColorTheme !== null ? 'workspace' : 'app'

  // Late responses from a previous workspace cannot replace the active one.
  // With a fixed theme, workspace theme overrides are ignored entirely.
  useEffect(() => {
    let cancelled = false
    const version = ++workspaceReadVersion.current
    setWorkspaceColorThemeState(null)
    if (!themeLocked && activeWorkspaceId) {
      window.electronAPI?.getWorkspaceColorTheme?.(activeWorkspaceId).then(theme => {
        if (!cancelled && workspaceReadVersion.current === version) setWorkspaceColorThemeState(theme)
      }).catch(() => { if (!cancelled && workspaceReadVersion.current === version) setWorkspaceColorThemeState(null) })
    }
    return () => { cancelled = true }
  }, [activeWorkspaceId, themeLocked])

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

  // === Material (glass) layer ===
  // Resolve the theme's material settings with the accessibility gates, then
  // publish the state as data attributes. Variables come from themeToCSS.
  // The low-power profile is mirrored on <html data-render-profile> by the
  // shell snapshot; read it reactively so resolveMaterial and the art
  // generator follow runtime switches.
  const renderProfile = useRenderProfile()
  const resolvedMaterial = useMemo(() => resolveMaterial(resolvedTheme.material, {
    reduceTransparency: systemPrefersReducedTransparency,
    highContrast: resolvedContrast === 'high',
    renderProfile,
  }), [resolvedTheme, systemPrefersReducedTransparency, resolvedContrast, renderProfile])

  useLayoutEffect(() => {
    const root = document.documentElement
    if (!resolvedMaterial.enabled) {
      delete root.dataset.material
      delete root.dataset.materialTexture
      delete root.dataset.materialChatEffect
      delete root.dataset.materialDeep
      delete root.dataset.materialHaze
      return
    }
    root.dataset.material = 'on'
    const texture = resolvedMaterial.texture.kind
    if (texture && texture !== 'none') root.dataset.materialTexture = texture
    else delete root.dataset.materialTexture
    const chatEffect = resolvedMaterial.chatEffect.kind
    if (chatEffect && chatEffect !== 'none') root.dataset.materialChatEffect = chatEffect
    else delete root.dataset.materialChatEffect
    if (resolvedMaterial.haze.enabled) root.dataset.materialHaze = 'on'
    else delete root.dataset.materialHaze
    const deepPanes = Object.entries(resolvedMaterial.deepGlass)
      .filter(([, enabled]) => enabled)
      .map(([pane]) => pane)
    if (deepPanes.length > 0) root.dataset.materialDeep = deepPanes.join(',')
    else delete root.dataset.materialDeep
  }, [resolvedMaterial])

  // Mount the fixed material layers and (re)generate the chat-effect bitmap.
  // CSS gates visibility from the data attributes; this effect owns only the
  // DOM nodes and the generated art for the chat-effect layer.
  useEffect(() => {
    const chatLayer = ensureMaterialLayer('chat-effect')
    ensureMaterialLayer('texture')
    ensureMaterialLayer('haze')
    if (!chatLayer) return
    const clearArt = () => {
      chatLayer.style.removeProperty('--material-chat-effect-image')
      chatLayer.style.backgroundImage = ''
    }
    if (!resolvedMaterial.enabled) {
      clearArt()
      return
    }
    // The low-power profile must not rasterise (spec §6): the CSS layer is
    // hidden there anyway, so skip generation and drop any existing art.
    if (renderProfile === 'performance') {
      clearArt()
      return
    }
    const kind = resolvedMaterial.chatEffect.kind
    if (!kind || kind === 'none') {
      clearArt()
      return
    }
    if (kind === 'gradient') {
      // Drop any previously generated bitmap/URL before applying the gradient,
      // so the two paths never stack.
      clearArt()
      chatLayer.style.backgroundImage =
        'linear-gradient(to bottom, transparent 0%, color-mix(in srgb, var(--canvas) 55%, transparent) 100%)'
      return
    }
    if (!isGeneratedMaterialEffect(kind)) return
    let cancelled = false
    const width = Math.min(Math.max(window.innerWidth, 320), 2048)
    const height = Math.min(Math.max(window.innerHeight, 240), 2048)
    void materialEffectDataUrl({
      kind,
      width,
      height,
      // `intensity` only shapes the rasterised pattern; the layer's CSS opacity
      // (`--material-chat-effect-intensity`) is the single strength multiplier.
      intensity: resolvedMaterial.chatEffect.intensity,
      scale: resolvedMaterial.texture.scale,
      rgb: materialEffectRgb(),
    }).then((url) => {
      if (cancelled || !url) return
      chatLayer.style.setProperty('--material-chat-effect-image', `url("${url}")`)
      chatLayer.style.backgroundImage = `url("${url}")`
    })
    return () => {
      cancelled = true
    }
  }, [resolvedMaterial, isDark, renderProfile])

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
    const reducedTransparencyQuery = window.matchMedia('(prefers-reduced-transparency: reduce)')
    const handleReducedTransparencyChange = (e: MediaQueryListEvent) => {
      if (!active) return
      setSystemPrefersReducedTransparency(e.matches)
    }

    mediaQuery.addEventListener('change', handleMediaChange)
    contrastQuery.addEventListener('change', handleContrastChange)
    reducedTransparencyQuery.addEventListener('change', handleReducedTransparencyChange)

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
      reducedTransparencyQuery.removeEventListener('change', handleReducedTransparencyChange)
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
      const nextMode = themeLocked ? defaultMode : preferences.mode as ThemeMode
      const nextColorTheme = themeLocked ? lockedColorTheme : preferences.colorTheme
      setModeState(nextMode)
      setColorThemeState(nextColorTheme)
      setFontState(normalizeUiFont(preferences.font))
      setContrastState(nextContrast)
      const existingStored = loadStoredTheme()
      saveTheme({
        mode: nextMode,
        colorTheme: nextColorTheme,
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
  }, [themeLocked, lockedColorTheme, defaultMode])

  // === Setters with persistence and broadcast ===
  const setMode = useCallback((newMode: ThemeMode) => {
    // A fixed theme has no mode control: ignore user intent.
    if (themeLocked) return
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
  }, [themeLocked, colorTheme, font, chatFont, terminalFont, contrast])

  const setColorTheme = useCallback((newTheme: string) => {
    // A fixed theme is not user-selectable: keep the pinned id and ignore input.
    if (themeLocked) {
      setColorThemeState(lockedColorTheme)
      return
    }
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
  }, [themeLocked, lockedColorTheme, mode, font, chatFont, terminalFont, contrast])

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
    // A fixed theme has no per-workspace override: reject writes.
    if (themeLocked || !workspaceId) return Promise.resolve(false)
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
  }, [activeWorkspaceId, themeLocked])

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
        previewMode,
        setPreviewMode,
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

/**
 * Subscribe to the app-level theme override owned by the main process.
 *
 * The live IPC channel is authoritative and a re-subscription opens a new
 * generation: the initial `getAppTheme` bootstrap read is discarded once a
 * live `onAppThemeChange` update has arrived (or the hook re-subscribes), so a
 * late bootstrap response can never overwrite a newer live value.
 */
export function useAppTheme(): ThemeOverrides | null {
  const [appTheme, setAppTheme] = useState<ThemeOverrides | null>(null)
  const generationRef = useRef(0)

  useEffect(() => {
    const api = window.electronAPI
    if (!api?.getAppTheme && !api?.onAppThemeChange) return

    const generation = ++generationRef.current
    let cancelled = false

    const unsubscribe = api?.onAppThemeChange?.(theme => {
      // Any live update invalidates an in-flight bootstrap read.
      generationRef.current = generation + 1
      if (!cancelled) setAppTheme(theme)
    })

    api?.getAppTheme?.().then(theme => {
      if (cancelled || generationRef.current !== generation) return
      setAppTheme(theme)
    }).catch(error => {
      console.warn('App theme overrides unavailable:', error)
    })

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [])

  return appTheme
}

export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext)
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
