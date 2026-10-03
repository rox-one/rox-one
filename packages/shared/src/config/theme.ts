/**
 * Theme Configuration
 *
 * App-level theme system with preset themes.
 * Light mode is default, with optional dark mode overrides.
 *
 * Storage locations:
 * - App override:   ~/.craft-agent/theme.json
 * - Preset themes:  ~/.craft-agent/themes/*.json
 */

/**
 * CSS color string - any valid CSS color format:
 * - Hex: #8b5cf6, #8b5cf6cc
 * - RGB: rgb(139, 92, 246), rgba(139, 92, 246, 0.8)
 * - HSL: hsl(262, 83%, 58%)
 * - OKLCH: oklch(0.58 0.22 293) (recommended)
 * - Named: purple, rebeccapurple
 */
export type CSSColor = string;

/** Optional ANSI colors. Missing entries retain the terminal renderer's defaults. */
export const TERMINAL_ANSI_COLOR_NAMES = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
  'dimBlack', 'dimRed', 'dimGreen', 'dimYellow', 'dimBlue', 'dimMagenta', 'dimCyan', 'dimWhite',
] as const;
export type TerminalAnsiColorName = typeof TERMINAL_ANSI_COLOR_NAMES[number];

/**
 * Semantic colors plus the supported terminal palette.
 */
export interface ThemeColors {
  background?: CSSColor;
  foreground?: CSSColor;
  accent?: CSSColor; // Brand purple (Execute mode)
  accentText?: CSSColor; // Readable accent text; accent itself remains the source fill/ring color
  info?: CSSColor; // Amber (Ask mode, warnings)
  success?: CSSColor; // Green
  destructive?: CSSColor; // Red
  textSecondary?: CSSColor;
  textMuted?: CSSColor;
  textDisabled?: CSSColor;
  focus?: CSSColor;
  borderSubtle?: CSSColor;
  borderStrong?: CSSColor;
  borderFocused?: CSSColor;
  elementHover?: CSSColor;
  elementSelected?: CSSColor;
  terminalBackground?: CSSColor;
  terminalForeground?: CSSColor;
  terminalBrightForeground?: CSSColor;
  terminalDimForeground?: CSSColor;
  terminalCursor?: CSSColor;
  terminalSelection?: CSSColor;
  terminalAnsi?: Partial<Record<TerminalAnsiColorName, CSSColor>>;
}

/**
 * Surface colors for specific UI regions
 * All optional - fall back to `background` if not set
 */
export interface SurfaceColors {
  paper?: CSSColor; // AI messages, cards, elevated content
  navigator?: CSSColor; // Left sidebar background
  input?: CSSColor; // Input field background
  popover?: CSSColor; // Dropdowns, modals, context menus (always solid, no transparency)
  popoverSolid?: CSSColor; // Guaranteed 100% opaque popover bg (required for scenic mode)
  titlebar?: CSSColor;
  toolbar?: CSSColor;
  tabBar?: CSSColor;
  tabActive?: CSSColor;
  tabInactive?: CSSColor;
}

/**
 * Theme mode - solid (default), scenic (background image), or blurred surfaces.
 */
export type ThemeMode = 'solid' | 'scenic' | 'blurred';

/**
 * Theme overrides - light mode default, optional dark overrides
 * App-level only (no workspace cascading)
 */
export interface ThemeOverrides extends ThemeColors, SurfaceColors {
  // Optional dark mode overrides (includes both semantic and surface colors)
  dark?: ThemeColors & SurfaceColors;

  /**
   * Theme mode: 'solid' (default), 'scenic' (background image), or 'blurred' surfaces.
   */
  mode?: ThemeMode;

  /**
   * Background image URL for scenic mode
   * Remote URL to background image (JPEG, PNG, WebP recommended)
   * Required when mode='scenic', ignored otherwise
   */
  backgroundImage?: string;
}

/**
 * Deep merge two theme objects (source wins for defined values)
 */
