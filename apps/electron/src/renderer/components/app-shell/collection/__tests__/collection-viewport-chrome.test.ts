import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  VIEWPORT_NARROW_MAX,
  VIEWPORT_COMPACT_MAX,
  VIEWPORT_THREE_PANE,
  VIEWPORT_WIDE_MIN,
  isSinglePane,
  viewportBand,
} from '../../../../platform/viewport-band'

const table = readFileSync(
  join(import.meta.dir, '../../session-table/SessionTableHost.tsx'),
  'utf8',
)
const heatmap = readFileSync(
  join(import.meta.dir, '../../session-heatmap/SessionHeatmapHost.tsx'),
  'utf8',
)

describe('collection viewport chrome matrix', () => {
  it('maps 375 / 767 / 768 / 1280 / 1800 onto compact vs full collection chrome', () => {
    expect(isSinglePane(viewportBand(VIEWPORT_NARROW_MAX))).toBe(true)
    expect(isSinglePane(viewportBand(VIEWPORT_COMPACT_MAX - 1))).toBe(true)
    expect(isSinglePane(viewportBand(VIEWPORT_COMPACT_MAX))).toBe(false)
    expect(isSinglePane(viewportBand(VIEWPORT_THREE_PANE))).toBe(false)
    expect(isSinglePane(viewportBand(VIEWPORT_WIDE_MIN))).toBe(false)
  })

  it('table follows AppShell isCompactMode instead of always mounting CollectionOpsBar', () => {
    expect(table).toContain('CollectionViewChrome')
    expect(table).toContain('compact={!!isCompactMode}')
    expect(table).toContain('viewMode="table"')
    expect(table).not.toContain('<CollectionOpsBar')
    expect(table).not.toContain('CollectionViewCycleButton')
  })

  it('heatmap follows AppShell isCompactMode instead of always mounting CollectionOpsBar', () => {
    expect(heatmap).toContain('CollectionViewChrome')
    expect(heatmap).toContain('compact={!!isCompactMode}')
    expect(heatmap).toContain('viewMode="heatmap"')
    expect(heatmap).not.toContain('<CollectionOpsBar')
    expect(heatmap).not.toContain('CollectionViewCycleButton')
  })
})
