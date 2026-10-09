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
  accent?: CSSColor; // Theme accent (primary actions and focus)
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
 * Material (glass) layer — configurable transparency/blur/texture settings.
 * Surface names mirror the shell glass tokens (`--shell-glass-*`).
 */
export const MATERIAL_SURFACES = [
  'topbar', 'rail', 'strip', 'inspector', 'sidebar', 'navigator', 'chat', 'composer', 'popover',
] as const;
export type MaterialSurface = typeof MATERIAL_SURFACES[number];

/** Content panes that can opt into translucency ("deep glass", opt-in per pane). */
export const MATERIAL_CONTENT_PANES = ['content', 'editor', 'lists'] as const;
export type MaterialContentPane = typeof MATERIAL_CONTENT_PANES[number];

export const MATERIAL_TEXTURE_KINDS = ['none', 'grain', 'scanlines', 'pinstripe', 'herringbone'] as const;
export type MaterialTextureKind = typeof MATERIAL_TEXTURE_KINDS[number];

export const MATERIAL_CHAT_EFFECT_KINDS = ['none', 'gradient', 'dither', 'ascii', 'halftone', 'scanlines'] as const;
export type MaterialChatEffectKind = typeof MATERIAL_CHAT_EFFECT_KINDS[number];

export interface MaterialTintSettings {
  /** Hue shift applied to the glass tint, degrees (-180..180). */
  hue?: number;
  /** Saturation adjustment, percent (-100..100). */
  saturation?: number;
  /** Lightness adjustment, percent (-30..30). */
  lightness?: number;
}

export interface MaterialTextureSettings {
  kind?: MaterialTextureKind;
  /** Texture strength, 0..1. */
  intensity?: number;
  /** Texture scale, 0.5..3. */
  scale?: number;
}

export interface MaterialHazeSettings {
  enabled?: boolean;
  /** Haze strength, 0..1. */
  intensity?: number;
}

export interface MaterialChatEffectSettings {
  kind?: MaterialChatEffectKind;
  /** Effect strength, 0..1. */
  intensity?: number;
}

/**
 * Material ("glass") settings for the configurable transparent theme layer.
 * Every field is optional: an absent field keeps the current solid behavior.
 * `enabled: true` opts the shell into the material layer.
 */
export interface MaterialSettings {
  enabled?: boolean;
  /** Native window tint source (macOS vibrancy / Windows Mica tint). */
  nativeTint?: 'theme' | 'custom' | 'off';
  /** Tint color when nativeTint === 'custom'. */
  tintColor?: CSSColor;
  /** Per-surface blur radius in px (0..64). */
  blur?: Partial<Record<MaterialSurface, number>>;
  /** Per-surface opacity as a fraction of the opaque surface color (0..1). */
  opacity?: Partial<Record<MaterialSurface, number>>;
  tint?: MaterialTintSettings;
  texture?: MaterialTextureSettings;
  haze?: MaterialHazeSettings;
  /** Matte underlay strength, 0..1 (1 = fully opaque panes). */
  matte?: number;
  /** Opt-in translucency for content panes (advanced; off by default). */
  deepGlass?: Partial<Record<MaterialContentPane, boolean>>;
  chatEffect?: MaterialChatEffectSettings;
}

/**
 * Defaults applied when the material layer is enabled. Mirror the shipped
 * shell tokens (20px chrome blur, 84/82/88% tints) with per-surface ranges.
 */
export const MATERIAL_DEFAULTS = {
  blur: {
    topbar: 20, rail: 20, strip: 20, inspector: 20,
    sidebar: 20, navigator: 20, chat: 12, composer: 14, popover: 24,
  },
  opacity: {
    topbar: 0.84, rail: 0.82, strip: 0.88, inspector: 0.88,
    sidebar: 0.86, navigator: 0.86, chat: 0.55, composer: 0.7, popover: 0.92,
  },
  texture: { kind: 'none', intensity: 0.35, scale: 1 },
  haze: { enabled: false, intensity: 0.5 },
  chatEffect: { kind: 'none', intensity: 0.5 },
} as const;

