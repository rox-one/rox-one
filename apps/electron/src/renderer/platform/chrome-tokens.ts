/**
 * GENERATED FILE — do not edit by hand.
 * Source: packages/ui/src/styles/tokens/chrome.css
 * Regenerate: bun run scripts/generate-chrome-tokens.ts
 *
 * Shell geometry in px. CSS reads the same numbers as custom properties.
 */

export type ChromeTokenName =
  | 'controlHitMin'
  | 'controlHeight'
  | 'controlSm'
  | 'controlMd'
  | 'controlLg'
  | 'railButton'
  | 'rowH'
  | 'rowH2line'
  | 'laneGutterWidth'
  | 'laneRuleWidth'
  | 'laneRuleActiveHeight'
  | 'laneRuleQuietHeight'
  | 'lensDockMinWidth'
  | 'chromeTopbarHeight'
  | 'chromeRailWidth'
  | 'chromeRailExpandedWidth'
  | 'chromeControl'
  | 'chromeControlLg'
  | 'chromeTabStripHeight'
  | 'chromeStatusHeight'
  | 'chromePanelHeaderHeight'
  | 'chromeGap'
  | 'chromeRhythm'
  | 'panelGap'
  | 'panelEdgeInset'
  | 'panelMinWidth'
  | 'panelGridMinWidth'
  | 'panelGridMinHeight'
  | 'centerMinWidth'
  | 'panelStackVerticalOverflow'
  | 'panelStackTopInset'
  | 'panelStackBottomInset'
  | 'panelSashHitWidth'
  | 'panelSashHitWidthCoarse'
  | 'panelSashLineWidth'

/** Compact density (the default). */
export const CHROME_TOKENS: Readonly<Record<ChromeTokenName, number>> = Object.freeze({
  /** --control-hit-min */
  controlHitMin: 28,
  /** --control-height */
  controlHeight: 32,
  /** --control-sm */
  controlSm: 24,
  /** --control-md */
  controlMd: 28,
  /** --control-lg */
  controlLg: 32,
  /** --rail-button */
  railButton: 36,
  /** --row-h */
  rowH: 28,
  /** --row-h-2line */
  rowH2line: 44,
  /** --lane-gutter-width */
  laneGutterWidth: 14,
  /** --lane-rule-width */
  laneRuleWidth: 2,
  /** --lane-rule-active-height */
  laneRuleActiveHeight: 18,
  /** --lane-rule-quiet-height */
  laneRuleQuietHeight: 8,
  /** --lens-dock-min-width */
  lensDockMinWidth: 1148,
  /** --chrome-topbar-height */
  chromeTopbarHeight: 40,
  /** --chrome-rail-width */
  chromeRailWidth: 48,
  /** --chrome-rail-expanded-width */
  chromeRailExpandedWidth: 188,
  /** --chrome-control */
  chromeControl: 24,
  /** --chrome-control-lg */
  chromeControlLg: 28,
  /** --chrome-tab-strip-height */
  chromeTabStripHeight: 32,
  /** --chrome-status-height */
  chromeStatusHeight: 24,
  /** --chrome-panel-header-height */
  chromePanelHeaderHeight: 32,
  /** --chrome-gap */
  chromeGap: 4,
  /** --chrome-rhythm */
  chromeRhythm: 4,
  /** --panel-gap */
  panelGap: 0,
  /** --panel-edge-inset */
  panelEdgeInset: 0,
  /** --panel-min-width */
  panelMinWidth: 440,
  /** --panel-grid-min-width */
  panelGridMinWidth: 320,
  /** --panel-grid-min-height */
  panelGridMinHeight: 240,
  /** --center-min-width */
  centerMinWidth: 420,
  /** --panel-stack-vertical-overflow */
  panelStackVerticalOverflow: 0,
  /** --panel-stack-top-inset */
  panelStackTopInset: 0,
  /** --panel-stack-bottom-inset */
  panelStackBottomInset: 0,
  /** --panel-sash-hit-width */
  panelSashHitWidth: 8,
  /** --panel-sash-hit-width-coarse */
  panelSashHitWidthCoarse: 24,
  /** --panel-sash-line-width */
  panelSashLineWidth: 1,
})

/** `html[data-density="comfortable"]` values (compact merged with overrides). */
export const CHROME_TOKENS_COMFORTABLE: Readonly<Record<ChromeTokenName, number>> = Object.freeze({
  /** --control-hit-min */
  controlHitMin: 28,
  /** --control-height */
  controlHeight: 32,
  /** --control-sm */
  controlSm: 28,
  /** --control-md */
  controlMd: 32,
  /** --control-lg */
  controlLg: 36,
  /** --rail-button */
  railButton: 40,
  /** --row-h */
  rowH: 32,
  /** --row-h-2line */
  rowH2line: 52,
  /** --lane-gutter-width */
  laneGutterWidth: 14,
  /** --lane-rule-width */
  laneRuleWidth: 2,
  /** --lane-rule-active-height */
  laneRuleActiveHeight: 18,
  /** --lane-rule-quiet-height */
  laneRuleQuietHeight: 8,
  /** --lens-dock-min-width */
  lensDockMinWidth: 1148,
  /** --chrome-topbar-height */
  chromeTopbarHeight: 44,
  /** --chrome-rail-width */
  chromeRailWidth: 52,
  /** --chrome-rail-expanded-width */
  chromeRailExpandedWidth: 188,
  /** --chrome-control */
  chromeControl: 28,
  /** --chrome-control-lg */
  chromeControlLg: 32,
  /** --chrome-tab-strip-height */
  chromeTabStripHeight: 36,
  /** --chrome-status-height */
  chromeStatusHeight: 24,
  /** --chrome-panel-header-height */
  chromePanelHeaderHeight: 36,
  /** --chrome-gap */
  chromeGap: 4,
  /** --chrome-rhythm */
  chromeRhythm: 4,
  /** --panel-gap */
  panelGap: 0,
  /** --panel-edge-inset */
  panelEdgeInset: 0,
  /** --panel-min-width */
  panelMinWidth: 440,
  /** --panel-grid-min-width */
  panelGridMinWidth: 320,
  /** --panel-grid-min-height */
  panelGridMinHeight: 240,
  /** --center-min-width */
  centerMinWidth: 420,
  /** --panel-stack-vertical-overflow */
  panelStackVerticalOverflow: 0,
  /** --panel-stack-top-inset */
  panelStackTopInset: 0,
  /** --panel-stack-bottom-inset */
  panelStackBottomInset: 0,
  /** --panel-sash-hit-width */
  panelSashHitWidth: 8,
  /** --panel-sash-hit-width-coarse */
  panelSashHitWidthCoarse: 24,
  /** --panel-sash-line-width */
  panelSashLineWidth: 1,
})
