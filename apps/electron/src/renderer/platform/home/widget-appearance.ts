export const WIDGET_PALETTES = ['neutral', 'mint', 'ocean', 'violet', 'sunset'] as const
export type WidgetPalette = typeof WIDGET_PALETTES[number]

export interface WidgetAppearance {
  palette: WidgetPalette
  saturation: number
  contrast: number
}

export const DEFAULT_WIDGET_APPEARANCE: Readonly<WidgetAppearance> = { palette: 'neutral', saturation: 40, contrast: 40 }
export const WIDGET_DESIGN_PRESETS: readonly { id: string; appearance: Readonly<WidgetAppearance> }[] = [
  { id: 'calm', appearance: { palette: 'neutral', saturation: 20, contrast: 25 } },
  { id: 'fresh', appearance: { palette: 'mint', saturation: 45, contrast: 35 } },
  { id: 'vivid', appearance: { palette: 'ocean', saturation: 85, contrast: 55 } },
  { id: 'bold', appearance: { palette: 'violet', saturation: 65, contrast: 90 } },
  { id: 'warm', appearance: { palette: 'sunset', saturation: 60, contrast: 45 } },
]

export const WIDGET_PALETTE_HUES: Record<WidgetPalette, number> = { neutral: 260, mint: 160, ocean: 230, violet: 300, sunset: 50 }

export function isWidgetAppearance(value: unknown): value is WidgetAppearance {
  if (!value || typeof value !== 'object') return false
  const v = value as WidgetAppearance
  return Object.keys(v).every((key) => ['palette', 'saturation', 'contrast'].includes(key))
    && WIDGET_PALETTES.includes(v.palette)
    && [v.saturation, v.contrast].every((number) => typeof number === 'number' && Number.isFinite(number) && number >= 0 && number <= 100)
}

export function matchingWidgetPreset(appearance: WidgetAppearance): string | undefined {
  return WIDGET_DESIGN_PRESETS.find(({ appearance: candidate }) => candidate.palette === appearance.palette
    && candidate.saturation === appearance.saturation && candidate.contrast === appearance.contrast)?.id
}

/** Tint surfaces, never the content: readable text and icons retain theme colors.
 * The background blend is bounded so even a maximum saturation/contrast stays
 * readable in both themes; contrast also strengthens the inner edge.
 */
export function widgetAppearanceStyle(value?: WidgetAppearance): Record<string, string> {
  if (!value) return {}
  const chroma = value.saturation / (value.palette === 'neutral' ? 6250 : 500)
  const color = `oklch(70% ${chroma} ${WIDGET_PALETTE_HUES[value.palette]})`
  return {
    '--widget-surface': `color-mix(in oklch, ${color} ${4 + value.contrast * 0.12}%, var(--widget-base, var(--background)))`,
    '--widget-border': `inset 0 0 0 1px color-mix(in oklch, ${color} ${8 + value.contrast * 0.3}%, transparent)`,
  }
}
