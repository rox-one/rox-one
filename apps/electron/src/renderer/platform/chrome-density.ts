/**
 * Workbench chrome density tokens (ship-rox-design-compact).
 *
 * Prefer these constants (and matching CSS vars in packages/ui + index.css)
 * for TopBar / rails / tabs / status / inspector chrome heights and gaps.
 * Keep values cohesive; avoid one-off magic numbers in chrome hosts.
 */
export const CHROME_DENSITY = {
  /** Desktop TopBar height (px). Mobile overrides via CSS media query. */
  topbarHeight: 40,
  /** Activity + inspector section rail width. */
  railWidth: 44,
  /** Primary icon control hit target in TopBar / rails. */
  control: 24,
  /** Slightly larger control used for TopBar utility actions. */
  controlLg: 26,
  /** SurfaceTabs strip height. */
  tabStripHeight: 34,
  /** Status bar height. */
  statusBarHeight: 24,
  /** Inspector / terminal dock panel header height. */
  panelHeaderHeight: 32,
  /** Gap between shell panels. */
  panelGap: 4,
  /** Outer inset from window edges to panels. */
  panelEdgeInset: 4,
} as const

export type ChromeDensity = typeof CHROME_DENSITY
