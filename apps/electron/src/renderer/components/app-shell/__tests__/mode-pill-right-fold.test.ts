import { describe, expect, it } from 'bun:test'
import { resolveModePillLayout } from '../mode-pill-layout'

describe('right-docked mode pill', () => {
  const metrics = { full: 600, compact: 300, advances: [60, 60, 60, 60, 60] }
  it('keeps every pill when there is room', () => {
    const layout = resolveModePillLayout({ topbarWidth: 1600, leftInset: 0, leftFixedEdge: 100, rightWidth: 200, metrics, align: 'right' })
    expect(layout.collapsed).toBe(false)
    expect(layout.visibleCount).toBe(5)
  })
  it('folds trailing pills into «…» when even icons do not fit', () => {
    const layout = resolveModePillLayout({ topbarWidth: 560, leftInset: 0, leftFixedEdge: 100, rightWidth: 150, metrics, align: 'right' })
    expect(layout.collapsed).toBe(true)
    expect(layout.visibleCount).toBeLessThan(5)
    expect(layout.leftMax).toBeGreaterThanOrEqual(100 + 96 - 12)
  })
})
