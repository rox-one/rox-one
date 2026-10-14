import { describe, expect, it } from 'bun:test'
import {
  SKILLS_CATALOG_OVERSCAN_PX,
  SKILLS_CATALOG_ROW_HEIGHT,
  skillsCatalogRowWindow,
} from '../skills-catalog-window'

describe('skillsCatalogRowWindow', () => {
  it('returns an empty window for an empty catalog', () => {
    expect(skillsCatalogRowWindow(0, 0, 600)).toEqual({
      start: 0,
      end: 0,
      padTop: 0,
      padBottom: 0,
      totalHeight: 0,
    })
  })

  it('does not mount 3 395 rows for a typical viewport', () => {
    const window = skillsCatalogRowWindow(3_395, 0, 600)
    const mounted = window.end - window.start
    expect(mounted).toBeLessThan(40)
    expect(window.padTop).toBe(0)
    expect(window.padBottom).toBe((3_395 - window.end) * SKILLS_CATALOG_ROW_HEIGHT)
    expect(window.totalHeight).toBe(3_395 * SKILLS_CATALOG_ROW_HEIGHT)
  })

  it('shifts the window when scrolled, keeping overscan', () => {
    const scrollTop = 20 * SKILLS_CATALOG_ROW_HEIGHT
    const window = skillsCatalogRowWindow(500, scrollTop, 400)
    expect(window.start).toBe(
      Math.max(0, Math.floor((scrollTop - SKILLS_CATALOG_OVERSCAN_PX) / SKILLS_CATALOG_ROW_HEIGHT)),
    )
    expect(window.end).toBeGreaterThan(window.start)
    expect(window.end - window.start).toBeLessThan(40)
  })
})
