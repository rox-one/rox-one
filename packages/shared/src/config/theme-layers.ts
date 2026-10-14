/**
 * Theme layers (Arc Glass customization, 2026-10-14).
 *
 * Four paint layers sit on top of the classic palette:
 *   L0 wallpaper  --wallpaper                 seen through a translucent frame
 *   L1 frame      --frame-bg/fg/muted/border  rail, sidebar, titlebar, status bar, inspector
 *   L2 content    --content-bg/fg/border      the reading surface (optionally a floating card)
 *   L3 elevation  --elev-1/2/3                cards, popovers/composer, modals
 * plus the accent, one glass intensity and the grid hairline divider.
 *
 * Layers are additive: a theme without `layers` emits nothing new and every
 * legacy variable keeps its preset value. When a layer IS set, the legacy
 * variables it replaces (`--navigator`, `--surface-titlebar`, `--background`,
 * `--paper`, …) are aliased to it, so components that read the old names
 * follow the new layer without being touched.
 *
 * Pure module (no DOM, no Node): shared by the renderer, the settings page,
 * the validators and the tests.
 */

/** Any CSS color string (the pickers write `#rrggbb`). */
export type LayerColor = string;

/** One gradient stop: color plus position 0..1. */
export type GradientStop = [LayerColor, number];

export const GRADIENT_TYPES = ['linear', 'radial'] as const;
export type GradientType = typeof GRADIENT_TYPES[number];

export interface ThemeGradient {
  type: GradientType;
  /** Linear angle in degrees (0..360). */
  angle?: number;
  /** Radial center in percent, `[x, y]` (0..100). */
  at?: [number, number];
  /** 2..5 stops, positions 0..1. */
  stops: GradientStop[];
}

export interface FrameLayer {
  bg?: LayerColor;
  fg?: LayerColor;
  muted?: LayerColor;
  border?: LayerColor;
  /** Optional tint gradient painted over the frame (fixed, so it is continuous across chrome pieces). */
  gradient?: ThemeGradient;
}

export const CONTENT_JOIN_MODES = ['line', 'shadow', 'float'] as const;
export type ContentJoinMode = typeof CONTENT_JOIN_MODES[number];

export interface ContentLayer {
  bg?: LayerColor;
  fg?: LayerColor;
  border?: LayerColor;
  /** How the content meets the frame: hairline, soft shadow, or a floating rounded card. */
  join?: ContentJoinMode;
  /** Card radius in px (0..24); used by `float`. */
  radius?: number;
}

export interface ElevationLayer {
  1?: LayerColor;
  2?: LayerColor;
  3?: LayerColor;
}

export type WallpaperLayer =
  | { type: 'solid'; color: LayerColor }
  | ThemeGradient;

export interface ThemeLayers {
  frame?: FrameLayer;
  content?: ContentLayer;
  elevation?: ElevationLayer;
  wallpaper?: WallpaperLayer;
  accent?: LayerColor;
  /** Single glass intensity 0..1: frame translucency + blur over the wallpaper. */
  glass?: number;
  /** Hairline between grid panels inside the content card. */
  gridDivider?: LayerColor;
}

// ---------------------------------------------------------------------------
// Color math (sRGB hex/rgb only; anything else is passed through untouched)
// ---------------------------------------------------------------------------

export interface Rgba { r: number; g: number; b: number; a: number }

/**
 * Fallback palette the layer editor and the mini-shell preview fall back to when
 * a layer is unset. Theme data, so it lives here next to the colour math rather
 * than as literals in renderer components.
 */
export const LAYER_FALLBACK = {
  dark: { content: '#17181b', frame: '#111215', fg: '#ededeb' },
  light: { content: '#f7f7f5', frame: '#ececea', fg: '#262624' },
  accent: '#38bdf8',
  previewFrame: '#101418',
  previewFg: '#eef1f4',
  previewMuted: '#848c98',
  previewBorder: 'rgba(255,255,255,.08)',
  previewContent: '#15171b',
  previewDivider: 'rgba(255,255,255,.09)',
  gradientEnd: '#0c0e12',
  wallpaper: '#1d3b4a',
} as const;

// ---------------------------------------------------------------------------
// Safe colour allowlist. Layer colours come from untrusted `.rox-theme.json`
// imports and are interpolated into CSS custom properties, so only these
// shapes are accepted: hex, numeric rgb()/rgba(), hsl()/hsla(), oklch()/oklab()
// and a few keywords. Anything else (url(), var(), expression(), ; { } \ quotes)
// is rejected by the schema and dropped by the emitter.
// ---------------------------------------------------------------------------

