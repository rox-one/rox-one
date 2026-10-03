/**
 * Gap between adjacent panels (sidebar ↔ navigator ↔ content ↔ right sidebar).
 * Panes meet at a single hairline; the resize hit area overlaps the seam.
 */
export const PANEL_GAP = 0

/** Large panes meet the native window boundary without an HTML gutter. */
export const PANEL_EDGE_INSET = 0

/** Minimum width for any content panel */
export const PANEL_MIN_WIDTH = 440

/**
 * Minimum width the single session/center column keeps before the shell
 * collapses the right inspector panel and then narrows the restored list and
 * navigator widths (see shell-width-clamp.ts / inspector-layout.ts).
 */
export const CENTER_MIN_WIDTH = 420

/** Extra vertical space reserved in panel stack for box-shadows. */
export const PANEL_STACK_VERTICAL_OVERFLOW = 0

/** Space between the TopBar and the desktop panel stack. */
export const PANEL_STACK_TOP_INSET = 0

/**
 * Space under the desktop panel stack. The outer shell already pads the
 * bottom by PANEL_EDGE_INSET, so the stack itself adds nothing.
 */
export const PANEL_STACK_BOTTOM_INSET = 0

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
 * An inline sash keeps its full accessible hit width while consuming no
 * layout space: each half overlaps its adjacent pane. Use the actual pointer
 * hit width, including the coarse-pointer variant.
 */
export function inlineSashGeometry(hitWidth: number): {
  width: number
  flexShrink: number
  marginLeft: number
  marginRight: number
} {
  return { width: hitWidth, flexShrink: 0, marginLeft: -hitWidth / 2, marginRight: -hitWidth / 2 }
}

/** Half-width helper for centering sash containers on seam coordinates. */
export const PANEL_SASH_HALF_HIT_WIDTH = PANEL_SASH_HIT_WIDTH / 2
