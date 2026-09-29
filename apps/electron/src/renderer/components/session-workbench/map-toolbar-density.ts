/**
 * Responsive density for the session map toolbar row.
 *
 * The row is measured (ResizeObserver on the toolbar element) and degrades in
 * steps instead of overflowing: Run (Запуск) and the ⋯ menu are always
 * visible; lower-priority controls move into the ⋯ menu or are hidden.
 *
 *  - full:    status chips, camera switch, Fit, Reset layout, Run, ⋯
 *  - compact: Fit + Reset layout move into ⋯; selected/draft kind chips hide
 *  - tight:   camera switch moves into ⋯ too; the Live chip hides
 *  - micro:   the scene count hides; only Run + ⋯ remain
 *
 * Thresholds are the toolbar's own width in CSS px (RU labels are the widest
 * bundled strings), with headroom so labels never clip mid-word.
 */
export type MapToolbarDensity = 'full' | 'compact' | 'tight' | 'micro'

export const MAP_TOOLBAR_BREAKPOINTS = {
  /** Below this, Fit / Reset layout go into the ⋯ menu. */
  compact: 720,
  /** Below this, the camera switch goes into the ⋯ menu. */
  tight: 460,
  /** Below this, the scene count hides too. */
  micro: 280,
} as const

export function mapToolbarDensity(width: number | null | undefined): MapToolbarDensity {
  // Unmeasured (first paint / no ResizeObserver): assume full, the row still
  // scrolls horizontally as a last resort.
  if (width == null || !Number.isFinite(width) || width <= 0) return 'full'
  if (width < MAP_TOOLBAR_BREAKPOINTS.micro) return 'micro'
  if (width < MAP_TOOLBAR_BREAKPOINTS.tight) return 'tight'
  if (width < MAP_TOOLBAR_BREAKPOINTS.compact) return 'compact'
  return 'full'
}

export interface MapToolbarLayout {
  /** Fit / Reset layout render inline (otherwise they live in the ⋯ menu). */
  inlineLayoutActions: boolean
  /** Camera switch renders inline (otherwise it lives in the ⋯ menu). */
  inlineCamera: boolean
  showKindChips: boolean
  showLiveChip: boolean
  showSceneCount: boolean
}

export function mapToolbarLayout(density: MapToolbarDensity): MapToolbarLayout {
  return {
    inlineLayoutActions: density === 'full',
    inlineCamera: density === 'full' || density === 'compact',
    showKindChips: density === 'full',
    showLiveChip: density === 'full' || density === 'compact',
    showSceneCount: density !== 'micro',
  }
}