const NUM = String.raw`[+-]?(?:\d+(?:\.\d+)?|\.\d+)`;
const PCT_OR_NUM = String.raw`${NUM}%?`;
const ANGLE = String.raw`${NUM}(?:deg|rad|grad|turn)?`;
const SEP = String.raw`(?:\s*,\s*|\s+)`;
const ALPHA = String.raw`(?:\s*[,/]\s*${PCT_OR_NUM})?`;
const SAFE_COLOR_PATTERNS: RegExp[] = [
  /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i,
  new RegExp(String.raw`^rgba?\(\s*${PCT_OR_NUM}${SEP}${PCT_OR_NUM}${SEP}${PCT_OR_NUM}${ALPHA}\s*\)$`, 'i'),
  new RegExp(String.raw`^hsla?\(\s*${ANGLE}${SEP}${PCT_OR_NUM}${SEP}${PCT_OR_NUM}${ALPHA}\s*\)$`, 'i'),
  new RegExp(String.raw`^oklch\(\s*${PCT_OR_NUM}\s+${PCT_OR_NUM}\s+${ANGLE}(?:\s*/\s*${PCT_OR_NUM})?\s*\)$`, 'i'),
  new RegExp(String.raw`^oklab\(\s*${PCT_OR_NUM}\s+${NUM}\s+${NUM}(?:\s*/\s*${PCT_OR_NUM})?\s*\)$`, 'i'),
  /^(?:transparent|currentcolor|black|white)$/i,
];

/** True when `value` is a colour from the strict allowlist (max 64 chars). */
export function isSafeCssColor(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) return false;
  const trimmed = value.trim();
  return SAFE_COLOR_PATTERNS.some(re => re.test(trimmed));
}

export const safeColor = (value: string | undefined | null): string | undefined =>
  isSafeCssColor(value) ? value.trim() : undefined;

const finiteOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function parseColor(input: string | undefined | null): Rgba | null {
  if (!input) return null;
  const value = input.trim();
  const hex = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.exec(value);
  if (hex) {
    let d = hex[1]!;
    if (d.length <= 4) d = [...d].map(c => c + c).join('');
    const n = (i: number) => parseInt(d.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: d.length === 8 ? n(6) / 255 : 1 };
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(value);
  if (rgb) {
    const alphaRaw = rgb[4];
    const a = alphaRaw === undefined ? 1 : alphaRaw.endsWith('%') ? Number(alphaRaw.slice(0, -1)) / 100 : Number(alphaRaw);
    return { r: clamp(Number(rgb[1]), 0, 255), g: clamp(Number(rgb[2]), 0, 255), b: clamp(Number(rgb[3]), 0, 255), a: clamp(a, 0, 1) };
  }
  return null;
}

export function toHex({ r, g, b }: Rgba): string {
  const h = (n: number) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Mix `a` toward `b` by `amount` (0 = a, 1 = b), alpha-composited onto opaque. */
export function mixColors(a: string, b: string, amount: number): string | null {
  const x = parseColor(a);
  const y = parseColor(b);
  if (!x || !y) return null;
  const t = clamp(amount, 0, 1);
  return toHex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t, a: 1 });
}

/** Composite a (possibly translucent) color over an opaque backdrop. */
export function composite(top: Rgba, under: Rgba): Rgba {
  const a = top.a;
  return { r: top.r * a + under.r * (1 - a), g: top.g * a + under.g * (1 - a), b: top.b * a + under.b * (1 - a), a: 1 };
}

