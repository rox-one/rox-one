/**
 * Pure geometry for the mini glass companion. Kept free of `electron` imports
 * so it can be unit-tested without mocking the electron module.
 */

export interface MiniGlassPosition { x: number; y: number }
export interface MiniGlassRect { x: number; y: number; width: number; height: number }

/** Collapsed: grip + two 40 px circles + padding for the soft shadow. */
export const MINI_GLASS_COLLAPSED = { width: 124, height: 60 } as const
/** Expanded: a compact pill input (with mic + send inside). */
export const MINI_GLASS_EXPANDED = { width: 400, height: 60 } as const
const SCREEN_MARGIN = 24

/** Keep a remembered position on a visible display; otherwise bottom-right of the primary work area. */
export function resolveMiniGlassOrigin(
  remembered: MiniGlassPosition | null,
  size: { width: number; height: number },
  workAreas: MiniGlassRect[],
  primary: MiniGlassRect,
): MiniGlassPosition {
  if (remembered && Number.isFinite(remembered.x) && Number.isFinite(remembered.y)) {
    const fits = workAreas.some(area =>
      remembered.x >= area.x && remembered.y >= area.y
      && remembered.x + size.width <= area.x + area.width
      && remembered.y + size.height <= area.y + area.height)
    if (fits) return { x: Math.round(remembered.x), y: Math.round(remembered.y) }
  }
  return {
    x: Math.round(primary.x + primary.width - size.width - SCREEN_MARGIN),
    y: Math.round(primary.y + primary.height - size.height - SCREEN_MARGIN),
  }
}
