/** Breakpoints from Rox issue 32: 375 / 768 / 1280 / 1800. */

export const VIEWPORT_NARROW_MAX = 375
export const VIEWPORT_COMPACT_MAX = 768
export const VIEWPORT_THREE_PANE = 1280
export const VIEWPORT_WIDE_MIN = 1800

/** Shell width breakpoints; mirrors --shell-bp-* in packages/ui tokens/chrome.css. */
export const SHELL_BREAKPOINTS = {
  compact: 900,
  regular: VIEWPORT_THREE_PANE,
  wide: 1600,
  ultra: 2560,
} as const

export type ShellBand = keyof typeof SHELL_BREAKPOINTS

/**
 * Outer shell edge inset (px) under Rox Engineering at each shell band.
 * Mirrors --shell-edge-inset set from data-shell-band in index.css.
 * compact/regular stay 0 so existing chrome density is unchanged; wide/ultra
 * grow the frame so the paper/card does not dominate empty ultra-wide space.
 * Applied as padding on the shell flex row; useContainerWidth reads the
 * content box, so clampShellColumns and resize handles stay consistent
 * without a parallel reserved adjustment.
 */
export const SHELL_EDGE_INSET = {
  compact: 0,
  regular: 0,
  wide: 12,
  ultra: 24,
} as const

export type ViewportBand = 'narrow' | 'compact' | 'three-pane' | 'wide'

export function viewportBand(width: number): ViewportBand {
  if (width <= VIEWPORT_NARROW_MAX) return 'narrow'
  if (width < VIEWPORT_COMPACT_MAX) return 'compact'
  if (width < VIEWPORT_WIDE_MIN) return 'three-pane'
  return 'wide'
}

/** Shell band from measured shell width; mirrors SHELL_BREAKPOINTS / --shell-bp-*. */
export function shellBand(width: number): ShellBand {
  if (width >= SHELL_BREAKPOINTS.ultra) return 'ultra'
  if (width >= SHELL_BREAKPOINTS.wide) return 'wide'
  if (width >= SHELL_BREAKPOINTS.regular) return 'regular'
  return 'compact'
}

export function shellEdgeInset(band: ShellBand): number {
  return SHELL_EDGE_INSET[band]
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
