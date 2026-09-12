import { describe, expect, it } from 'bun:test'
import { COMPACT_VIEWPORT_WIDTH, shouldShowWorkspaceIconRail } from '../../components/app-shell/workspace-rail'
import {
  VIEWPORT_NARROW_MAX,
  VIEWPORT_THREE_PANE,
  VIEWPORT_WIDE_MIN,
  isRailCollapsed,
  isSinglePane,
  viewportBand,
  viewportGutter,
} from '../viewport-band'

describe('viewport matrix (375 / 768 / 1280 / 1800)', () => {
  const matrix = [
    { width: VIEWPORT_NARROW_MAX, band: 'narrow' as const, rail: false, single: true, gutter: 8 },
    { width: COMPACT_VIEWPORT_WIDTH - 1, band: 'compact' as const, rail: false, single: true, gutter: 8 },
    { width: COMPACT_VIEWPORT_WIDTH, band: 'three-pane' as const, rail: true, single: false, gutter: 8 },
    { width: VIEWPORT_THREE_PANE, band: 'three-pane' as const, rail: true, single: false, gutter: 8 },
    { width: VIEWPORT_WIDE_MIN, band: 'wide' as const, rail: true, single: false, gutter: 12 },
  ]

  for (const row of matrix) {
    it(`${row.width}px → ${row.band}`, () => {
      const band = viewportBand(row.width)
      expect(band).toBe(row.band)
      expect(isRailCollapsed(band)).toBe(!row.rail)
      expect(isSinglePane(band)).toBe(row.single)
      expect(viewportGutter(band)).toBe(row.gutter)
      expect(shouldShowWorkspaceIconRail(true, row.width)).toBe(row.rail)
    })
  }
})