export function relativeLuminance({ r, g, b }: Rgba): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(fg: Rgba, bg: Rgba): number {
  const top = fg.a < 1 ? composite(fg, bg) : fg;
  const l1 = relativeLuminance(top);
  const l2 = relativeLuminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

export function isDarkColor(color: string): boolean {
  const parsed = parseColor(color);
  return parsed ? relativeLuminance(parsed) < 0.18 : true;
}

/**
 * Derived shades for a layer background: readable fg, muted, border and hover.
 * Used by the "linked" pickers so one color produces a coherent layer.
 */
export function deriveShades(bg: string): { fg: string; muted: string; border: string; hover: string } | null {
  const parsed = parseColor(bg);
  if (!parsed) return null;
  const dark = relativeLuminance(parsed) < 0.18;
  const ink = dark ? '#ffffff' : '#000000';
  const fg = mixColors(bg, ink, dark ? 0.9 : 0.86)!;
  return {
    fg,
    muted: mixColors(bg, ink, dark ? 0.58 : 0.55)!,
    border: mixColors(bg, ink, dark ? 0.1 : 0.1)!,
    hover: mixColors(bg, ink, 0.06)!,
  };
}

// ---------------------------------------------------------------------------
// CSS emission
// ---------------------------------------------------------------------------

function cssNumber(value: number, digits = 3): string {
  return String(Math.round(value * 10 ** digits) / 10 ** digits);
}

export function gradientToCSS(gradient: ThemeGradient): string {
  const safeStops = (Array.isArray(gradient.stops) ? gradient.stops : [])
    .filter((stop): stop is [string, number] => Array.isArray(stop) && isSafeCssColor(stop[0]))
    .map(([color, pos]) => [color.trim(), clamp(finiteOr(pos, 0), 0, 1)] as [string, number]);
  if (safeStops.length < 2) return 'none';
  const stops = safeStops
    .sort((a, b) => a[1] - b[1])
    .map(([color, pos]) => `${color} ${cssNumber(clamp(pos, 0, 1) * 100, 1)}%`)
    .join(', ');
  if (gradient.type === 'radial') {
    const x = finiteOr(gradient.at?.[0], 0);
    const y = finiteOr(gradient.at?.[1], 0);
    return `radial-gradient(130% 100% at ${cssNumber(clamp(x, 0, 100), 1)}% ${cssNumber(clamp(y, 0, 100), 1)}%, ${stops})`;
  }
  return `linear-gradient(${cssNumber((finiteOr(gradient.angle, 135) % 360 + 360) % 360, 1)}deg, ${stops})`;
}

export function wallpaperToCSS(wallpaper: WallpaperLayer): string {
  if (wallpaper.type === 'solid') return safeColor(wallpaper.color) ?? 'transparent';
  return gradientToCSS(wallpaper);
}

/** Opaque colors a wallpaper can show behind the frame (worst-case sampling). */
export function wallpaperSamples(wallpaper: WallpaperLayer | undefined): string[] {
  if (!wallpaper) return [];
  if (wallpaper.type === 'solid') return [wallpaper.color];
  return wallpaper.stops.map(([color]) => color);
}

/** Frame opacity for a glass intensity (1 = opaque frame, 0.4 at full glass). */
export function frameAlphaForGlass(glass: number | undefined): number {
  return 1 - clamp(glass ?? 0, 0, 1) * 0.6;
}

export const CONTENT_RADIUS_DEFAULT = 12;

/**
 * Patch the classic palette so legacy variables follow the layers
 * (`navigator`, titlebar/toolbar/tabBar → frame; background → content;
 * paper/popover → elevation; accent → layer accent). Mutates nothing.
 */
export function applyLayerAliases<T extends object>(colors: T, layers: ThemeLayers | undefined): T {
  if (!layers) return colors;
  const next = { ...colors } as Record<string, unknown>;
  const frame = layers.frame;
  if (frame?.bg) {
    for (const key of ['navigator', 'titlebar', 'toolbar', 'tabBar', 'tabInactive']) next[key] = frame.bg;
  }
  const content = layers.content;
  if (content?.bg) {
    next.background = content.bg;
    next.tabActive = content.bg;
  }
  if (content?.fg) next.foreground = content.fg;
  if (content?.border) next.borderSubtle = content.border;
  const elevation = layers.elevation;
  if (elevation?.[1]) next.paper = elevation[1];
  if (elevation?.[2]) { next.popover = elevation[2]; next.input = elevation[2]; }
  const solid = elevation?.[3] ?? elevation?.[2];
  if (solid) next.popoverSolid = solid;
  if (layers.accent) next.accent = layers.accent;
  return next as T;
}

/** CSS variable declarations for the layer tokens (empty when no layers). */
export function layersToCSSVars(layers: ThemeLayers | undefined): string[] {
  if (!layers) return [];
  const vars: string[] = [];
  const { frame, content, elevation } = layers;
  // Every colour is re-checked against the allowlist here too (defence in depth:
  // persisted configs may predate the strict schema).
  const frameBg = safeColor(frame?.bg);
  const accent = safeColor(layers.accent);
  const gridDivider = safeColor(layers.gridDivider);
  if (frameBg) vars.push(`--frame-bg: ${frameBg};`);
  const frameShades = frameBg ? deriveShades(frameBg) : null;
  const frameFg = safeColor(frame?.fg) ?? frameShades?.fg;
  const frameMuted = safeColor(frame?.muted) ?? frameShades?.muted;
  const frameBorder = safeColor(frame?.border) ?? frameShades?.border;
  if (frameFg) vars.push(`--frame-fg: ${frameFg};`);
  if (frameMuted) vars.push(`--frame-muted: ${frameMuted};`, `--chrome-label: ${frameMuted};`);
  if (frameBorder) vars.push(`--frame-border: ${frameBorder};`, `--chrome-plate-border: ${frameBorder};`);
  if (frameShades) vars.push(`--frame-hover: ${frameShades.hover};`);
  if (frame?.gradient) vars.push(`--frame-bg-image: ${gradientToCSS(frame.gradient)};`);
  if (safeColor(content?.bg)) vars.push(`--content-bg: ${safeColor(content!.bg)};`);
  if (safeColor(content?.fg)) vars.push(`--content-fg: ${safeColor(content!.fg)};`);
  if (safeColor(content?.border)) vars.push(`--content-border: ${safeColor(content!.border)};`, `--content-seam: ${safeColor(content!.border)};`);
  if (content?.join === 'line' || content?.join === 'shadow' || content?.join === 'float') {
    const radius = clamp(finiteOr(content.radius, CONTENT_RADIUS_DEFAULT), 0, 24);
    vars.push(`--content-radius: ${content.join === 'float' ? radius : 0}px;`);
  }
  if (safeColor(elevation?.[1])) vars.push(`--elev-1: ${safeColor(elevation![1])};`);
  if (safeColor(elevation?.[2])) vars.push(`--elev-2: ${safeColor(elevation![2])};`);
  if (safeColor(elevation?.[3])) vars.push(`--elev-3: ${safeColor(elevation![3])};`);
  if (layers.wallpaper && typeof layers.wallpaper === 'object') vars.push(`--wallpaper: ${wallpaperToCSS(layers.wallpaper)};`);
  if (typeof layers.glass === 'number' && Number.isFinite(layers.glass)) vars.push(`--glass-intensity: ${cssNumber(clamp(layers.glass, 0, 1), 2)};`);
  if (accent) vars.push(`--accent-soft: color-mix(in oklch, ${accent} 14%, transparent);`);
  if (gridDivider) vars.push(`--grid-divider: ${gridDivider};`);
  return vars;
}

/** Deep merge (override wins per layer field; gradients/wallpaper replace wholesale). */
export function mergeThemeLayers(base: ThemeLayers | undefined, override: ThemeLayers | undefined): ThemeLayers | undefined {
  if (!base) return override;
  if (!override) return base;
  const result: ThemeLayers = { ...base, ...override };
  if (base.frame || override.frame) result.frame = { ...base.frame, ...override.frame };
  if (base.content || override.content) result.content = { ...base.content, ...override.content };
  if (base.elevation || override.elevation) result.elevation = { ...base.elevation, ...override.elevation };
  return result;
}

// ---------------------------------------------------------------------------
// Contrast checks (WCAG) with an automatic fix
// ---------------------------------------------------------------------------

export type ContrastPairId = 'frameText' | 'frameMuted' | 'contentText' | 'accentText';

export interface ContrastResult {
  id: ContrastPairId;
  ratio: number;
  required: number;
  pass: boolean;
}

/** Resolved, opaque-or-null colors the checks run on. */
export interface ContrastInputs {
  frameBg?: string;
  frameFg?: string;
  frameMuted?: string;
  contentBg?: string;
  contentFg?: string;
  accent?: string;
  /** Text drawn on accent fills (defaults to the content bg, matching --accent-foreground). */
  accentFg?: string;
  wallpaper?: WallpaperLayer;
  glass?: number;
}

export function resolveContrastInputs(layers: ThemeLayers | undefined, fallback: { background?: string; foreground?: string; navigator?: string; accent?: string }): ContrastInputs {
  const frameBg = layers?.frame?.bg ?? fallback.navigator ?? fallback.background;
  const shades = frameBg ? deriveShades(frameBg) : null;
  const contentBg = layers?.content?.bg ?? fallback.background;
  return {
    frameBg,
    frameFg: layers?.frame?.fg ?? shades?.fg ?? fallback.foreground,
    frameMuted: layers?.frame?.muted ?? shades?.muted,
    contentBg,
    contentFg: layers?.content?.fg ?? fallback.foreground,
    accent: layers?.accent ?? fallback.accent,
    accentFg: contentBg,
    wallpaper: layers?.wallpaper,
    glass: layers?.glass,
  };
}

/** Every backdrop the frame can composite to: each wallpaper stop seen through the frame alpha. */
function frameBackdrops(inputs: ContrastInputs): Rgba[] {
  const bg = parseColor(inputs.frameBg);
  if (!bg) return [];
  const alpha = frameAlphaForGlass(inputs.glass) * bg.a;
  const samples = wallpaperSamples(inputs.wallpaper).map(parseColor).filter((c): c is Rgba => !!c);
  if (alpha >= 1 || samples.length === 0) return [{ ...bg, a: 1 }];
  return samples.map(sample => composite({ ...bg, a: alpha }, { ...sample, a: 1 }));
}

function worstRatio(fg: string | undefined, backdrops: Rgba[]): number | null {
  const color = parseColor(fg);
  if (!color || backdrops.length === 0) return null;
  return Math.min(...backdrops.map(backdrop => contrastRatio(color, backdrop)));
}

export function checkLayerContrast(inputs: ContrastInputs): ContrastResult[] {
  const results: ContrastResult[] = [];
  const push = (id: ContrastPairId, ratio: number | null, required: number) => {
    if (ratio === null) return;
    results.push({ id, ratio: Math.round(ratio * 100) / 100, required, pass: ratio >= required });
  };
  const frame = frameBackdrops(inputs);
  push('frameText', worstRatio(inputs.frameFg, frame), 4.5);
  push('frameMuted', worstRatio(inputs.frameMuted, frame), 3);
  const content = parseColor(inputs.contentBg);
  push('contentText', content ? worstRatio(inputs.contentFg, [{ ...content, a: 1 }]) : null, 4.5);
  const accent = parseColor(inputs.accent);
  push('accentText', accent ? worstRatio(inputs.accentFg, [{ ...accent, a: 1 }]) : null, 3);
  return results;
}

/**
 * Nudge `fg` toward white (dark backdrop) or black (light backdrop) in small
 * steps until it clears `required` against every backdrop. Returns the fixed
 * color, or the extreme when even that cannot pass.
 */
export function fixForeground(fg: string, backdrops: string[], required: number): string {
  const parsed = backdrops.map(parseColor).filter((c): c is Rgba => !!c).map(c => ({ ...c, a: 1 }));
  if (parsed.length === 0 || !parseColor(fg)) return fg;
  const avg = parsed.reduce((sum, c) => sum + relativeLuminance(c), 0) / parsed.length;
  const target = avg < 0.18 ? '#ffffff' : '#000000';
  for (let step = 0; step <= 20; step += 1) {
    const candidate = mixColors(fg, target, step / 20)!;
    const ratio = worstRatio(candidate, parsed);
    if (ratio !== null && ratio >= required) return candidate;
  }
  return target;
}

/** Apply the fix for one failing pair, returning the patched layers. */
export function fixLayerContrast(layers: ThemeLayers, inputs: ContrastInputs, id: ContrastPairId): ThemeLayers {
  const frameBackdropHex = frameBackdrops(inputs).map(toHex);
  switch (id) {
    case 'frameText':
      return { ...layers, frame: { ...layers.frame, fg: fixForeground(inputs.frameFg ?? '#ffffff', frameBackdropHex, 4.5) } };
    case 'frameMuted':
      return { ...layers, frame: { ...layers.frame, muted: fixForeground(inputs.frameMuted ?? '#999999', frameBackdropHex, 3) } };
    case 'contentText':
      return { ...layers, content: { ...layers.content, fg: fixForeground(inputs.contentFg ?? '#ffffff', inputs.contentBg ? [inputs.contentBg] : [], 4.5) } };
    case 'accentText': {
      // Text on accent is the content bg; move the accent itself away from it.
      const accent = inputs.accent ?? '#38bdf8';
      return { ...layers, accent: fixForeground(accent, inputs.accentFg ? [inputs.accentFg] : [], 3) };
    }
  }
}

// ---------------------------------------------------------------------------
// Portable theme file (.rox-theme.json)
// ---------------------------------------------------------------------------

export const ROX_THEME_FILE_VERSION = 1;
export const ROX_THEME_FILE_SCHEMA = 'https://rox.one/schemas/rox-theme.v1.json';

export interface RoxThemeFile {
  $schema?: string;
  version: number;
  name: string;
  /** Preset id the layers were designed on (informational). */
  base?: string;
  layers: ThemeLayers;
}

export function buildRoxThemeFile(name: string, layers: ThemeLayers, base?: string): RoxThemeFile {
  return { $schema: ROX_THEME_FILE_SCHEMA, version: ROX_THEME_FILE_VERSION, name, ...(base ? { base } : {}), layers };
}

/** File-name-safe slug for exports and user preset ids. */
export function themeSlug(name: string): string {
  const slug = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return slug || 'theme';
}
