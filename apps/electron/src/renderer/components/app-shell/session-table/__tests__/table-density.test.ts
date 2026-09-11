import { describe, expect, it } from 'bun:test'
import type { CollectionDensity } from '@craft-agent/shared/sessions/collection'
import { collectionTableRowClass, collectionTableRowHeight } from '../table-density'

describe('collectionTableRowHeight', () => {
  const cases: Array<[CollectionDensity | undefined, number]> = [
    [undefined, 36],
    ['compact', 36],
    ['comfortable', 48],
  ]
  for (const [density, height] of cases) {
    it(`maps ${String(density)} to ${height}px`, () => {
      expect(collectionTableRowHeight(density)).toBe(height)
    })
  }
})

describe('collectionTableRowClass', () => {
  it('uses tighter padding in compact', () => {
    expect(collectionTableRowClass('compact')).toContain('min-h-8')
    expect(collectionTableRowClass('comfortable')).toContain('min-h-12')
  })
})
