import { describe, expect, it } from 'bun:test'
import { adoptUserNodes, getNodesInside, type NodeBase, type NodeLookup } from '@xyflow/system'
import { initialRuntimeCardGeometry } from '../layout/initial-geometry'

function visible(nodes: NodeBase[], viewport = { x: 0, y: 0, width: 836, height: 650 }) {
  const lookup: NodeLookup = new Map()
  adoptUserNodes(nodes, lookup, new Map())
  return getNodesInside(lookup, viewport, [0, 0, 1], true)
}

describe('initial production React Flow visibility', () => {
  it('culls offscreen cards before any DOM measurement instead of mounting the whole200-card window', () => {
    const nodes: NodeBase[] = Array.from({ length: 200 }, (_, index) => ({ id: String(index), data: {}, position: { x: index * 302, y: 44 } }))
    expect(visible(nodes)).toHaveLength(200)
    expect(visible(nodes.map(node => ({ ...node, ...initialRuntimeCardGeometry(false) })))).toHaveLength(3)
    // Width/height alone do not remove React Flow's forced first render.
    expect(visible(nodes.map(node => ({ ...node, initialWidth: 268, initialHeight: 128 })))).toHaveLength(200)
  })
  it('uses actual measured DOM bounds in preference to the initial geometry hint', () => {
    const node: NodeBase = { id: 'measured', data: {}, position: { x: 0, y: 0 }, ...initialRuntimeCardGeometry(false) }
    const viewport = { x: 0, y: 300, width: 836, height: 20 }
    expect(visible([node], viewport)).toHaveLength(0)
    expect(visible([{ ...node, measured: { width: 268, height: 400 } }], viewport)).toHaveLength(1)
  })
})
