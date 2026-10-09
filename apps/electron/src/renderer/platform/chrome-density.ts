/**
 * Workbench chrome density tokens (ship-rox-design-compact).
 *
 * Values come from the generated `chrome-tokens.ts`, whose source is
 * packages/ui/src/styles/tokens/chrome.css (the same numbers CSS reads as
 * `--chrome-*` custom properties). Edit chrome.css and regenerate; never put a
 * literal here.
 */
import { CHROME_TOKENS } from './chrome-tokens'

export const CHROME_DENSITY = {
  /** Desktop TopBar height (px). Mobile overrides via CSS media query. */
  topbarHeight: CHROME_TOKENS.chromeTopbarHeight,
  /** Activity + inspector section rail width. */
  railWidth: CHROME_TOKENS.chromeRailWidth,
  /** Expanded activity rail (icon + label rows). */
  railExpandedWidth: CHROME_TOKENS.chromeRailExpandedWidth,
  /** Primary icon control hit target in TopBar / rails. */
  control: CHROME_TOKENS.chromeControl,
  /** Slightly larger control used for TopBar utility actions. */
  controlLg: CHROME_TOKENS.chromeControlLg,
  /** SurfaceTabs strip height. */
  tabStripHeight: CHROME_TOKENS.chromeTabStripHeight,
  /** Status bar height. */
  statusBarHeight: CHROME_TOKENS.chromeStatusHeight,
  /** Inspector / terminal dock panel header height. */
  panelHeaderHeight: CHROME_TOKENS.chromePanelHeaderHeight,
  /** Gap between shell panels (same token as PANEL_GAP). */
  panelGap: CHROME_TOKENS.panelGap,
  /** Outer inset from window edges to panels (same token as PANEL_EDGE_INSET). */
  panelEdgeInset: CHROME_TOKENS.panelEdgeInset,
} as const

export type ChromeDensity = typeof CHROME_DENSITY
