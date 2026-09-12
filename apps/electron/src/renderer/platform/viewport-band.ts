/** Breakpoints from Rox issue 32: 375 / 768 / 1280 / 1800. */

export const VIEWPORT_NARROW_MAX = 375
export const VIEWPORT_COMPACT_MAX = 768
export const VIEWPORT_THREE_PANE = 1280
export const VIEWPORT_WIDE_MIN = 1800

export type ViewportBand = 'narrow' | 'compact' | 'three-pane' | 'wide'

export function viewportBand(width: number): ViewportBand {
  if (width <= VIEWPORT_NARROW_MAX) return 'narrow'
  if (width < VIEWPORT_COMPACT_MAX) return 'compact'
  if (width < VIEWPORT_WIDE_MIN) return 'three-pane'
  return 'wide'
}

export function isSinglePane(band: ViewportBand): boolean {
  return band === 'narrow' || band === 'compact'
}

export function isRailCollapsed(band: ViewportBand): boolean {
  return band === 'narrow' || band === 'compact'
}

export function viewportGutter(band: ViewportBand): number {
  return band === 'wide' ? 12 : 8
}