const clampNumber = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** Deep-merge material settings (override wins per field/subfield). */
export function mergeMaterialSettings(
  base: MaterialSettings | undefined,
  override: MaterialSettings | undefined,
): MaterialSettings | undefined {
  if (!base) return override;
  if (!override) return base;
  const mergeSub = <T extends object>(a: T | undefined, b: T | undefined): T | undefined => {
    if (!a) return b;
    if (!b) return a;
    return { ...a, ...b };
  };
  const result: MaterialSettings = { ...base, ...override };
  const blur = mergeSub(base.blur, override.blur);
  const opacity = mergeSub(base.opacity, override.opacity);
  const tint = mergeSub(base.tint, override.tint);
  const texture = mergeSub(base.texture, override.texture);
  const haze = mergeSub(base.haze, override.haze);
  const deepGlass = mergeSub(base.deepGlass, override.deepGlass);
  const chatEffect = mergeSub(base.chatEffect, override.chatEffect);
  if (blur) result.blur = blur; else delete result.blur;
  if (opacity) result.opacity = opacity; else delete result.opacity;
  if (tint) result.tint = tint; else delete result.tint;
  if (texture) result.texture = texture; else delete result.texture;
  if (haze) result.haze = haze; else delete result.haze;
  if (deepGlass) result.deepGlass = deepGlass; else delete result.deepGlass;
  if (chatEffect) result.chatEffect = chatEffect; else delete result.chatEffect;
  return result;
}

export interface MaterialResolveContext {
  reduceTransparency?: boolean;
  highContrast?: boolean;
  renderProfile?: 'standard' | 'performance';
}

export interface ResolvedMaterial {
  enabled: boolean;
  disabledReason?: 'off' | 'reduce-transparency' | 'high-contrast';
  nativeTint: 'theme' | 'custom' | 'off';
  tintColor?: CSSColor;
  blur: Record<MaterialSurface, number>;
  opacity: Record<MaterialSurface, number>;
  tint?: MaterialTintSettings;
  texture: Required<MaterialTextureSettings>;
  haze: Required<MaterialHazeSettings>;
  matte: number;
  deepGlass: Partial<Record<MaterialContentPane, boolean>>;
  chatEffect: Required<MaterialChatEffectSettings>;
}

/**
 * Pure resolver for the material layer. Combines user settings with the
 * accessibility/performance gates the shell already honors:
 * reduce-transparency and high contrast force a solid surface, the
 * performance render profile keeps the tint but zeroes every blur radius.
 */
