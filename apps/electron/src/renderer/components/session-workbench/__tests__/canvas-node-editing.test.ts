import { describe, expect, test } from 'bun:test'
import type { Node } from '@xyflow/react'
import { convertDraftGraphNode, reconcileCanvasNodes } from '../canvas-node-editing'
import { createSessionDraftEdge, createSessionDraftNode, parseSessionDraftGraph, serializeSessionDraftGraph, type SessionDraftGraph } from '../draft-nodes'
import { classifyMapConnection } from '../map-connection-rules'
import { draftGraphToSpec } from '../workflow-document'

const node = (id: string, kind: 'tool' | 'condition' | 'output' | 'note' = 'tool') => createSessionDraftNode({ id, kind, position: { x: 0, y: 0 } })
const graph = (edges: SessionDraftGraph['edges']): SessionDraftGraph => ({ v: 1, sessionId: 'canvas-editing', nodes: [node('source'), node('target', 'output')], edges })

describe('port changes during node conversion', () => {
  test('existing steps bind to the visible true branch after converting to a condition', () => {
    const converted = convertDraftGraphNode(graph([createSessionDraftEdge({ source: 'source', target: 'target' })]), 'source', 'condition')
    expect(converted.edges[0]?.sourceHandle).toBe('source:true')
    expect(draftGraphToSpec(converted).edges[0]?.sourcePort).toBe('source:true')
    expect(classifyMapConnection({ source: 'source', target: 'target' }, { draftNodes: converted.nodes, draftEdges: converted.edges, sceneIds: new Set() })).toEqual({ ok: false, reason: 'duplicate' })
  })

  test('old saved condition edges restore default and named false handles', () => {
    const initial = graph([
      createSessionDraftEdge({ source: 'source', target: 'target' }),
      { ...createSessionDraftEdge({ source: 'source', target: 'target' }), id: 'false-edge', sourcePort: 'false' },
    ])
    initial.nodes[0]!.kind = 'condition'
    const restored = parseSessionDraftGraph(serializeSessionDraftGraph(initial.sessionId, initial), initial.sessionId)
    expect(restored.edges.map((edge) => edge.sourceHandle)).toEqual(['source:true', 'source:false'])
  })

  test('keyboard links use a real branch and reject foreign handles', () => {
    const ctx = { draftNodes: [node('condition', 'condition'), node('target')], draftEdges: [], sceneIds: new Set<string>() }
    expect(classifyMapConnection({ source: 'condition', target: 'target' }, ctx)).toMatchObject({ ok: true, sourceHandle: 'condition:true' })
    expect(classifyMapConnection({ source: 'condition', target: 'target', sourceHandle: 'other:false' }, ctx)).toEqual({ ok: false, reason: 'unknown' })
  })

  test('converting both branches to a tool coalesces duplicate steps and clears old ports', () => {
    const initial = graph([
      { ...createSessionDraftEdge({ source: 'source', target: 'target', sourceHandle: 'source:true' }), sourcePort: 'source:true' },
      createSessionDraftEdge({ source: 'source', target: 'target', sourceHandle: 'source:false' }),
    ])
    initial.nodes[0]!.kind = 'condition'
    const converted = convertDraftGraphNode(initial, 'source', 'tool')
    expect(converted.edges).toHaveLength(1)
    expect(converted.edges[0]?.sourceHandle).toBeUndefined()
    expect(converted.edges[0]?.sourcePort).toBeUndefined()
  })

  test('frame conversion removes incident execution/context links and respects minimum size', () => {
    const initial = graph([createSessionDraftEdge({ source: 'source', target: 'target' }), createSessionDraftEdge({ source: 'scene', target: 'source', kind: 'context' })])
    initial.nodes[0]!.size = { width: 160, height: 96 }
    const converted = convertDraftGraphNode(initial, 'source', 'annotation_frame')
    expect(converted.edges).toHaveLength(0)
    expect(converted.nodes[0]).toMatchObject({ kind: 'annotation_frame', role: 'frame', size: { width: 240, height: 160 } })
  })

  test('output conversion removes outgoing execution links while preserving incoming context', () => {
    const initial = graph([createSessionDraftEdge({ source: 'source', target: 'target' }), createSessionDraftEdge({ source: 'scene', target: 'source', kind: 'context' })])
    expect(convertDraftGraphNode(initial, 'source', 'output').edges).toHaveLength(1)
  })

  test('converting a sticky to a tool restores tool appearance without changing text or position', () => {
    const initial = graph([])
    initial.nodes[0] = { ...initial.nodes[0]!, role: 'sticky', color: 'rose', title: 'Read this file', position: { x: -20, y: 40 } }
    expect(convertDraftGraphNode(initial, 'source', 'tool').nodes[0]).toMatchObject({ role: 'node', kind: 'tool', title: 'Read this file', position: { x: -20, y: 40 } })
  })
})

describe('canvas refresh while editing', () => {
  const flowNode = (id: string): Node => ({ id, position: { x: 0, y: 0 }, data: { title: 'before' } })
  test('title/transcript updates preserve multiple selected nodes', () => {
    const current = [{ ...flowNode('a'), selected: true }, { ...flowNode('b'), selected: true }]
    const seed = [flowNode('a'), { ...flowNode('b'), data: { title: 'after' } }]
    const refreshed = reconcileCanvasNodes(seed, current, 'b')
    expect(refreshed.map((item) => item.selected)).toEqual([true, true])
    expect(refreshed[1]!.data.title).toBe('after')
  })
  test('a transcript refresh preserves live drag/resize but applies explicit layout changes afterward', () => {
    const current = [{ ...flowNode('a'), dragging: true, position: { x: 60, y: 90 } }]
    expect(reconcileCanvasNodes([flowNode('a')], current, 'a')[0]!.position).toEqual({ x: 60, y: 90 })
    current[0]!.dragging = false
    expect(reconcileCanvasNodes([flowNode('a')], current, 'a')[0]!.position).toEqual({ x: 0, y: 0 })
  })
})
