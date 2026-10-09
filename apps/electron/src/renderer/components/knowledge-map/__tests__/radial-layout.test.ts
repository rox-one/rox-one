import { describe, expect, it } from 'bun:test'
import type { KnowledgeMapEdge, KnowledgeMapNode } from '@rox/shared/knowledge/knowledge-map-types'
import { radialLayout } from '../radial-layout'

function node(partial: Partial<KnowledgeMapNode> & Pick<KnowledgeMapNode, 'id' | 'label' | 'area' | 'kind'>): KnowledgeMapNode {
  return { size: 10, linkCount: 0, relPath: null, ...partial }
}

function edge(source: string, target: string, kind: KnowledgeMapEdge['kind'] = 'member'): KnowledgeMapEdge {
  return { source, target, kind }
}

const root = node({ id: 'root', label: 'Профиль', area: 'root', kind: 'root' })
const contextArea = node({ id: 'area:context', label: 'context', area: 'context', kind: 'area' })
const memoryArea = node({ id: 'area:memory', label: 'memory', area: 'memory', kind: 'area' })
const c1 = node({ id: 'context:c1.md', label: 'C1', area: 'context', kind: 'doc', relPath: 'c1.md' })
const c2 = node({ id: 'context:c2.md', label: 'C2', area: 'context', kind: 'doc', relPath: 'c2.md' })
const m1 = node({ id: 'memory:m1.md', label: 'M1', area: 'memory', kind: 'doc', relPath: 'm1.md' })

const sampleNodes = [root, contextArea, memoryArea, c1, c2, m1]
const sampleEdges = [
  edge('root', 'area:context'),
  edge('root', 'area:memory'),
  edge('area:context', 'context:c1.md'),
  edge('area:context', 'context:c2.md'),
  edge('context:c1.md', 'context:c2.md', 'link'),
  edge('area:memory', 'memory:m1.md'),
]

describe('radialLayout', () => {
  it('assigns BFS levels from the root', () => {
    const layout = radialLayout({ nodes: sampleNodes, edges: sampleEdges })
    expect(layout.rootId).toBe('root')
    expect(layout.byId.get('root')?.level).toBe(0)
    expect(layout.byId.get('area:context')?.level).toBe(1)
    expect(layout.byId.get('area:memory')?.level).toBe(1)
    expect(layout.byId.get('context:c1.md')?.level).toBe(2)
    expect(layout.byId.get('memory:m1.md')?.level).toBe(2)
    expect(layout.maxLevel).toBe(2)
  })

  it('sectors tile the parent sector and the root covers 2π', () => {
    const layout = radialLayout({ nodes: sampleNodes, edges: sampleEdges })
    const rootPos = layout.byId.get('root')!
    expect(rootPos.angleEnd - rootPos.angleStart).toBeCloseTo(Math.PI * 2, 10)

    for (const parent of layout.positions) {
      const children = layout.positions
        .filter((pos) => pos.parentId === parent.id)
        .sort((a, b) => a.angleStart - b.angleStart)
      if (children.length === 0) continue
      const covered = children.reduce((sum, child) => sum + (child.angleEnd - child.angleStart), 0)
      expect(covered).toBeCloseTo(parent.angleEnd - parent.angleStart, 10)
      // Contiguous: each child starts where the previous one ended.
      for (let i = 1; i < children.length; i += 1) {
        expect(children[i].angleStart).toBeCloseTo(children[i - 1].angleEnd, 10)
      }
    }
  })

  it('widens a parent sector proportionally to its subtree leaf count', () => {
    const layout = radialLayout({ nodes: sampleNodes, edges: sampleEdges })
    const contextSpan = layout.byId.get('area:context')!
    const memorySpan = layout.byId.get('area:memory')!
    const contextWidth = contextSpan.angleEnd - contextSpan.angleStart
    const memoryWidth = memorySpan.angleEnd - memorySpan.angleStart
    expect(contextWidth).toBeCloseTo(Math.PI * 2 * (2 / 3), 10)
    expect(memoryWidth).toBeCloseTo(Math.PI * 2 * (1 / 3), 10)
  })

  it('parks orphans on the outer ring', () => {
    const orphan = node({ id: 'notes:lonely.md', label: 'Lonely', area: 'notes', kind: 'doc', relPath: 'lonely.md' })
    const layout = radialLayout({ nodes: [...sampleNodes, orphan], edges: sampleEdges })
    const orphanPos = layout.byId.get('notes:lonely.md')!
    expect(orphanPos.onOuterRing).toBe(true)
    expect(orphanPos.level).toBe(3)
    expect(orphanPos.parentId).toBeNull()
    expect(layout.maxLevel).toBe(3)
    expect(layout.byId.get('root')?.onOuterRing).toBe(false)
  })

  it('handles a single-node graph', () => {
    const layout = radialLayout({ nodes: [root], edges: [] })
    expect(layout.positions).toHaveLength(1)
    expect(layout.radius).toBe(0)
    expect(layout.maxLevel).toBe(0)
    expect(layout.byId.get('root')?.level).toBe(0)
    expect(layout.layers).toEqual([{ level: 0, radius: 0, count: 1 }])
  })

  it('handles an empty graph', () => {
    const layout = radialLayout({ nodes: [], edges: [] })
    expect(layout.positions).toEqual([])
    expect(layout.layers).toEqual([])
    expect(layout.rootId).toBeNull()
    expect(layout.radius).toBe(0)
  })

  it('is deterministic across runs', () => {
    const first = radialLayout({ nodes: sampleNodes, edges: sampleEdges })
    const second = radialLayout({ nodes: sampleNodes, edges: sampleEdges })
    expect(second.positions).toEqual(first.positions)
    expect(second.layers).toEqual(first.layers)
    expect(second.rootId).toBe(first.rootId)
  })
})