export function resolveMaterial(
  material: MaterialSettings | undefined,
  context: MaterialResolveContext = {},
): ResolvedMaterial {
  const blur = {} as Record<MaterialSurface, number>;
  const opacity = {} as Record<MaterialSurface, number>;
  for (const surface of MATERIAL_SURFACES) {
    blur[surface] = clampNumber(material?.blur?.[surface] ?? MATERIAL_DEFAULTS.blur[surface], 0, 64);
    opacity[surface] = clampNumber(material?.opacity?.[surface] ?? MATERIAL_DEFAULTS.opacity[surface], 0, 1);
  }
  const resolved: ResolvedMaterial = {
    enabled: Boolean(material?.enabled),
    nativeTint: material?.nativeTint ?? 'theme',
    tintColor: material?.tintColor,
    blur,
    opacity,
    tint: material?.tint ? { ...material.tint } : undefined,
    texture: { kind: 'none', intensity: 0.35, scale: 1, ...material?.texture },
    haze: { enabled: false, intensity: 0.5, ...material?.haze },
    matte: clampNumber(material?.matte ?? 0, 0, 1),
    deepGlass: { ...material?.deepGlass },
    chatEffect: { kind: 'none', intensity: 0.5, ...material?.chatEffect },
  };
  if (!resolved.enabled) return { ...resolved, disabledReason: 'off' };
  if (context.highContrast) return { ...resolved, enabled: false, disabledReason: 'high-contrast' };
  if (context.reduceTransparency) return { ...resolved, enabled: false, disabledReason: 'reduce-transparency' };
  if (context.renderProfile === 'performance') {
    for (const surface of MATERIAL_SURFACES) blur[surface] = 0;
  }
  return resolved;
}

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

  /**
   * Material (glass) layer settings — blur/opacity/tint/texture/haze/matte and
   * per-surface opt-ins. Absent keeps the current solid surface behavior.
   */
  material?: MaterialSettings;
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

  // Deep merge material (glass) settings
  const material = mergeMaterialSettings(base.material, override.material);
  if (material !== undefined) result.material = material;

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
    // Keep the semantic RGB alias in sync for tinted surfaces and status UI.
    const rgbValues = hexToRgbValues(colors.accent);
    if (rgbValues) {
      vars.push(`--accent-rgb: ${rgbValues};`);
    }
  }
  for (const role of ['info', 'success', 'destructive'] as const) {
    const color = colors[role];
    if (!color) continue;
    vars.push(`--${role}: ${color};`);
    const rgbValues = hexToRgbValues(color);
    if (rgbValues) vars.push(`--${role}-rgb: ${rgbValues};`);
  }
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

  // Surface color variables (fall back to background if not set)
  // These enable fine-grained control over specific UI regions
  const bg = colors.background || 'var(--background)';
  vars.push(`--paper: ${colors.paper || bg};`);
  vars.push(`--navigator: ${colors.navigator || bg};`);
  // `--input` is the shared border alias; presets supply the input surface.
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

  // Material (glass) layer variables. Emitted only when the layer is enabled;
  // consumers fall back to their static shell tokens otherwise.
  const material = theme.material;
  if (material?.enabled) {
    const blur = { ...MATERIAL_DEFAULTS.blur, ...material.blur };
    const opacity = { ...MATERIAL_DEFAULTS.opacity, ...material.opacity };
    for (const surface of MATERIAL_SURFACES) {
      // Clamp at emission: the desktop load paths (theme.json/preset files)
      // bypass the schema, so raw values can be out of range.
      vars.push(`--material-blur-${surface}: ${clampNumber(blur[surface], 0, 64)}px;`);
      vars.push(`--material-opacity-${surface}: ${Math.round(clampNumber(opacity[surface], 0, 1) * 1000) / 10}%;`);
    }
    if (material.tint) {
      if (material.tint.hue !== undefined) vars.push(`--material-tint-hue: ${clampNumber(material.tint.hue, -180, 180)};`);
      if (material.tint.saturation !== undefined) vars.push(`--material-tint-saturation: ${clampNumber(material.tint.saturation, -100, 100)};`);
      if (material.tint.lightness !== undefined) vars.push(`--material-tint-lightness: ${clampNumber(material.tint.lightness, -30, 30)};`);
    }
    const texture = { ...MATERIAL_DEFAULTS.texture, ...material.texture };
    if (texture.kind !== 'none') {
      vars.push(`--material-texture-kind: ${texture.kind};`);
      vars.push(`--material-texture-intensity: ${clampNumber(texture.intensity, 0, 1)};`);
      vars.push(`--material-texture-scale: ${clampNumber(texture.scale, 0.5, 3)};`);
    }
    const haze = { ...MATERIAL_DEFAULTS.haze, ...material.haze };
    if (haze.enabled) vars.push(`--material-haze-intensity: ${clampNumber(haze.intensity, 0, 1)};`);
    if (material.matte !== undefined) vars.push(`--material-matte: ${clampNumber(material.matte, 0, 1)};`);
    const chatEffect = { ...MATERIAL_DEFAULTS.chatEffect, ...material.chatEffect };
    if (chatEffect.kind !== 'none') {
      vars.push(`--material-chat-effect: ${chatEffect.kind};`);
      vars.push(`--material-chat-effect-intensity: ${clampNumber(chatEffect.intensity, 0, 1)};`);
    }
  }

  return vars.join('\n  ');
}

/**
 * Hex equivalents of background colors for Electron BrowserWindow.
 * The main process and CSS share the same opaque default window colors.
 */
export const BACKGROUND_HEX = {
  light: '#f7f7f5',
  dark: '#202120',
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
  background: BACKGROUND_HEX.light,
  foreground: '#262624',
  accent: '#a65c3a',
  info: '#97681e',
  success: '#347a51',
  destructive: '#bc4844',
  dark: {
    background: BACKGROUND_HEX.dark,
    foreground: '#ededeb',
    accent: '#d9936c',
    info: '#dfb567',
    success: '#79b78f',
    destructive: '#e48078',
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
  /** Optional shell profile for `html[data-ui-profile]` (e.g. super-engineering). */
  uiProfile?: string;
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
