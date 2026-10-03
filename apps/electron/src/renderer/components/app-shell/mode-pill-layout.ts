/**
 * Titlebar mode-pill geometry. The pill is centered in the WINDOW; this
 * decides labels vs icon-only and how far the left group may extend.
 * Pure so it can be unit-tested without mounting the titlebar.
 */
export interface ModePillMetrics {
  full: number
  compact: number
}

/** Breathing room between the centered mode pill and the side groups. */
const MODE_PILL_GAP = 12
/** Minimum room kept left of the pill for the open-session tab chip. */
const MODE_PILL_MIN_LEFT_FLEX = 96

export interface ModePillLayoutInput {
  /** Width of the titlebar element (window width minus the rail inset). */
  topbarWidth: number
  /** Left rail inset; the pill is centered in the window, not the titlebar. */
  leftInset: number
  /** Right edge (titlebar-relative) of the fixed left controls. */
  leftFixedEdge: number
  /** Natural width of the right control group. */
  rightWidth: number
  metrics: ModePillMetrics
}

/**
 * Decide whether the centered mode pill shows labels or icons only, and how
 * wide the left group may grow without sliding under the pill.
 */
export interface ModePillLayout {
  collapsed: boolean
  leftMax: number
  /** Limit the browser strip before it covers the pill or fixed right actions. */
  rightMax: number
}

export function resolveModePillLayout(input: ModePillLayoutInput): ModePillLayout {
  const centerX = input.topbarWidth / 2 - input.leftInset / 2
  const fits = (pillWidth: number) =>
    centerX - pillWidth / 2 - MODE_PILL_GAP >= input.leftFixedEdge + MODE_PILL_MIN_LEFT_FLEX
    && input.topbarWidth - centerX - pillWidth / 2 - MODE_PILL_GAP >= input.rightWidth
  const collapsed = !fits(input.metrics.full)
  const pillWidth = collapsed ? input.metrics.compact : input.metrics.full
  return {
    collapsed,
    leftMax: Math.max(0, Math.floor(centerX - pillWidth / 2 - MODE_PILL_GAP)),
    rightMax: Math.max(0, Math.floor(input.topbarWidth - centerX - pillWidth / 2 - MODE_PILL_GAP)),
  }
}
