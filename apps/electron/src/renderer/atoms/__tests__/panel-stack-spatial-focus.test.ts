import { describe, expect, it } from 'bun:test'
import { findPanelInDirection, type PanelSpatialBounds } from '../panel-stack'

const panel = (id: string, left: number, top: number, right: number, bottom: number): PanelSpatialBounds => ({
  id,
  left,
  top,
  right,
  bottom,
})

describe('panel spatial focus', () => {
  it('chooses the closest visible panel in the requested direction, not stack order', () => {
    const panels = [
      panel('active', 0, 0, 300, 400),
      panel('far-right', 760, 0, 1000, 400),
      panel('near-right', 310, 100, 600, 300),
      panel('left', -320, 0, -20, 400),
    ]

    expect(findPanelInDirection('active', panels, 'right')).toBe('near-right')
    expect(findPanelInDirection('active', panels, 'left')).toBe('left')
  })

  it('returns no target at a directional edge instead of wrapping to another panel', () => {
    const panels = [panel('first', 0, 0, 300, 400), panel('second', 320, 0, 620, 400)]

    expect(findPanelInDirection('second', panels, 'right')).toBeNull()
    expect(findPanelInDirection('first', panels, 'left')).toBeNull()
  })

  it('does not focus panels omitted from the visible geometry snapshot', () => {
    const visiblePanels = [panel('active', 0, 0, 300, 400)]

    expect(findPanelInDirection('active', visiblePanels, 'right')).toBeNull()
  })
})
