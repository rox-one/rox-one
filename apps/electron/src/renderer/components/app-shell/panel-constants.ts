import { CHROME_TOKENS } from '../../platform/chrome-tokens'

/*
 * Shell geometry comes from the generated chrome tokens (source:
 * packages/ui/src/styles/tokens/chrome.css). Edit the CSS and regenerate;
 * never put a literal here.
 */

/**
 * Gap between adjacent panels (sidebar ↔ navigator ↔ content ↔ right sidebar).
 * Panes meet at a single hairline; the resize hit area overlaps the seam.
 */
export const PANEL_GAP = CHROME_TOKENS.panelGap

/** Large panes meet the native window boundary without an HTML gutter. */
export const PANEL_EDGE_INSET = CHROME_TOKENS.panelEdgeInset

/** Minimum width for any content panel */
export const PANEL_MIN_WIDTH = CHROME_TOKENS.panelMinWidth

/** Grid minimums remain usable while overflowing small windows. */
export const PANEL_GRID_MIN_WIDTH = CHROME_TOKENS.panelGridMinWidth
export const PANEL_GRID_MIN_HEIGHT = CHROME_TOKENS.panelGridMinHeight

/**
 * Minimum width the single session/center column keeps before the shell
 * collapses the right inspector panel and then narrows the restored list and
 * navigator widths (see shell-width-clamp.ts / inspector-layout.ts).
 */
export const CENTER_MIN_WIDTH = CHROME_TOKENS.centerMinWidth

/** Extra vertical space reserved in panel stack for box-shadows. */
export const PANEL_STACK_VERTICAL_OVERFLOW = CHROME_TOKENS.panelStackVerticalOverflow

/** Space between the TopBar and the desktop panel stack. */
export const PANEL_STACK_TOP_INSET = CHROME_TOKENS.panelStackTopInset

/**
 * Space under the desktop panel stack. The outer shell already pads the
 * bottom by PANEL_EDGE_INSET, so the stack itself adds nothing.
 */
export const PANEL_STACK_BOTTOM_INSET = CHROME_TOKENS.panelStackBottomInset

/**
 * Shared resize sash geometry.
 *
 * Keep all seams (sidebar, navigator/content, panel/panel) aligned by deriving
 * offsets from these constants instead of hardcoded pixel literals.
 */
export const PANEL_SASH_HIT_WIDTH = CHROME_TOKENS.panelSashHitWidth
export const PANEL_SASH_HIT_WIDTH_COARSE = CHROME_TOKENS.panelSashHitWidthCoarse
export const PANEL_SASH_LINE_WIDTH = CHROME_TOKENS.panelSashLineWidth

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


/**
 * SE fluid panel measure (#2054 primitives wired under Rox Engineering).
 * PanelSlot applies `.rox-panel-gutter` / `.rox-panel-measure` only when the
 * active profile is super-engineering and the route is not an owner
 * full-bleed surface. Tokens still come from `@container/panel` tiers and
 * the SE ultra-wide bands (#2199).
 */

/** Minimal nav shape for SE measure gating. */
export type SePanelMeasureNav = {
  navigator: string
  surface?: string
} | null | undefined

/** Owner-managed full-bleed surfaces — Design must not force measure here. */
const SE_PANEL_MEASURE_BLEED_SURFACES = new Set([
  'messenger',
  // Calls (Rox Calls) live under the calendar surface (meetings alias).
  'calendar',
  // Canvas is an owned full-bleed board — measure would clip the stage.
  'canvas',
])

export function sePanelMeasureBleed(navState: SePanelMeasureNav): boolean {
  if (!navState) return false
  if (navState.navigator === 'home' || navState.navigator === 'tasks') return true
  if (navState.navigator === 'surface' && navState.surface && SE_PANEL_MEASURE_BLEED_SURFACES.has(navState.surface)) {
    return true
  }
  return false
}

/** True when PanelSlot should attach the #2054 gutter/measure primitives. */
export function sePanelMeasureActive(
  seProfile: boolean,
  navState: SePanelMeasureNav,
  opts?: { tool?: boolean },
): boolean {
  if (!seProfile || opts?.tool) return false
  return !sePanelMeasureBleed(navState)
}
