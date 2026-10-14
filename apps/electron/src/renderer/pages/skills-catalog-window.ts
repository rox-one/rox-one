/**
 * Pixel window for the skills catalog table (S6-01, ADR-0023 §7).
 * The page holds at most one query window (≤500 rows); this keeps the DOM
 * to the visible slice of that window instead of mounting every <tr>.
 */

export const SKILLS_CATALOG_ROW_HEIGHT = 56
export const SKILLS_CATALOG_OVERSCAN_PX = 480

export interface SkillsCatalogRowWindow {
  start: number
  end: number
  padTop: number
  padBottom: number
  totalHeight: number
}

export function skillsCatalogRowWindow(
  rowCount: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight = SKILLS_CATALOG_ROW_HEIGHT,
  overscanPx = SKILLS_CATALOG_OVERSCAN_PX,
): SkillsCatalogRowWindow {
  const count = Math.max(0, Math.floor(rowCount))
  const height = Math.max(1, rowHeight)
  const totalHeight = count * height
  if (count === 0) return { start: 0, end: 0, padTop: 0, padBottom: 0, totalHeight: 0 }
  const top = Math.max(0, scrollTop)
  const view = Math.max(0, viewportHeight)
  const start = Math.min(count, Math.max(0, Math.floor((top - overscanPx) / height)))
  const end = Math.min(
    count,
    Math.max(start, Math.ceil((top + view + overscanPx) / height)),
  )
  return {
    start,
    end,
    padTop: start * height,
    padBottom: Math.max(0, totalHeight - end * height),
    totalHeight,
  }
}
