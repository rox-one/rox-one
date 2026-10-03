import { describe, expect, it } from 'bun:test'
import {
  clampPersistedLayoutSize,
  INSPECTOR_PANEL_WIDTH_MIN,
  INSPECTOR_PANEL_WIDTH_MAX,
  BOTTOM_DOCK_HEIGHT_MIN,
  BOTTOM_DOCK_HEIGHT_MAX,
} from './unified-shell'

describe('ROX UI-001 persisted shell geometry', () => {
  it('rounds and bounds preferences within the controls existing supported ranges', () => {
    expect(INSPECTOR_PANEL_WIDTH_MIN).toBe(280)
    expect(INSPECTOR_PANEL_WIDTH_MAX).toBe(1400)
    expect(BOTTOM_DOCK_HEIGHT_MIN).toBe(88)
    expect(BOTTOM_DOCK_HEIGHT_MAX).toBe(480)
    expect(clampPersistedLayoutSize(319.6, INSPECTOR_PANEL_WIDTH_MIN, INSPECTOR_PANEL_WIDTH_MAX, 320)).toBe(320)
    expect(clampPersistedLayoutSize(-1, INSPECTOR_PANEL_WIDTH_MIN, INSPECTOR_PANEL_WIDTH_MAX, 320)).toBe(280)
    expect(clampPersistedLayoutSize(1000, INSPECTOR_PANEL_WIDTH_MIN, INSPECTOR_PANEL_WIDTH_MAX, 320)).toBe(1000)
    expect(clampPersistedLayoutSize(10_000, INSPECTOR_PANEL_WIDTH_MIN, INSPECTOR_PANEL_WIDTH_MAX, 320)).toBe(1400)
    expect(clampPersistedLayoutSize(1, BOTTOM_DOCK_HEIGHT_MIN, BOTTOM_DOCK_HEIGHT_MAX, 104)).toBe(88)
    expect(clampPersistedLayoutSize(10_000, BOTTOM_DOCK_HEIGHT_MIN, BOTTOM_DOCK_HEIGHT_MAX, 104)).toBe(480)
  })

  it('recovers malformed and non-finite reload values to a usable default', () => {
    for (const value of [undefined, null, '480', {}, [], true, Number.NaN, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY]) {
      expect(clampPersistedLayoutSize(value, 88, 480, 104)).toBe(104)
    }
  })
})