const COLOR_KEYS: (Exclude<keyof ThemeColors, 'terminalAnsi'>)[] = [
  'background',
  'foreground',
  'accent',
  'accentText',
  'info',
  'success',
  'destructive',
  'textSecondary',
  'textMuted',
  'textDisabled',
  'focus',
  'borderSubtle',
  'borderStrong',
  'borderFocused',
  'elementHover',
  'elementSelected',
  'terminalBackground',
  'terminalForeground',
  'terminalBrightForeground',
  'terminalDimForeground',
  'terminalCursor',
  'terminalSelection',
];

const SURFACE_KEYS: (keyof SurfaceColors)[] = [
  'paper',
  'navigator',
  'input',
  'popover',
  'popoverSolid',
  'titlebar',
  'toolbar',
  'tabBar',
  'tabActive',
  'tabInactive',
];

// Combined keys for merging (all color properties)
const ALL_COLOR_KEYS = [...COLOR_KEYS, ...SURFACE_KEYS] as const;

export function mergeThemeOverrides(
  base: ThemeOverrides | undefined,
  override: ThemeOverrides | undefined
): ThemeOverrides {
  if (!base) return override || {};
  if (!override) return base;

  const result: ThemeOverrides = { ...base };

  // Merge top-level color properties (semantic + surface)
  for (const key of ALL_COLOR_KEYS) {
    if (override[key] !== undefined) {
      result[key] = override[key];
    }
  }
  if (override.terminalAnsi) {
    result.terminalAnsi = { ...base.terminalAnsi, ...override.terminalAnsi };
  }

  // Merge scenic mode properties
  if (override.mode !== undefined) result.mode = override.mode;
  if (override.backgroundImage !== undefined)
    result.backgroundImage = override.backgroundImage;

  // Deep merge dark overrides
  if (override.dark) {
    result.dark = { ...base.dark };
    for (const key of ALL_COLOR_KEYS) {
      if (override.dark[key] !== undefined) {
        result.dark![key] = override.dark[key];
      }
    }
    if (override.dark.terminalAnsi) {
      result.dark.terminalAnsi = { ...base.dark?.terminalAnsi, ...override.dark.terminalAnsi };
    }
  }

  return result;
}

/**
 * Resolve theme from app-level source
 * (Workspace cascading has been removed for simplicity)
 */
export function resolveTheme(
  app?: ThemeOverrides
): ThemeOverrides {
  return mergeThemeOverrides(undefined, app) || {};
}

/**
 * Convert hex color to RGB values string (e.g., "255, 128, 0")
 * Optionally darkens the color by a factor (0-1, where 0.7 = 70% brightness)
 * Returns null if not a valid hex color
 */
