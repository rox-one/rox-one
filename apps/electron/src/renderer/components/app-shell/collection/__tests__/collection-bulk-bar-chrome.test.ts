import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const BULK_BAR = readFileSync(join(__dirname, '..', 'CollectionBulkBar.tsx'), 'utf8')
const BULK_MENU = readFileSync(join(__dirname, '..', 'CollectionBulkMenu.tsx'), 'utf8')
const HEATMAP = readFileSync(
  join(__dirname, '..', '..', 'session-heatmap', 'SessionHeatmapHost.tsx'),
  'utf8',
)

describe('collection bulk chrome', () => {
  it('replaces native selects with CollectionBulkMenu', () => {
    expect(BULK_BAR).not.toContain('<select')
    expect(BULK_BAR).toContain('<CollectionBulkMenu')
    expect(BULK_BAR).toContain("label={t('collection.bulk.setStatus')}")
    expect(BULK_BAR).toContain("label={t('collection.bulk.setPriority')}")
    expect(BULK_BAR).toContain("label={t('collection.bulk.setProject')}")
    expect(BULK_BAR).toContain("label={t('collection.bulk.addLabel')}")
    expect(BULK_BAR).toContain("label={t('collection.bulk.removeLabel')}")
  })

  it('uses compact PremiumMenu in CollectionBulkMenu', () => {
    expect(BULK_MENU).toContain('variant="compact"')
    expect(BULK_MENU).toContain('PremiumMenu')
  })
})

describe('heatmap collection chrome', () => {
  it('wires day-table selection, family column, bulk bar, and Home/End', () => {
    expect(HEATMAP).toContain('<CollectionBulkBar')
    expect(HEATMAP).toContain('classifyAgentFamily')
    expect(HEATMAP).toContain('heatmapHomeKey')
    expect(HEATMAP).toContain('heatmapEndKey')
    expect(HEATMAP).toContain("event.key === 'Home'")
    expect(HEATMAP).toContain("event.key === 'End'")
    expect(HEATMAP).toContain('type="checkbox"')
    expect(HEATMAP).toContain('selectRange')
  })
})
