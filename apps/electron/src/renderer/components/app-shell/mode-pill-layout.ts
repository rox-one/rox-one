/**
 * Titlebar mode-pill geometry. The pill is centered in the WINDOW; this
 * decides labels vs icon-only and how far the left group may extend.
 * Pure so it can be unit-tested without mounting the titlebar.
 */
export interface ModePillMetrics {
  full: number
  compact: number
  /**
   * Icon-only advance (width + gap) of each pill in order, measured in the
   * compact ghost. Lets the titlebar fold trailing pills into «…» when even
   * the icon-only pill does not fit (top50 #3). Optional for older callers.
   */
  advances?: readonly number[]
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
  /**
   * `center` (legacy): centered in the window. `right`: docked just left of the
   * right control group, next to the panel-layout button (Mark, t78).
   */
  align?: 'center' | 'right'
}

/**
 * Decide whether the centered mode pill shows labels or icons only, and how
 * wide the left group may grow without sliding under the pill.
 */
export interface ModePillLayout {
  collapsed: boolean
  /** How many pills stay in the bar; the rest fold into the «…» menu. */
  visibleCount: number
  leftMax: number
  /** Limit the browser strip before it covers the pill or fixed right actions. */
  rightMax: number
}

export function resolveModePillLayout(input: ModePillLayoutInput): ModePillLayout {
  if (input.align === 'right') {
    const room = (pillWidth: number) => input.topbarWidth - input.rightWidth - pillWidth - MODE_PILL_GAP * 2
    const collapsed = room(input.metrics.full) < input.leftFixedEdge + MODE_PILL_MIN_LEFT_FLEX
    const pillWidth = collapsed ? input.metrics.compact : input.metrics.full
    return {
      collapsed,
      leftMax: Math.max(0, Math.floor(room(pillWidth) + MODE_PILL_GAP)),
      // The right group keeps its natural width; the pill docks to its left.
      rightMax: Math.max(0, Math.floor(input.topbarWidth)),
    }
  }
  const centerX = input.topbarWidth / 2 - input.leftInset / 2
  const fits = (pillWidth: number) =>
    centerX - pillWidth / 2 - MODE_PILL_GAP >= input.leftFixedEdge + MODE_PILL_MIN_LEFT_FLEX
    && input.topbarWidth - centerX - pillWidth / 2 - MODE_PILL_GAP >= input.rightWidth
  const collapsed = !fits(input.metrics.full)
  const advances = input.metrics.advances ?? []
  let visibleCount = advances.length > 0 ? advances.length : Number.MAX_SAFE_INTEGER
  let pillWidth = collapsed ? input.metrics.compact : input.metrics.full
  if (collapsed && advances.length > 0 && !fits(pillWidth)) {
    // Fold trailing pills one by one (labels → icons → «…» menu order).
    let width = input.metrics.compact
    while (visibleCount > 0 && !fits(width)) {
      visibleCount -= 1
      width -= advances[visibleCount] ?? 0
    }
    pillWidth = width
  }
  return {
    collapsed,
    visibleCount,
    leftMax: Math.max(0, Math.floor(centerX - pillWidth / 2 - MODE_PILL_GAP)),
    rightMax: Math.max(0, Math.floor(input.topbarWidth - centerX - pillWidth / 2 - MODE_PILL_GAP)),
  }
}

/** WP6: the TopBar renders the mode pill on every non-compact window (shared with the sidebar fallback). */
/**
 * Pills shown in the bar: the first `visibleCount`, but the active pill is
 * never folded away — it takes the last visible slot instead. Returns the
 * shown surfaces and the folded ones (in their original order).
 */
export function foldPills<T extends { id: string }>(surfaces: readonly T[], visibleCount: number, activeId: string | null): { shown: T[]; folded: T[] } {
  const count = Math.max(0, Math.min(surfaces.length, visibleCount))
  if (count >= surfaces.length) return { shown: [...surfaces], folded: [] }
  const shownIds = new Set(surfaces.slice(0, count).map((s) => s.id))
  if (count > 0 && activeId && !shownIds.has(activeId) && surfaces.some((s) => s.id === activeId)) {
    shownIds.delete(surfaces[count - 1]!.id)
    shownIds.add(activeId)
  }
  return {
    shown: surfaces.filter((s) => shownIds.has(s.id)),
    folded: surfaces.filter((s) => !shownIds.has(s.id)),
  }
}

/** Narrow window (top50 #3): the second sidebar floats over the content. */
export const NARROW_SHELL_THRESHOLD = 900

export function modePillShown(isCompact: boolean | undefined): boolean {
  return !isCompact
}