function hexToRgbValues(hex: string, darkenFactor: number = 1): string | null {
  let r: number, g: number, b: number;

  // Match 6 digit hex colors
  const match = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (match) {
    r = parseInt(match[1]!, 16);
    g = parseInt(match[2]!, 16);
    b = parseInt(match[3]!, 16);
  } else {
    // Try 3-digit hex
    const shortMatch = hex.match(/^#?([a-f\d])([a-f\d])([a-f\d])$/i);
    if (!shortMatch) return null;
    r = parseInt(shortMatch[1]! + shortMatch[1]!, 16);
    g = parseInt(shortMatch[2]! + shortMatch[2]!, 16);
    b = parseInt(shortMatch[3]! + shortMatch[3]!, 16);
  }

  // Apply darkening factor
  r = Math.round(r * darkenFactor);
  g = Math.round(g * darkenFactor);
  b = Math.round(b * darkenFactor);

  return `${r}, ${g}, ${b}`;
}

/** A deliberately bounded parser for browser material fallbacks. Never copy an
 * unresolved var/calc/relative color into a token that promises opaque paint. */
function opaqueHexColor(color: CSSColor | undefined): string | null {
  if (!color) return null;
  const value = color.trim();
  const hex = /^#([\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.exec(value);
  if (hex) {
    const digits = hex[1]!;
    return `#${digits.length < 5 ? [...digits.slice(0, 3)].map(digit => digit + digit).join('') : digits.slice(0, 6)}`.toLowerCase();
  }
  const functional = /^(rgb|rgba|hsl|hsla|oklch)\(([^()]*)\)$/i.exec(value);
  if (!functional) return null;
  const kind = functional[1]!.toLowerCase();
  const body = functional[2]!.trim();
  const legacy = body.includes(',');
  if (legacy && (kind === 'oklch' || body.includes('/'))) return null;
  const slash = body.split('/');
  if (slash.length > 2) return null;
  const parts = legacy ? body.split(',').map(part => part.trim()) : slash[0]!.trim().split(/\s+/);
  const alpha = legacy ? (parts.length === 4 ? parts.pop() : undefined) : slash[1]?.trim();
  if (parts.length !== 3) return null;
  const quantity = (token: string): number | null => {
    if (!/^[+-]?(?:\d*\.)?\d+(?:e[+-]?\d+)?%?$/i.test(token)) return null;
    const number = Number(token.replace(/%$/, ''));
    return Number.isFinite(number) ? number : null;
  };
  if (alpha !== undefined && quantity(alpha) === null) return null;
  const clamp = (number: number, max = 1) => Math.max(0, Math.min(max, number));
  const encode = (channels: number[]): string | null => channels.every(Number.isFinite)
    ? `#${channels.map(channel => Math.round(clamp(channel) * 255).toString(16).padStart(2, '0')).join('')}`
    : null;
  if (kind === 'rgb' || kind === 'rgba') {
    // Legacy comma syntax requires either three numbers or three percentages.
    if (legacy && parts.some(part => part.endsWith('%')) && !parts.every(part => part.endsWith('%'))) return null;
    const channels = parts.map(part => {
      const number = quantity(part);
      return number === null ? NaN : number / (part.endsWith('%') ? 100 : 255);
    });
    return encode(channels);
  }
  const hueIndex = kind === 'oklch' ? 2 : 0;
  const angle = /^([+-]?(?:\d*\.)?\d+(?:e[+-]?\d+)?)(deg|grad|rad|turn)?$/i.exec(parts[hueIndex]!);
  if (!angle || !Number.isFinite(Number(angle[1]))) return null;
  const hueUnits: Record<string, number> = { deg: 1, grad: .9, rad: 180 / Math.PI, turn: 360 };
  const hue = ((Number(angle[1]) * hueUnits[angle[2]?.toLowerCase() ?? 'deg']!) % 360 + 360) % 360;
  if (kind === 'hsl' || kind === 'hsla') {
    if (!parts[1]!.endsWith('%') || !parts[2]!.endsWith('%')) return null;
    const saturation = quantity(parts[1]!);
    const lightness = quantity(parts[2]!);
    if (saturation === null || lightness === null) return null;
    const light = clamp(lightness / 100);
    const chroma = (1 - Math.abs(2 * light - 1)) * clamp(saturation / 100);
    const x = chroma * (1 - Math.abs((hue / 60) % 2 - 1));
    const channels = hue < 60 ? [chroma, x, 0] : hue < 120 ? [x, chroma, 0] : hue < 180 ? [0, chroma, x]
      : hue < 240 ? [0, x, chroma] : hue < 300 ? [x, 0, chroma] : [chroma, 0, x];
    return encode(channels.map(channel => channel + light - chroma / 2));
  }
  const lightness = quantity(parts[0]!);
  const chroma = quantity(parts[1]!);
  if (lightness === null || chroma === null) return null;
  const light = clamp(lightness / (parts[0]!.endsWith('%') ? 100 : 1));
  const chromaticity = Math.max(0, chroma * (parts[1]!.endsWith('%') ? .004 : 1));
  const a = chromaticity * Math.cos(hue * Math.PI / 180);
  const b = chromaticity * Math.sin(hue * Math.PI / 180);
  // OKLCH → Oklab → linear sRGB, followed by sRGB encoding. The bounded
  // fallback clips out-of-gamut channels; it never alters the original color.
  // https://www.w3.org/TR/css-color-4/#color-conversion-code
  const l = (light + .3963377774 * a + .2158037573 * b) ** 3;
  const m = (light - .1055613458 * a - .0638541728 * b) ** 3;
  const s = (light - .0894841775 * a - 1.2914855480 * b) ** 3;
  const linear = [4.0767416621 * l - 3.3077115913 * m + .2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - .3413193965 * s,
    -.0041960863 * l - .7034186147 * m + 1.7076147010 * s];
  return encode(linear.map(channel => channel <= .0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - .055));
}

/**
 * Generate CSS variable declarations from theme
 * @param theme - Resolved theme object
 * @param isDark - Whether to apply dark mode overrides
 * @returns CSS string with variable declarations
 */
export function themeToCSS(theme: ThemeOverrides, isDark: boolean = false): string {
  const vars: string[] = [];

  // Get effective colors (merge dark overrides if in dark mode)
  const colors: ThemeColors & SurfaceColors =
    isDark && theme.dark
      ? { ...theme, ...theme.dark, terminalAnsi: { ...theme.terminalAnsi, ...theme.dark.terminalAnsi } }
      : theme;

  // Semantic color variables
  if (colors.background) vars.push(`--background: ${colors.background};`);
  if (colors.foreground) {
    vars.push(`--foreground: ${colors.foreground};`);
    // Also output RGB version for shadow borders (only works with hex colors)
    const rgbValues = hexToRgbValues(colors.foreground);
    if (rgbValues) {
      vars.push(`--foreground-rgb: ${rgbValues};`);
    }
  }
  if (colors.accent) {
    vars.push(`--accent: ${colors.accent};`);
    // Also output darkened RGB version for shadow-tinted (only works with hex colors)
    // Use 70% brightness for a proper shadow effect
    const rgbValues = hexToRgbValues(colors.accent, 0.7);
    if (rgbValues) {
      vars.push(`--accent-rgb: ${rgbValues};`);
    }
  }
  if (colors.info) vars.push(`--info: ${colors.info};`);
  const stateVariables = {
    accentText: 'accent-text',
    textSecondary: 'text-secondary', textMuted: 'text-muted', textDisabled: 'text-disabled',
    focus: 'focus', borderSubtle: 'border-subtle', borderStrong: 'border-strong',
    borderFocused: 'border-focused', elementHover: 'element-hover', elementSelected: 'element-selected',
    terminalBrightForeground: 'terminal-bright-foreground', terminalDimForeground: 'terminal-dim-foreground',
  } as const;
  for (const [key, variable] of Object.entries(stateVariables)) {
    const color = colors[key as keyof typeof stateVariables];
    if (color) vars.push(`--${variable}: ${color};`);
  }
  if (colors.terminalBackground) vars.push(`--terminal-background: ${colors.terminalBackground};`);
  if (colors.terminalForeground) vars.push(`--terminal-foreground: ${colors.terminalForeground};`);
  if (colors.terminalCursor) vars.push(`--terminal-cursor: ${colors.terminalCursor};`);
  if (colors.terminalSelection) vars.push(`--terminal-selection: ${colors.terminalSelection};`);
  for (const name of TERMINAL_ANSI_COLOR_NAMES) {
    const color = colors.terminalAnsi?.[name];
    if (color) {
      const variable = name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
      vars.push(`--terminal-ansi-${variable}: ${color};`);
    }
  }
  if (colors.success) vars.push(`--success: ${colors.success};`);
  if (colors.destructive) vars.push(`--destructive: ${colors.destructive};`);

  // Surface color variables (fall back to background if not set)
  // These enable fine-grained control over specific UI regions
  const bg = colors.background || 'var(--background)';
  vars.push(`--paper: ${colors.paper || bg};`);
  vars.push(`--navigator: ${colors.navigator || bg};`);
  vars.push(`--input-surface: ${colors.input || bg};`);
  vars.push(`--popover: ${colors.popover || bg};`);
  // popoverSolid: guaranteed 100% opaque for scenic mode popovers
  // Falls back to popover, then background (should always be solid in scenic themes)
  vars.push(`--popover-solid: ${colors.popoverSolid || colors.popover || bg};`);
  const chromeVariables = {
    titlebar: 'titlebar', toolbar: 'toolbar', tabBar: 'tab-bar', tabActive: 'tab-active', tabInactive: 'tab-inactive',
  } as const;
  for (const [key, variable] of Object.entries(chromeVariables)) {
    vars.push(`--surface-${variable}: ${colors[key as keyof typeof chromeVariables] || bg};`);
  }

  // Separate guaranteed-opaque RGB tokens for browsers without relative color
  // syntax. Complex expressions fall back to the chosen canvas, then base RGB.
  const opaqueBackground = opaqueHexColor(colors.background) ?? getBackgroundColor(isDark);
  vars.push(`--canvas-opaque: ${opaqueBackground};`);
  const opaqueSurfaces = {
    paper: 'paper', navigator: 'navigator', input: 'input-surface',
    titlebar: 'surface-titlebar', toolbar: 'surface-toolbar',
  } as const;
  for (const [key, variable] of Object.entries(opaqueSurfaces)) {
    vars.push(`--${variable}-opaque: ${opaqueHexColor(colors[key as keyof typeof opaqueSurfaces]) ?? opaqueBackground};`);
  }

  // Theme mode (background image is set directly on document.documentElement.style
  // to avoid style sheet size limits with large data URLs)
  const mode = theme.mode || 'solid';
  vars.push(`--theme-mode: ${mode};`);

  return vars.join('\n  ');
}

/**
 * Hex equivalents of background colors for Electron BrowserWindow.
 * The main process cannot use CSS/oklch colors, so we provide hex values
 * that visually match the DEFAULT_THEME oklch colors.
 */
export const BACKGROUND_HEX = {
  light: '#faf9fb', // matches oklch(0.98 0.003 265)
  dark: '#302f33', // matches oklch(0.2 0.005 270)
} as const;

/**
 * Get background color hex value for BrowserWindow backgroundColor.
 * Use this in the main process where CSS variables aren't available.
 */
export function getBackgroundColor(isDark: boolean): string {
  return isDark ? BACKGROUND_HEX.dark : BACKGROUND_HEX.light;
}

/**
 * Named solid palettes (GitHub, Ghostty, Pierre, …) ship explicit hex
 * backgrounds. The 50% vibrancy overlay lets the desktop wallpaper tint
 * those surfaces (warm/red wash). Keep the overlay for the default theme
 * and for scenic wallpapers, which have their own ::before layer.
 */
export function shouldSetThemeOverride(
  colorTheme: string | null | undefined,
  scenic: boolean,
): boolean {
  if (scenic) return true
  if (!colorTheme || colorTheme === 'default') return true
  return false
}

/**
 * Default theme values (matches current index.css)
 */
export const DEFAULT_THEME: ThemeOverrides = {
  background: 'oklch(0.98 0.003 265)',
  foreground: 'oklch(0.185 0.01 270)',
  accent: 'oklch(0.58 0.22 293)',
  info: 'oklch(0.75 0.16 70)',
  success: 'oklch(0.55 0.17 145)',
  destructive: 'oklch(0.58 0.24 28)',
  dark: {
    background: 'oklch(0.145 0.015 270)',
    foreground: 'oklch(0.95 0.01 270)',
    accent: 'oklch(0.65 0.22 293)',
    info: 'oklch(0.78 0.14 70)',
    success: 'oklch(0.60 0.17 145)',
    destructive: 'oklch(0.65 0.22 28)',
  },
};

// ============================================
// Preset Themes
// ============================================

/**
 * Shiki theme configuration for syntax highlighting
 */
export interface ShikiThemeConfig {
  light?: string;
  dark?: string;
}

/**
 * Extended theme file format with metadata
 * Used for preset themes stored as JSON files
 */
export interface ThemeFile extends ThemeOverrides {
  name?: string;
  description?: string;
  author?: string;
  license?: string;
  source?: string;
  supportedModes?: ('light' | 'dark')[];
  shikiTheme?: ShikiThemeConfig;
}

/**
 * Preset theme with ID and path
 */
export interface PresetTheme {
  id: string; // filename without .json (e.g., 'dracula')
  path: string; // full path to theme.json
  theme: ThemeFile; // parsed theme data
}

/**
 * Default Shiki themes (used when no preset is selected)
 */
export const DEFAULT_SHIKI_THEME: ShikiThemeConfig = {
  light: 'github-light',
  dark: 'github-dark',
};

/**
 * Get Shiki theme name for current mode
 */
export function getShikiTheme(
  shikiConfig: ShikiThemeConfig | undefined,
  isDark: boolean
): string {
  const config = shikiConfig || DEFAULT_SHIKI_THEME;
  return isDark ? config.dark || 'github-dark' : config.light || 'github-light';
}
