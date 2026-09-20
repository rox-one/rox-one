/** Gap between any adjacent panels (sidebar ↔ navigator ↔ content ↔ right sidebar) */
export const PANEL_GAP = 4

/** Padding from window edges to outermost panels (right, bottom, left when sidebar hidden) */
export const PANEL_EDGE_INSET = 4

/** Corner radius for panel edges touching the window boundary */
export const RADIUS_EDGE = 8

/** Corner radius for interior corners between panels */
export const RADIUS_INNER = 8

/** Minimum width for any content panel */
export const PANEL_MIN_WIDTH = 440

/** Extra vertical space reserved in panel stack for box-shadows. */
export const PANEL_STACK_VERTICAL_OVERFLOW = 0

/** Breathing room between the TopBar and the desktop panel stack. */
export const PANEL_STACK_TOP_INSET = 4

/** Breathing room under the desktop panel stack. */
export const PANEL_STACK_BOTTOM_INSET = 4

/**
 * Shared resize sash geometry.
 *
 * Keep all seams (sidebar, navigator/content, panel/panel) aligned by deriving
 * offsets from these constants instead of hardcoded pixel literals.
 */
export const PANEL_SASH_HIT_WIDTH = 12
export const PANEL_SASH_HIT_WIDTH_COARSE = 24
export const PANEL_SASH_LINE_WIDTH = 2

/**
 * When the sash is inserted between two flex items, flex gap would apply twice
 * (item↔sash and sash↔item). Pull it back by half the gap on both sides so
 * the visible distance remains exactly PANEL_GAP.
 */
export const PANEL_SASH_FLEX_MARGIN = -(PANEL_GAP / 2)

/** Half-width helper for centering sash containers on seam coordinates. */
export const PANEL_SASH_HALF_HIT_WIDTH = PANEL_SASH_HIT_WIDTH / 2
